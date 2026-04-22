# Session resume — TradingView MCP darkice

**Last active:** 2026-04-23 ~07:10 AEDT
**Working directory:** `/Users/mattcrombie/Dev/Projects/mcp-servers/tradingview-mcp-darkice`
**Branch:** `main` — committed through `a508fcd` (Section 4 watchlist suite)
**Driver document:** `PRD.md`

---

## TL;DR — where to pick up

PRD Sections 2, 3, and **4** are all complete and **committed**. The 8-tool watchlist suite landed this session, along with the Claude Desktop test-feedback items: `quote_get` symbol-param bug is fixed (real temp-switch, not a mislabel), and `docs/timeout-evidence.md` gives the human tester concrete evidence that §2.1/§2.4/§2.6/§3.4 fire correctly.

The natural next move is the **24-watchlist UPSERT** (PRD §5.2) — now unblocked.

---

## Status matrix

| PRD Section | Status | Tests | Notes |
|---|---|---|---|
| 2.1 global timeout utility | ✅ done, committed `f420a8f` | 9 unit | `src/utils/timeout.js` |
| 2.2 shared async dep audit + transport hardening | ✅ done, committed `4a4d798` | covered live | `src/connection.js` per-call sub-timeout, stale-client retry |
| 2.3 enhanced tier-2 health check | ✅ done, committed `8af86b4` | 2 live | `src/core/health.js#healthCheck` |
| 2.4 withRetry decorator | ✅ done, committed `f420a8f` | 6 unit | `src/utils/retry.js` wraps 8 data handlers |
| 2.5 ui_open_panel watchlist fix | ✅ done, committed `ccbadcc` | 4 live | `src/core/ui.js` — `data-name="base"` |
| 2.6 tv_launch poll + clear error | ✅ done, committed `8af86b4` | 5 unit (source-level) | `src/core/health.js#launch` |
| **3.1 quote_get symbol-param fix** | ✅ **FIXED 2026-04-23**, committed `ffeb5fe` | 3 live (1 gated) | temp-switch-and-restore pattern |
| 3.2 data_get_ohlcv verification | ✅ done | 2 live | |
| 3.3 data_get_study_values verification | ✅ done | 1 live | |
| 3.4 batch_run verification | ✅ done | 1 live (gated) | disruptive — env-gated |
| **4.1 REST vs UI decision** | ✅ scouted, committed `7d2259f` | — | UI automation — no REST reachable |
| **4.2 + 4.3 watchlist suite (8 tools)** | ✅ done, committed `a508fcd` | 7 live (2 read, 5 gated write) | `src/core/watchlist.js` grew to 898 lines |
| 4.4 symbol handling (numeric-prefix ASX) | ✅ done | covered by add test | report rejection, don't abort |
| 5.1 manual test script phases 1-3 | ✅ encoded as live tests | — | 7 watchlist live tests |
| 5.2 24-watchlist UPSERT end-to-end | 🟡 unblocked, not run | — | **next logical step** |
| 6 code organisation | 🟡 flat (not nested) | — | scale-dependent — refactor later if needed |

---

## Commits this session (newest first)

```
a508fcd Add 8-tool watchlist management suite — PRD §4
7d2259f Add watchlist architecture scout — PRD §4.1 decision
8ee4890 Add timeout evidence doc + probe script for tester verification
ffeb5fe Fix quote_get symbol-param being silently ignored — PRD §3.1
74f5df1 Add PRD driver doc and session resume doc
2dafea9 Add tests for PRD §2 and §3 — 31 new tests
ccbadcc Fix ui_open_panel watchlist selector — PRD §2.5
8af86b4 Add tier-2 health probe and poll-based tv_launch — PRD §2.3 / §2.6
4a4d798 Harden CDP transport with sub-timeout + stale-client retry — PRD §2.2
f420a8f Add global tool timeout + retry wrappers — PRD §2.1 / §2.4
```

---

## Uncommitted items

```
?? .claude/                    # local settings — intentional, don't commit
?? scripts/probe-*.js          # 17 scout probe artefacts — safe to delete
```

The `scripts/probe-*.js` files were the scout's reproduction artefacts (see `docs/watchlist-scout.md` §Probe artefacts). The implementation agent wrote and deleted its own. If you don't want them cluttering the tree, `rm scripts/probe-*.js` is safe — all findings are captured in the scout doc.

---

## How to verify current state

```bash
cd /Users/mattcrombie/Dev/Projects/mcp-servers/tradingview-mcp-darkice

npm run test:unit           # 49 tests, no TV required
node scripts/probe-timeout.js   # §2.1/§2.4 evidence probe, no TV required
npm run test:live           # 11 tests, needs TV running (panel + read-only)

# Disruptive (with TV running) — includes chart-switch and watchlist mutations.
# Mutations are confined to __TEST_LIST__ and restore the user's originally-selected list.
TV_MCP_ALLOW_DISRUPTIVE_TESTS=1 npm run test:live
```

**Expected disruptive result:** 7 Section 4 tests pass + 1 quote_get symbol-switch test pass + 1 batch_run test pass = 9 write-path tests green. Whether the non-gated tests pass depends on the chart's starting state (chart must be on a liquid symbol with bars loaded — if TV is stuck on BATS:SLV or similar with no bars, 4 pre-existing non-watchlist tests will fail on "Could not extract OHLCV data").

### Pre-existing unrelated failures in `npm run test:all`

- `tests/e2e.test.js::ui_open_panel — open/close pine-editor` — TV removed `bottomWidgetBar.hideWidget`. Not in scope.
- `tests/e2e.test.js::replay_stop — return to realtime` — test-state pollution. Not in scope.

---

## Live test chart state — operational note

The live/disruptive tests read OHLCV from whatever chart TV is currently showing. If the chart is on a low-liquidity symbol with no bars loaded, `data_get_ohlcv` and `quote_get` (no-arg form) will error with "Could not extract OHLCV data. The chart may still be loading."

**Before running the disruptive suite:** point TV at something liquid. E.g. via a live MCP call:

```
chart_set_symbol({ symbol: 'ASX_DLY:STO' })   # or AAPL, SPY, NQ1!, anything with continuous bars
chart_set_timeframe({ timeframe: '1D' })
```

The `quote_get` symbol-switch test will work regardless of starting state — it explicitly chooses a non-matching test symbol and restores.

---

## Environment variables

| Env var | Default | Effect |
|---|---|---|
| `TV_MCP_TOOL_TIMEOUT_MS` | 15000 | Budget for any CDP-dependent tool handler |
| `TV_MCP_LAUNCH_TIMEOUT_MS` | 30000 | Budget specifically for `tv_launch` |
| `TV_MCP_EVAL_TIMEOUT_MS` | 10000 | Per-CDP-evaluate sub-timeout inside `connection.js` |
| `TV_MCP_ALLOW_DISRUPTIVE_TESTS` | `0` (unset) | Set to `1` to enable chart-navigating + watchlist-mutating tests |

---

## MCP client configs — pointed at this repo

Same as previous session:

- **Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`. Backup: `claude_desktop_config.json.bak-20260422-165417`.
- **Claude Code user scope** — `~/.claude.json`. `claude mcp list` → `tradingview: … - ✓ Connected`.

**⚠️ After this session's commits, Claude Desktop needs a full quit+relaunch** to pick up the 8 new watchlist tools in the manifest.

---

## Addressing Claude Desktop test feedback (2026-04-23) — item-by-item

Received that morning: `TradingView MCP — Test Feedback (2026-04-23)`. Response:

| Tester feedback | Status |
|---|---|
| ✅ tv_health_check data_pipeline_healthy — already working | confirmed, no change needed |
| ✅ data_get_ohlcv — already working | confirmed |
| ✅ data_get_study_values — already working | confirmed |
| ✅ ui_open_panel watchlist idempotent — already working | confirmed |
| ✅ watchlist_get opens panel automatically | confirmed (was §2.5 fix) |
| 🐛 quote_get silently ignores symbol param | **FIXED** (commit `ffeb5fe`, temp-switch pattern, 3 live tests) |
| ❌ 8-tool watchlist suite missing | **BUILT** (commit `a508fcd`, 7 live tests) |
| 📋 §2.1 verify timeout fires | `docs/timeout-evidence.md` + `scripts/probe-timeout.js` |
| 📋 §2.4 verify retry fires | same doc + probe script |
| 📋 §2.6 verify tv_launch fails within 30s | same doc, 5 source-level unit tests |
| 📋 §3.4 verify batch_run works | same doc, 1 live gated test |

---

## What's left (truly) — the 24-watchlist UPSERT

PRD §5.2. The 8-tool suite makes this one call per watchlist:

```js
for (const { name, symbols } of THE_24_LISTS) {
  await watchlist_set({ name, symbols });
}
```

- Expected happy-path result: ~24 × ~15s = ~6 minutes wall clock.
- Numeric-prefix ASX tickers (`ASX:29M`, `ASX:360`, `ASX:5GG`) will land in `rejected` for each call they appear in. `watchlist_add` already handles this per-symbol without aborting the batch.
- Recommend: capture the aggregated rejected set across all 24 calls so you know exactly which symbols TV won't accept, then manually investigate alternatives or document the limitation.

The list of 24 source-of-truth watchlists + their symbols isn't in this repo — the user (or a kickoff prompt) needs to supply them. The tool call pattern is the same regardless.

---

## Scope-adjacent follow-up — scanner REST quote fast-path

`docs/watchlist-scout.md` found that `POST https://scanner.tradingview.com/global/scan` is unauthenticated and returns per-symbol OHLCV for arbitrary tickers. The current `quote_get` temp-switches the chart to answer — correct but briefly disruptive. A future enhancement could use the scanner endpoint as a fast-path, falling back to temp-switch when scanner returns no data.

Not in scope for today. Logged here for future-you.

---

## Pattern conventions (reference for future work)

1. **Tool registration:** every new tool in `src/tools/*.js` wrapped with
   `withToolTimeout(withRetry(() => core.fn(args), name), name)` — belt-and-braces timeout + retry.
2. **Core functions throw on failure.** Never return `{ success: false }` from core. The tool wrap catches and converts to response envelope.
3. **Tests split:** `tests/section*-unit.test.js` → `test:unit` (CI-safe); `tests/live.test.js` → `test:live` (requires TV, includes mandatory top-level `after()` hook to disconnect CDP, see memory `project_test_cdp_teardown.md`).
4. **Disruptive tests gated** behind `TV_MCP_ALLOW_DISRUPTIVE_TESTS=1`. Always restore original state in `after()`.
5. **Selectors:** `data-name`, `aria-label`, `data-symbol-full`, structural parent queries. Never hashed class names like `wrap-IEe5qpW4` — use `[class*="invalid"]` substring matchers if no stable alternative.
6. **MCP stdio safety:** retry / diagnostic notices go to `process.stderr.write(...)` only. `stdout` is the protocol channel.

---

## File index — current state

```
src/
  connection.js                  ← CDP transport (§2.2)
  server.js                      ← MCP registrations + startup banner
  wait.js                        ← waitForChartReady helper
  utils/
    timeout.js                   ← withTimeout + env config (§2.1)
    retry.js                     ← withRetry decorator (§2.4)
  core/
    data.js                      ← data tools + quote_get fix (§3.1)
    health.js                    ← tier-2 probe + launch (§2.3/§2.6)
    ui.js                        ← openPanel watchlist fix (§2.5)
    chart.js                     ← setSymbol, setTimeframe, getState
    watchlist.js                 ← 898 lines — 8-tool suite (§4)
    ...
  tools/
    data.js                      ← wraps withToolTimeout + withRetry
    batch.js                     ← scaled timeout budget
    health.js                    ← withLaunchTimeout
    watchlist.js                 ← 9 tool registrations
    ...

tests/
  section2-unit.test.js          ← 20 unit tests for §2.1/§2.4/§2.6
  live.test.js                   ← 19 live tests total (read-only + gated write)

docs/
  timeout-evidence.md            ← §2.1/§2.4/§2.6/§3.4 tester evidence
  watchlist-scout.md             ← §4.1 architecture decision + findings

scripts/
  probe-timeout.js               ← §2.1/§2.4 runnable probe (committed)
  probe-*.js (17 files)          ← scout artefacts — uncommitted, safe to delete

PRD.md                           ← the spec
resume.md                        ← this file
```

---

## Memory (~/.claude/projects/…/memory/)

- `project_reference_work.md` — this work is reference material for another MCP
- `project_test_cdp_teardown.md` — live test files need top-level `after()` to disconnect CDP singleton

Neither needs updating — both patterns still hold.
