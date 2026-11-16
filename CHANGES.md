# Changelog — TradingView MCP Dark Ice Enhancement

## v2.0.0 — 2026-05-12

### Infrastructure Fixes (Section 2)

- **Global Tool Timeout** (`src/utils/timeout.js`)
  - Added `withTimeout()`, `withToolTimeout()`, `withLaunchTimeout()` utilities.
  - Default 15s tool timeout, 30s launch timeout.
  - Configurable via `TV_MCP_TOOL_TIMEOUT_MS` and `TV_MCP_LAUNCH_TIMEOUT_MS`.
  - All data and watchlist tools now wrapped; health/discovery exempt.

- **Shared Async Dependency Audit** (`src/connection.js`)
  - Root cause identified: stale CDP transport on heavy `Runtime.evaluate` payloads (internal model drill-down).
  - Fixed with per-eval sub-timeouts (`raceTimeout`), `StaleClientError`, and auto-reconnect.
  - `evaluate()` now retries once on stale transport before surfacing the error.

- **Enhanced Health Check** (`src/core/health.js`)
  - Added Tier-2 data pipeline probe: `data_pipeline_healthy`, `data_pipeline_latency_ms`, `data_pipeline_error`.
  - Probe uses a live DOM read with 3s outer / 2.5s inner timeout.

- **Auto-Retry with CDP Re-attach** (`src/utils/retry.js`)
  - Added `withRetry()` decorator that detects 9 transient error patterns.
  - Calls `disconnect()` and retries once on transient failures.
  - Logs re-attach notices to stderr (MCP stdio-safe).

- **Fix `ui_open_panel` for Watchlist** (`src/core/ui.js`)
  - Uses correct selector: `data-name="base"` + `aria-label="Watchlist, details, and news"`.
  - Idempotent via `aria-pressed` check.
  - Polls `.widgetbar-widgetbody` for 2s after opening to confirm content.

- **Fix `tv_launch` Timeout** (`src/core/health.js`)
  - `launch()` polls `/json/version` every 500ms for 30s with per-request `AbortController`.
  - Hard error on expiry with clear remediation message.
  - `restart()` adds full cycle: disconnect → kill → pgrep-wait → relaunch with phase timings.

### Data Tool Fixes (Section 3)

- **`quote_get`** — Temporarily switches chart symbol if requested symbol differs from active chart, reads quote, then restores original in a `finally` block. Uses base-symbol comparison to tolerate exchange routing (e.g. NASDAQ→BATS).
- **`data_get_ohlcv`** — Reads from `mainSeriesBars`, supports `summary` mode for compact stats.
- **`data_get_study_values`** — Iterates data sources and reads `dataWindowView().items()` without hanging.
- **`batch_run`** — Dynamic timeout budget = `iterations × (toolTimeout + delay)`, capped at 10 minutes.

### Watchlist Management Suite (Section 4)

**Architecture:** UI automation via CDP evaluate + keyboard events (REST API not viable — `window.TV_WATCHLISTS_URL` absent, no authenticated network traffic observed on CRUD operations).

All 8+ new tools implemented in `src/core/watchlist.js` + `src/tools/watchlist.js`:

| Tool | Description |
|------|-------------|
| `watchlist_list` | Scrapes dropdown rows for all watchlists with id, name, count, type |
| `watchlist_select` | Switches active watchlist by name or id, polls for confirmation |
| `watchlist_get` | Auto-opens panel, reads `[data-symbol-full]` rows, resolves ids |
| `watchlist_create` | Dedupes names, creates via dropdown → "Create new list…" |
| `watchlist_add` | Accepts `symbol` or `symbols`, dedupes, reports rejections |
| `watchlist_remove_symbol` | Clicks remove button, verifies row gone |
| `watchlist_delete` | Refuses flag-lists, handles confirmation dialog |
| `watchlist_rename` | Dropdown → "Rename", keyboard input |
| `watchlist_set` | **UPSERT** — creates if missing, diffs current vs desired symbols (by base ticker), adds/removes, reports `created` / `updated` / `unchanged` |

### CLI / Automation

- **`scripts/upsert-watchlists.js`** — Standalone CLI for idempotent 24-watchlist UPSERT from JSON.
  - Validates input schema, aggregates rejected symbols across lists, supports `--dry-run`.
  - Defaults to `data/watchlists.json`.

### Tests

- **Unit tests** (`tests/section2-unit.test.js`) — 26 tests covering timeout utilities, retry decorator, launch/restart source contracts.
- **Unit tests** (`tests/upsert-unit.test.js`) — 24 tests covering validateEntry, parseInput, aggregateReport, runUpsert, CLI contract.
- **Live integration tests** (`tests/live.test.js`) — Tier-2 health probe, watchlist open/idempotency, quote_get, data_get_ohlcv, data_get_study_values, batch_run, full watchlist CRUD lifecycle, tv_restart.
- **All 88 unit tests passing** (`npm run test:unit`).
