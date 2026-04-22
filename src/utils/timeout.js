/**
 * Global tool timeout utility.
 *
 * Wraps CDP-dependent tool promises in Promise.race against a hard timeout so
 * a stuck TradingView / CDP session surfaces as a clear error instead of a
 * 4-minute silent hang that freezes the MCP client.
 *
 * See PRD.md Section 2.1.
 */

const DEFAULT_TOOL_TIMEOUT_MS = 15_000;
const DEFAULT_LAUNCH_TIMEOUT_MS = 30_000;

function parsePositiveInt(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function getToolTimeoutMs() {
  return parsePositiveInt(process.env.TV_MCP_TOOL_TIMEOUT_MS, DEFAULT_TOOL_TIMEOUT_MS);
}

export function getLaunchTimeoutMs() {
  return parsePositiveInt(process.env.TV_MCP_LAUNCH_TIMEOUT_MS, DEFAULT_LAUNCH_TIMEOUT_MS);
}

/**
 * Race `promise` against a timeout. On timeout, rejects with an error that
 * names the tool, the elapsed budget, and a remediation hint.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} toolName
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, toolName) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `[${toolName}] Timed out after ${ms}ms. ` +
          `Check that TradingView Desktop is in the foreground and CDP is connected. ` +
          `Run tv_health_check to diagnose.`,
        ),
      );
    }, ms);
    // Don't keep the event loop alive just for this timer.
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Convenience wrapper that applies the standard tool timeout.
 */
export function withToolTimeout(promise, toolName) {
  return withTimeout(promise, getToolTimeoutMs(), toolName);
}

/**
 * Convenience wrapper that applies the longer launch timeout.
 */
export function withLaunchTimeout(promise, toolName) {
  return withTimeout(promise, getLaunchTimeoutMs(), toolName);
}
