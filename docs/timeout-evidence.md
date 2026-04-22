# PRD §2 + §3 Timeout / Retry / Launch — Evidence

**Date:** 2026-04-23
**Scope:** Claude Desktop test feedback asked us to confirm §2.1 (15s timeout), §2.4 (CDP auto-retry), §2.6 (tv_launch 30s), §3.4 (batch_run). This doc collects the evidence.

---

## At-a-glance status

| PRD Item | Status | Implementation | Validation |
|---|---|---|---|
| §2.1 Global 15s timeout | ✅ | `src/utils/timeout.js` + wraps in `src/tools/{data,health,batch}.js` | 9 unit tests + probe script |
| §2.2 Transport hardening | ✅ | `src/connection.js` — per-evaluate sub-timeout + stale-client auto-reattach | all live tool tests (11 green) |
| §2.3 Tier-2 health probe | ✅ | `src/core/health.js#healthCheck` | 2 live tests |
| §2.4 CDP auto-retry | ✅ | `src/utils/retry.js` wraps 8 data handlers | 6 unit tests + probe script |
| §2.5 ui_open_panel watchlist | ✅ | `src/core/ui.js` (`data-name="base"`) | 4 live tests |
| §2.6 tv_launch 30s poll | ✅ | `src/core/health.js#launch` | 5 source-level unit tests |
| §3.1 quote_get symbol bug | ✅ (fixed 2026-04-23) | `src/core/data.js#getQuote` — temp-switch pattern | 3 live tests incl. regression |
| §3.2 data_get_ohlcv | ✅ | unchanged core logic; now wrapped + retried | 2 live tests |
| §3.3 data_get_study_values | ✅ | unchanged core logic; now wrapped + retried | 1 live test |
| §3.4 batch_run | ✅ | `src/tools/batch.js` — scaled timeout budget (iterations × 15s + delay, capped 10min) | 1 live test (gated) |

---

## §2.1 — Error message shape

The timeout wrapper produces an error message that names the tool, the budget, and a remediation hint. Anyone seeing this in a client log can diagnose the problem in one glance.

Output from `node scripts/probe-timeout.js`:

```
[demo_quote_get] Timed out after 250ms. Check that TradingView Desktop is in
the foreground and CDP is connected. Run tv_health_check to diagnose.

  ✓ includes tool name:       true
  ✓ includes timeout ms:      true
  ✓ includes remediation hint: true
```

Source: `src/utils/timeout.js:39-57` (`withTimeout`).

**Why you can trust it fires fast:** each tool handler is wrapped with `withToolTimeout(withRetry(() => core.fn(args), name), name)`. The outer `withToolTimeout` enforces the hard 15s ceiling. The inner `withRetry` takes at most 2 attempts at roughly equal cost — so if an attempt takes >7s it won't retry. Overall: any hanging tool returns an error within 15s, never 4 minutes.

**Env overrides:** `TV_MCP_TOOL_TIMEOUT_MS=5000` shrinks the budget; non-numeric or non-positive values fall back to the default 15000.

---

## §2.4 — Retry classification

`withRetry` only retries transient transport errors. Clean application errors ("Study not found", "Symbol invalid") throw on the first attempt — we never retry a user-visible failure.

Output from `node scripts/probe-timeout.js`:

```
Transient patterns (should retry → 2 calls):
[demo_tool] Attempt 1 failed: StaleClientError fired. Re-attaching CDP...
  ✓ "StaleClientError fired" → 2 calls
[demo_tool] Attempt 1 failed: WebSocket is not opened. Re-attaching CDP...
  ✓ "WebSocket is not opened" → 2 calls
[demo_tool] Attempt 1 failed: socket hang up. Re-attaching CDP...
  ✓ "socket hang up" → 2 calls
[demo_tool] Attempt 1 failed: ECONNREFUSED. Re-attaching CDP...
  ✓ "ECONNREFUSED" → 2 calls
[demo_tool] Attempt 1 failed: ECONNRESET. Re-attaching CDP...
  ✓ "ECONNRESET" → 2 calls
[demo_tool] Attempt 1 failed: client is closed. Re-attaching CDP...
  ✓ "client is closed" → 2 calls
[demo_tool] Attempt 1 failed: Timed out after 1000ms. Re-attaching CDP...
  ✓ "Timed out after 1000ms" → 2 calls

Clean application errors (should NOT retry → 1 call):
  ✓ "Study not found" → 1 calls
  ✓ "Could not extract OHLCV data" → 1 calls
  ✓ "Symbol XYZ is invalid" → 1 calls
  ✓ "entity_id required for remove action" → 1 calls

=== PRD §2.4 — Retry log goes to stderr, not stdout (MCP stdio safety) ===

  ✓ re-attach notice on stderr: true
  ✓ stdout remains clean:       true
  Captured stderr: [demo_reattach] Attempt 1 failed: WebSocket is not opened.
  Re-attaching CDP...
```

Source: `src/utils/retry.js`.

**MCP stdio safety:** retry notices go to stderr only. stdout is the protocol channel; any stray bytes there would corrupt the MCP client parse stream.

**Belt-and-braces:** `src/connection.js` ALSO has a stale-client retry at the transport layer (one level below `withRetry`). A stale session typically recovers at the transport layer without even surfacing to `withRetry`. If it doesn't, `withRetry` gets the second bite.

---

## §2.6 — tv_launch 30s hard cap

`launch()` now polls `http://localhost:9222/json/version` every 500ms for up to 30s. If the budget expires the function throws with the PRD-mandated message:

```
TradingView did not start within 30s.
Try launching it manually with --remote-debugging-port=9222
```

Source: `src/core/health.js#launch`. Constants: `POLL_INTERVAL_MS = 500`, `POLL_BUDGET_MS = 30_000`, `POLL_REQUEST_TIMEOUT_MS = 400`.

We verify this via source-level assertions rather than running `launch()` in a test — calling `launch()` with default args kills the user's existing TV session, which destroys the live test context. The source-level assertions cover:

- the PRD-mandated error string is present verbatim
- poll interval is exactly 500ms
- poll budget is exactly 30_000ms
- fetch + AbortController is used for per-request timeout
- the old soft-success path (`cdp_ready: false` + warning) is gone

```
▶ Section 2.6 — launch() source-level contract
  ✔ contains the PRD-mandated 30s timeout error string
  ✔ uses a 500ms poll interval
  ✔ uses a 30_000ms total poll budget
  ✔ uses fetch + AbortController for per-request timeout
  ✔ no longer returns a soft success with cdp_ready:false on timeout
```

**Manual reproduction for the tester:**
1. Quit TradingView completely.
2. Call `tv_launch` from Claude Desktop with `auto_detect: false` and `app_path: "/nonexistent"` so the app never starts.
3. Expect an error within ~30s: `"TradingView did not start within 30s..."` — not a hang.

---

## §3.4 — batch_run

Timeout budget scales with the workload: `iterations × (tool_timeout + delay_ms)`, capped at 10 minutes. Source: `src/tools/batch.js`.

Gated live test at `tests/live.test.js` (Section 3.4) runs `get_ohlcv` across `['ASX:CBA'] × ['1D']` and asserts the batch completes within 60s. Gated behind `TV_MCP_ALLOW_DISRUPTIVE_TESTS=1` because it navigates the live chart.

Run: `TV_MCP_ALLOW_DISRUPTIVE_TESTS=1 npm run test:live`.

**Manual reproduction for the tester:**
1. Quit TV. (No CDP → the batch must fail fast, not hang.)
2. Call `batch_run` with `{ symbols: ['ASX:CBA', 'ASX:BHP'], timeframes: ['1D'], action: 'get_ohlcv' }`.
3. Expect an error within ~15s per iteration (one 15s tool timeout for the first symbol that can't connect, then the batch short-circuits or moves on).

---

## §3.1 — quote_get symbol-param bug (fixed 2026-04-23)

The tester flagged that `quote_get({ symbol: 'ASX:BHP' })` was silently returning chart data labelled with the requested symbol. Fix landed in commit `ffeb5fe`.

Implementation: temp-switch-and-restore. `getQuote({ symbol })` now:

1. Reads the current chart symbol (cheap facade call).
2. If `symbol` is passed and its BASE symbol differs from the chart's BASE, switches the chart via `quickSwitchSymbol(symbol, 5s)` which uses `chart.setSymbol` + `waitForChartReady(5000)`.
3. Reads the quote from the active chart — now sitting on the requested symbol, so `symbolExt()` returns the right metadata.
4. Hard guard: if the chart resolved to a DIFFERENT base symbol (bad symbol, rejected by TV), throws rather than returning wrong data.
5. Restores the original symbol in a `finally` block (works even on error).

**Why base-symbol comparison:** TradingView auto-routes `NASDAQ:AAPL` → `BATS:AAPL` for retail accounts. That's legitimate routing, not a bug — the user still gets AAPL data. Requiring exact exchange equality would produce spurious failures. The Claude Desktop bug was a BASE mismatch (BHP vs SLV), which base-symbol comparison still catches.

**Budget fit:** 2 × `quickSwitchSymbol(5s)` + read ≈ 10.9s on live test (`NASDAQ:AAPL` against a non-AAPL chart). Well under 15s.

**Live regression test** at `tests/live.test.js` (gated behind `TV_MCP_ALLOW_DISRUPTIVE_TESTS=1` because it moves the chart twice):

```
✔ returns live quote data for the current chart symbol within 15s
✔ actually switches the chart when a different symbol is requested (PRD §3.1)
✔ does not hang when an unknown symbol arg is supplied (anti-hang regression)
```

**Manual reproduction for the tester:**

```
1. Chart is on ASX_DLY:STO (or any non-AAPL symbol).
2. Call quote_get({ symbol: 'NASDAQ:AAPL' }).
3. Expect response.symbol to contain "AAPL" (base) and
   response.chart_switched === true and response.requested_symbol === 'NASDAQ:AAPL'.
4. Chart returns to ASX_DLY:STO after the call.
```

---

## Reproducing this evidence

```bash
cd /Users/mattcrombie/Dev/Projects/mcp-servers/tradingview-mcp-darkice

# Unit evidence (no TV required) — 49 tests, ~2s
npm run test:unit

# Probe script — §2.1 + §2.4 error messages and classifications
node scripts/probe-timeout.js

# Live evidence (TV must be running on localhost:9222) — 11 tests
npm run test:live

# Disruptive live evidence (includes quote_get symbol-switch + batch_run)
TV_MCP_ALLOW_DISRUPTIVE_TESTS=1 npm run test:live
```

**Pre-existing unrelated failures in `npm run test:all`:** 2 tests in `tests/e2e.test.js` (`ui_open_panel — open/close pine-editor` and `replay_stop — return to realtime`). Both documented in `resume.md` as TV API drift and test-state pollution respectively — not in scope for this PRD.
