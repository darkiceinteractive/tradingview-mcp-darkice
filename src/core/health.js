/**
 * Core health/discovery/launch logic.
 */
import { getClient, getTargetInfo, evaluate, disconnect } from '../connection.js';
import { withTimeout } from '../utils/timeout.js';
import { existsSync } from 'fs';
import { execSync, spawn } from 'child_process';

export async function healthCheck() {
  await getClient();
  const target = await getTargetInfo();

  const state = await evaluate(`
    (function() {
      var result = { url: window.location.href, title: document.title };
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        result.symbol = chart.symbol();
        result.resolution = chart.resolution();
        result.chartType = chart.chartType();
        result.apiAvailable = true;
      } catch(e) {
        result.symbol = 'unknown';
        result.resolution = 'unknown';
        result.chartType = null;
        result.apiAvailable = false;
        result.apiError = e.message;
      }
      return result;
    })()
  `);

  // --- Tier-2: data pipeline health probe (PRD Section 2.3) ---
  //
  // Tier-1 (above) confirms the CDP *socket* is up.  Tier-2 confirms the page
  // can actually execute JS and return data — a green tier-1 with a stale CDP
  // session or broken evaluate path would silently fail all data tools.
  //
  // Strategy:
  //   • Use a 3s outer withTimeout so the probe never blocks the caller beyond
  //     that budget, even if the inner CDP evaluate() stalls.
  //   • Pass timeoutMs: 2500 into evaluate() opts so its internal per-call
  //     sub-timeout fires before the outer 3s race — this prevents the
  //     evaluate() stale-client retry path from consuming the full outer budget
  //     and still allows it to fail fast and propagate the error upward.
  //   • Query multiple selectors (comma-separated in one querySelector call) to
  //     guard against TradingView's CSS module hash churn between app versions.
  //   • Measure wall-clock latency so callers can detect degraded pipelines
  //     before they hit tool-level timeouts.
  const DATA_PIPELINE_PROBE_TIMEOUT_MS = 3_000;
  // Inner evaluate budget: must be < outer probe timeout to ensure the inner
  // stale-client retry does not consume the full outer race budget.
  const DATA_PIPELINE_EVAL_TIMEOUT_MS = 2_500;

  let data_pipeline_healthy = false;
  let data_pipeline_latency_ms = 0;
  let data_pipeline_error;

  const probeStart = Date.now();
  try {
    // The expression evaluates a live DOM read. We use multiple selectors
    // so a class-hash rename in any one TradingView release doesn't break
    // the probe — at least one of these selectors is expected to match when
    // the chart page is fully loaded and the CDP connection is healthy.
    const probeExpression =
      `document.querySelector('.chart-container, .chart-page, [class*="chart-container"]') !== null`;

    const probeResult = await withTimeout(
      evaluate(probeExpression, { timeoutMs: DATA_PIPELINE_EVAL_TIMEOUT_MS }),
      DATA_PIPELINE_PROBE_TIMEOUT_MS,
      'data_pipeline_probe',
    );

    data_pipeline_latency_ms = Date.now() - probeStart;
    // A truthy return means the chart DOM is present — pipeline is healthy.
    // A falsy return (null querySelector result cast to false) means the page
    // loaded but has no recognisable chart container — mark as unhealthy with
    // a descriptive reason so callers know this is a page-state issue, not a
    // transport issue.
    data_pipeline_healthy = probeResult === true;
    if (!data_pipeline_healthy) {
      data_pipeline_error =
        'Chart container element not found in DOM — TradingView may still be loading or the chart page is not active';
    }
  } catch (err) {
    data_pipeline_latency_ms = Date.now() - probeStart;
    data_pipeline_healthy = false;
    data_pipeline_error = err.message;
  }

  return {
    success: true,
    cdp_connected: true,
    target_id: target.id,
    target_url: target.url,
    target_title: target.title,
    chart_symbol: state?.symbol || 'unknown',
    chart_resolution: state?.resolution || 'unknown',
    chart_type: state?.chartType ?? null,
    api_available: state?.apiAvailable ?? false,
    // Tier-2 data pipeline fields (PRD Section 2.3)
    data_pipeline_healthy,
    data_pipeline_latency_ms,
    ...(data_pipeline_error !== undefined ? { data_pipeline_error } : {}),
  };
}

export async function discover() {
  const paths = await evaluate(`
    (function() {
      var results = {};
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        var methods = [];
        for (var k in chart) { if (typeof chart[k] === 'function') methods.push(k); }
        results.chartApi = { available: true, path: 'window.TradingViewApi._activeChartWidgetWV.value()', methodCount: methods.length, methods: methods.slice(0, 50) };
      } catch(e) { results.chartApi = { available: false, error: e.message }; }
      try {
        var col = window.TradingViewApi._chartWidgetCollection;
        var colMethods = [];
        for (var k in col) { if (typeof col[k] === 'function') colMethods.push(k); }
        results.chartWidgetCollection = { available: !!col, path: 'window.TradingViewApi._chartWidgetCollection', methodCount: colMethods.length, methods: colMethods.slice(0, 30) };
      } catch(e) { results.chartWidgetCollection = { available: false, error: e.message }; }
      try {
        var ws = window.ChartApiInstance;
        var wsMethods = [];
        for (var k in ws) { if (typeof ws[k] === 'function') wsMethods.push(k); }
        results.chartApiInstance = { available: !!ws, path: 'window.ChartApiInstance', methodCount: wsMethods.length, methods: wsMethods.slice(0, 30) };
      } catch(e) { results.chartApiInstance = { available: false, error: e.message }; }
      try {
        var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
        var bwbMethods = [];
        if (bwb) { for (var k in bwb) { if (typeof bwb[k] === 'function') bwbMethods.push(k); } }
        results.bottomWidgetBar = { available: !!bwb, path: 'window.TradingView.bottomWidgetBar', methodCount: bwbMethods.length, methods: bwbMethods.slice(0, 20) };
      } catch(e) { results.bottomWidgetBar = { available: false, error: e.message }; }
      try {
        var replay = window.TradingViewApi._replayApi;
        results.replayApi = { available: !!replay, path: 'window.TradingViewApi._replayApi' };
      } catch(e) { results.replayApi = { available: false, error: e.message }; }
      try {
        var alerts = window.TradingViewApi._alertService;
        results.alertService = { available: !!alerts, path: 'window.TradingViewApi._alertService' };
      } catch(e) { results.alertService = { available: false, error: e.message }; }
      return results;
    })()
  `);

  const available = Object.values(paths).filter(v => v.available).length;
  const total = Object.keys(paths).length;

  return { success: true, apis_available: available, apis_total: total, apis: paths };
}

export async function uiState() {
  const state = await evaluate(`
    (function() {
      var ui = {};
      var bottom = document.querySelector('[class*="layout__area--bottom"]');
      ui.bottom_panel = { open: !!(bottom && bottom.offsetHeight > 50), height: bottom ? bottom.offsetHeight : 0 };
      var right = document.querySelector('[class*="layout__area--right"]');
      ui.right_panel = { open: !!(right && right.offsetWidth > 50), width: right ? right.offsetWidth : 0 };
      var monacoEl = document.querySelector('.monaco-editor.pine-editor-monaco');
      ui.pine_editor = { open: !!monacoEl, width: monacoEl ? monacoEl.offsetWidth : 0, height: monacoEl ? monacoEl.offsetHeight : 0 };
      var stratPanel = document.querySelector('[data-name="backtesting"]') || document.querySelector('[class*="strategyReport"]');
      ui.strategy_tester = { open: !!(stratPanel && stratPanel.offsetParent) };
      var widgetbar = document.querySelector('[data-name="widgetbar-wrap"]');
      ui.widgetbar = { open: !!(widgetbar && widgetbar.offsetWidth > 50) };
      ui.buttons = {};
      var btns = document.querySelectorAll('button');
      var seen = {};
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.offsetParent === null || b.offsetWidth < 15) continue;
        var text = b.textContent.trim();
        var aria = b.getAttribute('aria-label') || '';
        var dn = b.getAttribute('data-name') || '';
        var label = text || aria || dn;
        if (!label || label.length > 60) continue;
        var key = label.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 40);
        if (seen[key]) continue;
        seen[key] = true;
        var rect = b.getBoundingClientRect();
        var region = 'other';
        if (rect.y < 50) region = 'top_bar';
        else if (rect.y < 90 && rect.x < 650) region = 'toolbar';
        else if (rect.x < 45) region = 'left_sidebar';
        else if (rect.x > 650 && rect.y < 100) region = 'pine_header';
        else if (rect.y > 750) region = 'bottom_bar';
        if (!ui.buttons[region]) ui.buttons[region] = [];
        ui.buttons[region].push({ label: label.substring(0, 40), disabled: b.disabled, x: Math.round(rect.x), y: Math.round(rect.y) });
      }
      ui.key_buttons = {};
      var keyLabels = {
        'add_to_chart': /add to chart/i, 'save_and_add': /save and add/i,
        'update_on_chart': /update on chart/i, 'save': /^Save(Save)?$/,
        'saved': /^Saved/, 'publish_script': /publish script/i,
        'compile_errors': /error/i, 'unsaved_version': /unsaved version/i,
      };
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.offsetParent === null) continue;
        var text = b.textContent.trim();
        for (var k in keyLabels) {
          if (keyLabels[k].test(text)) {
            ui.key_buttons[k] = { text: text.substring(0, 40), disabled: b.disabled, visible: b.offsetWidth > 0 };
          }
        }
      }
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        ui.chart = { symbol: chart.symbol(), resolution: chart.resolution(), chartType: chart.chartType(), study_count: chart.getAllStudies().length };
      } catch(e) { ui.chart = { error: e.message }; }
      try {
        var replay = window.TradingViewApi._replayApi;
        function unwrap(v) { return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; }
        ui.replay = { available: unwrap(replay.isReplayAvailable()), started: unwrap(replay.isReplayStarted()) };
      } catch(e) { ui.replay = { error: e.message }; }
      return ui;
    })()
  `);

  return { success: true, ...state };
}

export async function launch({ port, kill_existing } = {}) {
  const cdpPort = port || 9222;
  const killFirst = kill_existing !== false;
  const platform = process.platform;

  const pathMap = {
    darwin: [
      '/Applications/TradingView.app/Contents/MacOS/TradingView',
      `${process.env.HOME}/Applications/TradingView.app/Contents/MacOS/TradingView`,
    ],
    win32: [
      `${process.env.LOCALAPPDATA}\\TradingView\\TradingView.exe`,
      `${process.env.PROGRAMFILES}\\TradingView\\TradingView.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\TradingView\\TradingView.exe`,
    ],
    linux: [
      '/opt/TradingView/tradingview',
      '/opt/TradingView/TradingView',
      `${process.env.HOME}/.local/share/TradingView/TradingView`,
      '/usr/bin/tradingview',
      '/snap/tradingview/current/tradingview',
    ],
  };

  let tvPath = null;
  const candidates = pathMap[platform] || pathMap.linux;
  for (const p of candidates) {
    if (p && existsSync(p)) { tvPath = p; break; }
  }

  if (!tvPath) {
    try {
      const cmd = platform === 'win32' ? 'where TradingView.exe' : 'which tradingview';
      tvPath = execSync(cmd, { timeout: 3000 }).toString().trim().split('\n')[0];
      if (tvPath && !existsSync(tvPath)) tvPath = null;
    } catch { /* ignore */ }
  }

  if (!tvPath && platform === 'darwin') {
    try {
      const found = execSync('mdfind "kMDItemFSName == TradingView.app" | head -1', { timeout: 5000 }).toString().trim();
      if (found) {
        const candidate = `${found}/Contents/MacOS/TradingView`;
        if (existsSync(candidate)) tvPath = candidate;
      }
    } catch { /* ignore */ }
  }

  if (!tvPath) {
    throw new Error(`TradingView not found on ${platform}. Searched: ${candidates.join(', ')}. Launch manually with: /path/to/TradingView --remote-debugging-port=${cdpPort}`);
  }

  if (killFirst) {
    try {
      if (platform === 'win32') execSync('taskkill /F /IM TradingView.exe', { timeout: 5000 });
      else execSync('pkill -f TradingView', { timeout: 5000 });
      await new Promise(r => setTimeout(r, 1500));
    } catch { /* may not be running */ }
  }

  const child = spawn(tvPath, [`--remote-debugging-port=${cdpPort}`], { detached: true, stdio: 'ignore' });
  child.unref();

  // PRD Section 2.6: poll every 500ms for up to 30s so the inner launch logic
  // surfaces a hard error on its own rather than relying solely on the outer
  // withLaunchTimeout cap in tools/health.js.  Both agree on a 30s budget, so
  // if CDP comes up at 29.9s we still catch it; at 30s they both agree on
  // failure with consistent messaging.
  //
  // Endpoint choice: we keep /json/version rather than the PRD's suggested
  // /json.  Both endpoints prove CDP is listening, but /json/version returns a
  // single small JSON object (Browser, Protocol-Version, …) while /json returns
  // the full target list which can be several kilobytes when many tabs exist.
  // /json/version is lighter and sufficient to prove the process is up and
  // serving the debug protocol.
  const POLL_INTERVAL_MS = 500;
  const POLL_BUDGET_MS = 30_000;
  // Per-request abort window must be shorter than the poll interval so one
  // slow/hung TCP connection never delays the next attempt.  400ms gives a
  // 100ms gap before the next poll fires.
  const POLL_REQUEST_TIMEOUT_MS = 400;
  const cdpVersionUrl = `http://localhost:${cdpPort}/json/version`;
  const pollDeadline = Date.now() + POLL_BUDGET_MS;

  while (Date.now() < pollDeadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const ctrl = new AbortController();
    const abortTimer = setTimeout(() => ctrl.abort(), POLL_REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(cdpVersionUrl, { signal: ctrl.signal });
      const info = await resp.json();
      return {
        success: true, platform, binary: tvPath, pid: child.pid,
        cdp_port: cdpPort, cdp_url: `http://localhost:${cdpPort}`,
        browser: info.Browser, user_agent: info['User-Agent'],
      };
    } catch {
      // Network error or abort — process is still starting; continue polling.
    } finally {
      clearTimeout(abortTimer);
    }
  }

  // 30s elapsed with no CDP response.  Throw so the caller (and the outer
  // withLaunchTimeout wrapper) receives a hard error instead of a misleading
  // success object.  The port is interpolated into the message so the hint
  // is accurate when a non-default port was requested.
  throw new Error(
    `TradingView did not start within 30s. Try launching it manually with --remote-debugging-port=${cdpPort}`,
  );
}

/**
 * Hard restart TradingView Desktop — kill existing process, wait for full
 * exit, relaunch with CDP enabled. Designed for unattended recovery when the
 * CDP session wedges or a tool hangs and you want a clean slate without
 * asking the user to do anything manually.
 *
 * Stderr-logs every phase so the invoker sees progress in real time (MCP
 * clients typically surface stderr as tool-progress lines). Never writes to
 * stdout — stdout is the MCP protocol channel.
 *
 * Reuses launch() for the find-binary + spawn + poll-CDP path so the PRD §2.6
 * hardening (30s budget, AbortController-per-request, hard error string)
 * applies here too — we just bypass launch's own pkill step by passing
 * kill_existing: false, because we do the kill + pgrep-wait ourselves with
 * user-visible progress.
 *
 * @param {object} [opts]
 * @param {number} [opts.port]  CDP port (default 9222).
 * @returns {Promise<object>}   { success, previous_pid, new_pid, platform,
 *                                binary, cdp_port, cdp_url, browser,
 *                                user_agent, elapsed_ms, phases }
 */
export async function restart({ port } = {}) {
  const cdpPort = port || 9222;
  const platform = process.platform;
  const started = Date.now();
  const phases = {};
  const log = (msg) => process.stderr.write(`[tv_restart] ${msg}\n`);

  // --- Phase 1: Close our CDP client so it doesn't cling to a socket that is
  // about to die. If we don't do this, the next evaluate() after restart may
  // try to reuse a dead WebSocket before hitting the reconnect path.
  log('Closing existing CDP client...');
  const tDisconnect = Date.now();
  try { await disconnect(); } catch { /* best-effort */ }
  phases.disconnect_ms = Date.now() - tDisconnect;

  // --- Phase 2: Capture current PID (best-effort, purely for the response
  // payload so the user can see what we replaced).
  let previousPid = null;
  try {
    if (platform === 'win32') {
      const out = execSync(
        'tasklist /FI "IMAGENAME eq TradingView.exe" /FO CSV /NH',
        { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
      ).toString();
      const match = out.match(/"(\d+)"/);
      if (match) previousPid = Number.parseInt(match[1], 10);
    } else {
      const out = execSync('pgrep -f TradingView', {
        timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
      const pids = out.split('\n').filter(Boolean);
      if (pids.length) previousPid = Number.parseInt(pids[0], 10);
    }
  } catch { /* not running — that's fine, restart handles a cold start too */ }

  // --- Phase 3: Kill the process.
  log(previousPid
    ? `Killing TradingView (PID ${previousPid})...`
    : 'Killing TradingView (no running instance detected)...');
  const tKill = Date.now();
  try {
    if (platform === 'win32') {
      execSync('taskkill /F /IM TradingView.exe', { timeout: 5000, stdio: 'ignore' });
    } else {
      execSync('pkill -f TradingView', { timeout: 5000, stdio: 'ignore' });
    }
  } catch { /* may not be running — continue to relaunch regardless */ }

  // --- Phase 4: Poll until the process is fully gone. Killing is async on
  // macOS/Linux and the next spawn can race if we don't wait. Budget 5s —
  // SIGTERM followed by SIGKILL should complete within that on any sane box.
  const exitDeadline = Date.now() + 5_000;
  while (Date.now() < exitDeadline) {
    if (platform === 'win32') {
      // taskkill /F is synchronous-enough; one short settle and we move on.
      await new Promise(r => setTimeout(r, 1500));
      break;
    }
    let stillRunning = false;
    try {
      const out = execSync('pgrep -f TradingView', {
        timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
      stillRunning = out.length > 0;
    } catch {
      // pgrep exits with status 1 when no process matches — means it's gone.
      stillRunning = false;
    }
    if (!stillRunning) break;
    await new Promise(r => setTimeout(r, 200));
  }
  phases.kill_ms = Date.now() - tKill;
  log(`Process exited after ${phases.kill_ms}ms.`);

  // --- Phase 5: Relaunch via launch() so PRD §2.6 polling hardening applies.
  // We pass kill_existing:false because we just did that ourselves with
  // visible progress; having launch() try to pkill an already-dead process
  // would swallow the 1.5s it sleeps afterwards for no benefit.
  log(`Launching TradingView with --remote-debugging-port=${cdpPort}...`);
  const tSpawn = Date.now();
  const launchResult = await launch({ port: cdpPort, kill_existing: false });
  phases.spawn_and_cdp_ready_ms = Date.now() - tSpawn;
  log(`CDP ready at ${launchResult.cdp_url} (${phases.spawn_and_cdp_ready_ms}ms).`);

  const elapsed_ms = Date.now() - started;
  log(`Restart complete. Total elapsed: ${elapsed_ms}ms.`);

  return {
    success: true,
    previous_pid: previousPid,
    new_pid: launchResult.pid,
    platform: launchResult.platform,
    binary: launchResult.binary,
    cdp_port: launchResult.cdp_port,
    cdp_url: launchResult.cdp_url,
    browser: launchResult.browser,
    user_agent: launchResult.user_agent,
    elapsed_ms,
    phases,
  };
}
