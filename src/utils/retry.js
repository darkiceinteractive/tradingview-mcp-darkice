/**
 * Tool-handler retry decorator with CDP re-attach.
 *
 * PRD Section 2.4 — Auto-Retry with CDP Re-attach.
 *
 * Purpose & relationship to transport-layer retry:
 * ─────────────────────────────────────────────────
 * `src/connection.js` already retries ONCE silently at the CDP transport layer
 * inside `evaluate()`. That handles the common case where a single evaluate
 * call stalls on a half-open socket (re-attaches transparently).
 *
 * This module adds a SECOND, VISIBLE retry layer at the tool-handler level:
 *   • Logs to stderr so operators can see when a re-attach occurs.
 *   • Catches failures that slip past the transport layer (e.g. the whole
 *     core function throws after a partial sequence of evaluate calls).
 *   • Provides a clear hook point for future per-error-class retry policies.
 *
 * This is belt-and-braces, not a replacement. Both layers coexist and the
 * theoretical worst case is 4 CDP round-trips per tool call:
 *   handler attempt 1 → transport attempt 1 + transport attempt 2
 *   handler attempt 2 → transport attempt 1 + transport attempt 2
 *
 * With sub-10s CDP eval timeouts, 2 handler attempts still fit comfortably
 * inside the 15s tool budget on the happy path (first handler attempt
 * succeeds within ~1–2s) and within a single 15s window for the retry
 * path (first attempt burns ~10s on a timeout, retry starts fresh).
 *
 * Composition with withToolTimeout:
 * ──────────────────────────────────
 * The caller should compose as:
 *
 *   withToolTimeout(
 *     withRetry(() => core.fn(args), 'tool_name'),
 *     'tool_name',
 *   )
 *
 * Timeout is OUTERMOST so the 15s wall-clock budget is absolute — once the
 * timeout fires it doesn't matter whether a retry is in progress. Putting
 * retry inside the timeout also prevents a scenario where two full 15s
 * budgets could stack (which would happen if timeout were inside retry).
 *
 * Retryable error detection:
 * ──────────────────────────
 * Only errors that look like transient CDP / WebSocket transport failures
 * trigger a retry. Clean application errors ("Study not found", "Could not
 * extract OHLCV data") are user-facing problems, not transport failures —
 * retrying them would waste time and confuse users. The pattern below
 * mirrors the stale-detection logic already used inside `evaluate()` in
 * connection.js, so both layers agree on what "stale" means.
 *
 * Re-attach action:
 * ─────────────────
 * We call `disconnect()` from connection.js rather than reaching for the
 * module-private `invalidateClient()`. `disconnect()` closes the current
 * CDP client and nullifies the cached reference. The next `getClient()`
 * call inside any subsequent `evaluate()` will reconnect from scratch.
 * This is sufficient for a full re-attach without needing to export an
 * additional symbol from connection.js.
 */

import { disconnect } from '../connection.js';

/**
 * Regex of error messages that indicate a transient CDP transport failure,
 * as opposed to a clean application-level error.
 *
 * Mirrors the stale-detection logic in connection.js `evaluate()`.
 */
const TRANSIENT_ERROR_RE = /StaleClient|WebSocket|socket|ECONNREFUSED|ECONNRESET|closed|not opened|Timed out|timed out/i;

/**
 * Returns true when `err` looks like a transient CDP transport failure that
 * is worth retrying after a fresh re-attach. Returns false for clean
 * application errors that indicate a user / data problem.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isTransientError(err) {
  if (!(err instanceof Error)) return false;
  return TRANSIENT_ERROR_RE.test(err.message);
}

/**
 * Wrap an async function with a single re-attach retry on transient CDP errors.
 *
 * On first attempt failure, if the error looks like a transport failure:
 *   1. Logs the failure to stderr (never stdout — this is a stdio MCP server).
 *   2. Calls `disconnect()` to invalidate the stale CDP client.
 *   3. Invokes `fn()` again — the next `evaluate()` call inside `fn` will
 *      reconnect automatically via `getClient()`.
 *
 * If the second attempt also fails, or if the first failure is a clean
 * application error, the error is re-thrown to the caller immediately.
 *
 * @template T
 * @param {() => Promise<T>} fn            Thunk to execute and (optionally) retry.
 * @param {string}           toolName      Used in log messages for observability.
 * @param {number}           [maxAttempts] Maximum attempts. Default 2 (one retry).
 * @returns {Promise<T>}
 */
export async function withRetry(fn, toolName, maxAttempts = 2) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Last attempt or non-transient error — surface immediately.
      if (attempt === maxAttempts || !isTransientError(err)) {
        throw err;
      }
      // Transient error on a non-final attempt — log, invalidate, retry.
      process.stderr.write(
        `[${toolName}] Attempt ${attempt} failed: ${err.message}. Re-attaching CDP...\n`,
      );
      // Close the stale client so getClient() reconnects on the next evaluate().
      await disconnect();
    }
  }
  // Should never reach here — the loop always returns or throws.
  throw new Error('[withRetry] unreachable');
}
