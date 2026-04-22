# Session resume — TradingView MCP darkice

**Last active:** 2026-04-22 ~20:17 AEDT
**Working directory:** `/Users/mattcrombie/Dev/Projects/mcp-servers/tradingview-mcp-darkice`
**Branch:** `main` (no commits yet — everything below is uncommitted)
**Driver document:** `PRD.md` (read this first if context is fresh)

---

## TL;DR — where to pick up

PRD Sections 2 (infrastructure) and 3 (data tool verification) are **complete and tested — not committed**. PRD Section 4 (the 8-tool watchlist suite) has not started. The right next move is:

1. `git status` + skim `resume.md` (this file).
2. Decide: **commit the Section 2+3 work first** (recommended), then start Section 4.
3. Start Section 4 with a scout agent (architecture probe: REST vs UI, see PRD §4.1).

---

## Status matrix

| PRD Section | Status | Tests | Notes |
|---|---|---|---|
| 2.1 global timeout utility | ✅ done | 9 unit | `src/utils/timeout.js` |
| 2.2 shared async dep audit + transport hardening | ✅ done | covered by live regression | `src/connection.js` per-call sub-timeout, stale-client retry |
| 2.3 enhanced tier-2 health check | ✅ done | 2 live | `src/core/health.js#healthCheck` |
| 2.4 withRetry decorator | ✅ done | 6 unit | `src/utils/retry.js` wraps 8 data handlers |
| 2.5 ui_open_panel watchlist fix | ✅ done | 4 live | `src/core/ui.js` — `data-name="base"` |
| 2.6 tv_launch poll + clear error | ✅ done | 5 unit (source-level) | `src/core/health.js#launch` |
| 3.1 quote_get verification | ✅ done | 2 live | |
| 3.2 data_get_ohlcv verification | ✅ done | 2 live | |
| 3.3 data_get_study_values verification | ✅ done | 1 live | |
| 3.4 batch_run verification | ✅ done | 1 live (gated) | disruptive — env-gated |
| **4.1–4.4 watchlist suite (8 new tools)** | ❌ not started | — | see "Open work" below |
| 5 testing requirements | 🟡 partial | phase 1–2 covered; phase 3 (write-path) blocked on §4 | |
| 6 code organisation | 🟡 followed for new files | — | |

---

## Uncommitted changes

Run `git status` to see current state. At snapshot time:

```
 M package.json                   (new test:* scripts)
 M src/connection.js              (transport hardening — §2.2)
 M src/core/data.js               (root-cause doc comment — §2.2)
 M src/core/health.js             (tier-2 probe §2.3 + launch rewrite §2.6)
 M src/core/ui.js                 (watchlist selector fix §2.5)
 M src/server.js                  (startup banner shows timeout values — §2.1)
 M src/tools/batch.js             (scaled timeout budget — §2.1)
 M src/tools/data.js              (withToolTimeout + withRetry wraps — §2.1/§2.4)
 M src/tools/health.js            (withLaunchTimeout — §2.1)
?? PRD.md                         (source of truth for this whole effort)
?? src/utils/                     (NEW — timeout.js + retry.js)
?? tests/live.test.js             (NEW — §2.3, §2.5, §3.1–§3.4)
?? tests/section2-unit.test.js    (NEW — §2.1, §2.4, §2.6 unit tests)
```

**Suggested commit plan** (if you want small, reviewable commits):

```
git add src/utils/timeout.js src/server.js src/tools/data.js src/tools/batch.js src/tools/health.js
git commit -m "Section 2.1: global tool timeout utility with env-var config"

git add src/connection.js src/core/data.js
git commit -m "Section 2.2: CDP transport sub-timeout + stale-client auto-reattach"

git add src/core/health.js
git commit -m "Section 2.3+2.6: tier-2 health probe and tv_launch poll hardening"

git add src/utils/retry.js src/tools/data.js   # retry uses src/tools/data.js too — if already staged, just add retry.js
git commit -m "Section 2.4: explicit withRetry decorator at tool-handler layer"

git add src/core/ui.js
git commit -m "Section 2.5: fix ui_open_panel watchlist selector (data-name=base)"

git add tests/section2-unit.test.js tests/live.test.js package.json
git commit -m "Tests for PRD Section 2 + 3 — 31 new tests, all passing"

git add PRD.md resume.md
git commit -m "Add PRD and session resume doc"
```

(`git stash` is blocked on this machine for safety — commit first before any stash ops.)

---

## How to verify current state after restarting

```bash
cd /Users/mattcrombie/Dev/Projects/mcp-servers/tradingview-mcp-darkice
npm run test:unit      # 54 tests, no TV required
npm run test:live      # 11 tests, needs TV running
npm run test:all       # 139 total (2 pre-existing e2e failures — see below)
```

**Expected result:** 137/139 pass. The 2 known pre-existing failures in `tests/e2e.test.js` are:

1. `ui_open_panel — open/close pine-editor` (line 1042) — calls `window.TradingView.bottomWidgetBar.hideWidget('pine-editor')` directly. TV removed that method from the `bottomWidgetBar` API in a recent version. **Not in our scope.** To fix: the test needs to exercise `core.openPanel` instead (already works — our new `tests/live.test.js` has 4 passing panel tests).
2. `replay_stop — return to realtime` (line 1237) — test state pollution. A prior test left TV replay in a state where `stopReplay()` throws "Replay is not started". **Not in our scope.** To fix: either reorder the test or guard with `try/catch`.

---

## Live test context / safety notes

- **TradingView Desktop** is expected to be running on `localhost:9222` for `tests/live.test.js`. Last session chart was `ASX_DLY:STO`, 60-min resolution.
- **Disruptive tests are gated.** `tests/live.test.js` includes a `Section 3.4 batch_run` test that navigates the chart. It is skipped by default. Enable with `TV_MCP_ALLOW_DISRUPTIVE_TESTS=1 npm run test:live`. It restores original symbol + timeframe in `after()`.
- **DO NOT run `core.launch()` or `tv_launch` directly** while your live TV session is active — default `kill_existing: true` will kill your chart and destroy the test context. Section 2.6's verification is source-level only for this reason.

---

## Environment variables introduced

| Env var | Default | Effect |
|---|---|---|
| `TV_MCP_TOOL_TIMEOUT_MS` | 15000 | Budget for any CDP-dependent tool handler |
| `TV_MCP_LAUNCH_TIMEOUT_MS` | 30000 | Budget specifically for `tv_launch` |
| `TV_MCP_EVAL_TIMEOUT_MS` | 10000 | Per-CDP-evaluate sub-timeout inside `connection.js` |
| `TV_MCP_ALLOW_DISRUPTIVE_TESTS` | `0` (unset) | Set to `1` to enable chart-navigating tests |

Startup banner prints the first two (stderr, doesn't interfere with MCP stdio).

---

## MCP client configs — already pointed at this repo

Done in the previous session:

- **Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
  `tradingview` → `node /Users/mattcrombie/Dev/Projects/mcp-servers/tradingview-mcp-darkice/src/server.js`
  Backup: `claude_desktop_config.json.bak-20260422-165417`
  **Requires a full Claude Desktop quit+relaunch** for changes to take effect.
- **Claude Code user scope** (`~/.claude.json`):
  `tradingview` entry added via `claude mcp add --scope user`.
  `claude mcp list` → `tradingview: … - ✓ Connected`.
  Picked up automatically in new Claude Code sessions.

The previous `tradingview-mcp-jackson` path is no longer referenced.

---

## Open work — PRD Section 4 (the big one)

8 new tools to implement:

- `watchlist_list` — enumerate all watchlists with IDs, names, counts
- `watchlist_select` — switch active watchlist by name or ID
- `watchlist_get` — **refactor** existing: auto-open panel, include name + id
- `watchlist_create` — new watchlist with optional initial symbols
- `watchlist_add` — **audit + harden** existing: batch support, reject reasons, dedup
- `watchlist_remove_symbol` — single or batch removal
- `watchlist_delete` — by name or id, no fuzzy matching
- `watchlist_rename` — rename watchlist
- `watchlist_set` — **UPSERT workhorse**: idempotent create-or-update-symbols

### Architectural question (PRD §4.1)

Before implementing: **REST API vs UI automation**. PRD says prefer REST if viable. `window.TV_WATCHLISTS_URL` is present but was observed empty — needs live probing. Fallback is CDP UI automation via DOM + React fiber.

**Recommended first move:** scout-then-dispatch pattern (per the project memory about reference-MCP patterns):

1. **Scout agent** — task: probe live TV for REST endpoints via CDP `Network.enable` + `Network.requestWillBeSent` while clicking around the watchlist UI. Also probe `window.TV_WATCHLISTS_URL`, session cookies, etc. Deliverable: a decision doc recommending REST or UI, with evidence.
2. **Architecture decision** — PRD says "**Ask me before making any architectural decision not covered by the PRD**". The PRD gives a preference but leaves the final call to the scout's findings. **Pause for user review after the scout before dispatching implementation agents.**
3. **Implementation agents** — 2–3 parallel developer agents once the architecture is decided. Good decomposition candidates:
   - Agent A: read-path tools (`watchlist_list`, `watchlist_get`, `watchlist_select`)
   - Agent B: write-path basic tools (`watchlist_create`, `watchlist_add` refactor, `watchlist_remove_symbol`, `watchlist_delete`, `watchlist_rename`)
   - Agent C: `watchlist_set` (UPSERT — depends on A + B outputs so must run AFTER them)
4. **Tests along the way** — extend `tests/live.test.js` with a new describe per tool.

### Known dangerous edge cases (from PRD §4.4)

- Numeric-prefix ASX tickers (`ASX:29M`, `ASX:360`, `ASX:5GG`) may be rejected by TV's symbol lookup. Report rejections, don't abort the batch.
- CSS class hashes like `__KRxuOy` WILL change between TV versions — never hardcode them. Use `data-name`, `aria-label`, structural selectors.
- Refuse to operate on watchlists the user didn't ask about (the user has personal watchlists alongside the 24-list ASX source of truth — don't mutate those).
- `__TEST_LIST__` is the agreed test-list name for manual verification (PRD §5.1).

---

## Pattern conventions established this run (reference for Section 4 & beyond)

The user said this work is being captured as a reference for another MCP, so these patterns matter:

1. **Parallel sub-agent dispatch:** single message with multiple `Agent` tool calls, same tree when file-overlap is zero, worktrees only when overlap is real. Forbid sub-agents from running `npm test` concurrently against shared CDP — orchestrator runs the suite once centrally.
2. **Sub-agent prompt shape:** scope → files → behaviour → acceptance criteria → work plan → do-NOT → report-back-with. Tell the agent to embed live probes (CDP DOM, network) to verify PRD claims against current TV before hardcoding selectors.
3. **Test file split:**
   - `tests/section*-unit.test.js` — pure unit, goes into `test:unit`.
   - `tests/live.test.js` — CDP-requiring, gracefully skips via top-level CDP probe + `describe({ skip: … })`, goes into `test:live`. **Must include top-level `after()` that calls `disconnect()`** or node --test hangs forever (see `memory/project_test_cdp_teardown.md`).
4. **Disruptive tests** — gate behind `TV_MCP_ALLOW_DISRUPTIVE_TESTS=1`. Always restore original chart state in `after()`.

---

## File index — what's where

```
src/
  connection.js                  ← CDP transport, per-call timeout + retry (§2.2)
  server.js                      ← MCP registrations + startup banner
  utils/
    timeout.js                   ← NEW — withTimeout + env config (§2.1)
    retry.js                     ← NEW — withRetry decorator (§2.4)
  core/
    data.js                      ← data tools + §2.2 root-cause header comment
    health.js                    ← tier-2 probe (§2.3) + launch (§2.6)
    ui.js                        ← openPanel watchlist fix (§2.5)
    watchlist.js                 ← current (partial) watchlist impl — will be RESTRUCTURED for §4
    ...
  tools/
    data.js                      ← wraps with withToolTimeout + withRetry
    batch.js                     ← scaled timeout budget
    health.js                    ← withLaunchTimeout on tv_launch
    watchlist.js                 ← current (2-tool) impl — will be EXPANDED for §4
    ...

tests/
  cli.test.js                    ← existing
  pine_analyze.test.js           ← existing
  e2e.test.js                    ← existing (2 known-broken tests, pre-existing)
  section2-unit.test.js          ← NEW — §2.1, §2.4, §2.6 (20 tests)
  live.test.js                   ← NEW — §2.3, §2.5, §3.1–§3.4 (11 tests)

PRD.md                           ← the spec this whole effort is implementing
resume.md                        ← this file
```

---

## Memory (~/.claude/projects/…/memory/)

Already saved:

- `project_reference_work.md` — this work is reference material for another MCP project; verbose rationale and polished patterns matter here
- `project_test_cdp_teardown.md` — live test files need top-level `after()` hook to disconnect CDP singleton, otherwise node --test hangs

---

## One small thing that might need attention later

In `src/tools/data.js` the user / linter intentionally set the retry wraps the way they are — don't revert. Notable: `depth_get`, `data_get_strategy_results`, `data_get_trades`, `data_get_equity` are deliberately NOT wrapped in `withRetry` because their "not found" errors are clean application errors, not transport failures.
