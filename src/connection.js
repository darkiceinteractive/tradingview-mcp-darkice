import CDP from 'chrome-remote-interface';

let client = null;
let targetInfo = null;
const CDP_HOST = 'localhost';
const CDP_PORT = 9222;
// Keep the full reconnect path well inside the 15s tool budget.
// Previous values (5 retries, exponential up to 30s each) could burn
// 60s+ on cold start, guaranteeing the tool-level timeout fires first.
const MAX_RETRIES = 3;
const BASE_DELAY = 250;
const MAX_DELAY = 1_500;
const FIND_TARGET_TIMEOUT_MS = 2_000;

// PRD Section 2.2 — Shared async dependency audit.
//
// Root-cause analysis of the 4-minute silent hang observed in quote_get,
// data_get_ohlcv, and data_get_study_values (while chart_get_state worked):
//
//   * chart_get_state uses only the public widget facade
//     (chart.symbol(), chart.resolution(), chart.getAllStudies()).
//   * The hanging tools drill into internal model objects
//     (._chartWidget.model().mainSeries().bars() and
//     .dataSources()[i].dataWindowView().items()).
//
// The JS bodies are synchronous — a JS-level bug would surface as an
// exception or empty data, not a minutes-long silent hang. The hang is at
// the CDP transport layer: `Runtime.evaluate` with no timeout combined
// with a stale/half-open CDP session (TV tab navigated, app backgrounded,
// socket never cleanly disconnected). Internal model drill-down triggers
// heavier evaluate payloads that are more likely to stall a wobbly CDP
// pipe than the lightweight facade calls chart_get_state uses.
//
// Fix: enforce per-CDP-call sub-timeouts, mark the client stale on expiry,
// and auto-reconnect + retry once on a fresh session before giving up.
const LIVENESS_TIMEOUT_MS = 2_000;
const DEFAULT_EVAL_TIMEOUT_MS = 10_000;

function getEvalTimeoutMs() {
  const raw = process.env.TV_MCP_EVAL_TIMEOUT_MS;
  if (!raw) return DEFAULT_EVAL_TIMEOUT_MS;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_EVAL_TIMEOUT_MS;
}

function raceTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StaleClientError(`${label} timed out after ${ms}ms`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class StaleClientError extends Error {
  constructor(message) { super(message); this.name = 'StaleClientError'; }
}

async function invalidateClient() {
  const old = client;
  client = null;
  targetInfo = null;
  if (old) {
    try { await old.close(); } catch { /* best-effort */ }
  }
}

// Known direct API paths discovered via live probing (see PROBE_RESULTS.md)
const KNOWN_PATHS = {
  chartApi: 'window.TradingViewApi._activeChartWidgetWV.value()',
  chartWidgetCollection: 'window.TradingViewApi._chartWidgetCollection',
  bottomWidgetBar: 'window.TradingView.bottomWidgetBar',
  replayApi: 'window.TradingViewApi._replayApi',
  alertService: 'window.TradingViewApi._alertService',
  chartApiInstance: 'window.ChartApiInstance',
  mainSeriesBars: 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
  // Phase 1: Strategy data — model().dataSources() → find strategy → .performance().value(), .ordersData(), .reportData()
  strategyStudy: 'chart._chartWidget.model().model().dataSources()',
  // Phase 2: Layouts — getSavedCharts(cb), loadChartFromServer(id)
  layoutManager: 'window.TradingViewApi.getSavedCharts',
  // Phase 5: Symbol search — searchSymbols(query) returns Promise
  symbolSearchApi: 'window.TradingViewApi.searchSymbols',
  // Phase 6: Pine scripts — REST API at pine-facade.tradingview.com/pine-facade/list/?filter=saved
  pineFacadeApi: 'https://pine-facade.tradingview.com/pine-facade',
};

export { KNOWN_PATHS };

export async function getClient() {
  if (client) {
    try {
      // Fast liveness check — if this stalls, the session is half-open.
      await raceTimeout(
        client.Runtime.evaluate({ expression: '1', returnByValue: true }),
        LIVENESS_TIMEOUT_MS,
        'CDP liveness check',
      );
      return client;
    } catch {
      await invalidateClient();
    }
  }
  return connect();
}

export async function connect() {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const target = await findChartTarget();
      if (!target) {
        throw new Error('No TradingView chart target found. Is TradingView open with a chart?');
      }
      targetInfo = target;
      client = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });

      // Enable required domains
      await client.Runtime.enable();
      await client.Page.enable();
      await client.DOM.enable();

      return client;
    } catch (err) {
      lastError = err;
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`CDP connection failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

async function findChartTarget() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FIND_TARGET_TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`, { signal: ctrl.signal });
    const targets = await resp.json();
    // Prefer targets with tradingview.com/chart in the URL
    return targets.find(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
      || targets.find(t => t.type === 'page' && /tradingview/i.test(t.url))
      || null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getTargetInfo() {
  if (!targetInfo) {
    await getClient();
  }
  return targetInfo;
}

export async function evaluate(expression, opts = {}) {
  const evalTimeoutMs = opts.timeoutMs ?? getEvalTimeoutMs();
  // Two attempts: first on the cached client, second on a freshly attached one.
  // Retry only on StaleClientError (transport-level hang or socket drop).
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const c = await getClient();
    try {
      const result = await raceTimeout(
        c.Runtime.evaluate({
          expression,
          returnByValue: true,
          awaitPromise: opts.awaitPromise ?? false,
          ...opts,
        }),
        evalTimeoutMs,
        `CDP evaluate (attempt ${attempt})`,
      );
      if (result.exceptionDetails) {
        const msg = result.exceptionDetails.exception?.description
          || result.exceptionDetails.text
          || 'Unknown evaluation error';
        throw new Error(`JS evaluation error: ${msg}`);
      }
      return result.result?.value;
    } catch (err) {
      lastErr = err;
      const stale = err instanceof StaleClientError
        || /WebSocket|socket hang up|not opened|closed|ECONNREFUSED|ECONNRESET/i.test(err?.message || '');
      if (!stale || attempt === 2) throw err;
      process.stderr.write(`[cdp] evaluate stalled on attempt ${attempt}, re-attaching CDP session...\n`);
      await invalidateClient();
    }
  }
  throw lastErr;
}

export async function evaluateAsync(expression) {
  return evaluate(expression, { awaitPromise: true });
}

export async function disconnect() {
  if (client) {
    try { await client.close(); } catch {}
    client = null;
    targetInfo = null;
  }
}

// --- Direct API path helpers ---
// Each returns the STRING expression path after verifying it exists.
// Callers use the returned string in their own evaluate() calls.

async function verifyAndReturn(path, name) {
  const exists = await evaluate(`typeof (${path}) !== 'undefined' && (${path}) !== null`);
  if (!exists) {
    throw new Error(`${name} not available at ${path}`);
  }
  return path;
}

export async function getChartApi() {
  return verifyAndReturn(KNOWN_PATHS.chartApi, 'Chart API');
}

export async function getChartCollection() {
  return verifyAndReturn(KNOWN_PATHS.chartWidgetCollection, 'Chart Widget Collection');
}

export async function getBottomBar() {
  return verifyAndReturn(KNOWN_PATHS.bottomWidgetBar, 'Bottom Widget Bar');
}

export async function getReplayApi() {
  return verifyAndReturn(KNOWN_PATHS.replayApi, 'Replay API');
}

export async function getMainSeriesBars() {
  return verifyAndReturn(KNOWN_PATHS.mainSeriesBars, 'Main Series Bars');
}
