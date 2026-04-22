# TradingView MCP — Dark Ice Enhancement PRD
**Repo:** `darkiceinteractive/tradingview-mcp-darkice`
**Upstream:** `LewisWJackson/tradingview-mcp-jackson`
**Target runtime:** TradingView Desktop (macOS) via CDP port 9222
**Date:** 2026-04-22
**Status:** Claude Code kickoff document — implement everything in this PRD

---

## 0. How to Use This PRD

This is a complete implementation spec. Read the entire document before touching any code.
Work top-down: Infrastructure fixes first (Section 2), then data tool fixes (Section 3),
then the watchlist suite (Section 4). Each section includes acceptance criteria — do not
mark a section done until all criteria pass.

---

## 1. Current State Audit

### 1.1 What Works
| Tool | Status | Notes |
|------|--------|-------|
| `tv_health_check` | ✅ Working | Returns connection state quickly |
| `tv_discover` | ✅ Working | Returns available API paths |
| `chart_get_state` | ✅ Working | Reads from internal cached state, no live CDP data extraction |
| `watchlist_get` | ⚠️ Partial | Returns empty when watchlist panel is closed; no panel-open fallback |
| `watchlist_add` | ⚠️ Untested | Symbol rejection behaviour for numeric-prefix tickers unknown |
| `ui_evaluate` | ✅ Working | JavaScript evaluation works when connection is stable |

### 1.2 What Times Out (4-minute hang, no result)
| Tool | Symptom |
|------|---------|
| `quote_get` | Hangs regardless of symbol param |
| `data_get_study_values` | Hangs on every call |
| `data_get_ohlcv` | Hangs with both `summary: true` and default params |
| `batch_run` | Hangs with `get_ohlcv` action |
| `tv_launch` | Hangs when TradingView is not already running |
| `ui_open_panel` (watchlist) | Returns "Button not found" — wrong selector used |

### 1.3 What's Missing Entirely
| Tool | Required For |
|------|-------------|
| `watchlist_list` | Enumerate all watchlists by name + ID |
| `watchlist_create` | Create a new named watchlist |
| `watchlist_select` | Switch active watchlist by name or ID |
| `watchlist_remove_symbol` | Remove a single symbol from active watchlist |
| `watchlist_delete` | Delete an entire watchlist |
| `watchlist_set` | Idempotent UPSERT — set exact symbol list |
| `watchlist_rename` | Rename an existing watchlist |

---

## 2. Infrastructure Fixes (Do This First)

### 2.1 Global Tool Timeout

**Problem:** All data tools that require live CDP round-trips hang for 4 minutes with no output.
A 4-minute silent hang is worse UX than an immediate error — it blocks the entire MCP client.

**Fix:** Wrap every CDP-dependent tool call in a `Promise.race` against a configurable timeout.

```typescript
// Suggested utility — add to src/utils/timeout.ts or equivalent
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  toolName: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(
        `[${toolName}] Timed out after ${ms}ms. ` +
        `Check that TradingView Desktop is in the foreground and CDP is connected. ` +
        `Run tv_health_check to diagnose.`
      ));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
```

**Configuration:**
- Default timeout: **15 000 ms** for all data tools
- Timeout should be configurable via env var `TV_MCP_TOOL_TIMEOUT_MS`
- `tv_health_check`, `tv_discover`, `chart_get_state` are exempt (they have their own fast-fail logic)
- `tv_launch` gets a separate **30 000 ms** timeout (app startup is slower)

**Acceptance criteria:**
- [ ] `quote_get` with no TradingView running returns error within 15s
- [ ] Error message includes tool name, timeout duration, and remediation hint
- [ ] Timeout value is logged at server startup

---

### 2.2 Shared Async Dependency Audit

**Problem:** `quote_get`, `data_get_study_values`, and `data_get_ohlcv` all time out while
`chart_get_state` works. This strongly suggests a **single shared broken dependency** in the
data extraction path, not three independent bugs.

**Investigation tasks:**
1. Find what `quote_get`, `data_get_study_values`, and `data_get_ohlcv` share in their call path that `chart_get_state` does NOT use. Candidates:
   - A shared CDP session object that was initialised once and never refreshed
   - A shared `Page` or `CDPSession` reference that goes stale after tab navigation
   - A `waitForSelector` or `waitForFunction` promise that never resolves because TV's DOM changed
   - A `Runtime.evaluate` call that blocks on a promise that never settles
2. Check whether these tools call any shared initialiser/setup function before their main logic
3. Check if there's a `dataWindow` or `studyValues` DOM selector they're all querying that no longer exists

**Fix:** Once the root cause is identified, patch it. If it's a stale CDP session:

```typescript
// Pattern: Re-acquire the CDP session on each data tool call
async function getActivePage(): Promise<Page> {
  const pages = await browser.pages();
  const tvPage = pages.find(p => p.url().includes('tradingview.com'));
  if (!tvPage) throw new Error('TradingView tab not found. Is TradingView Desktop running?');
  return tvPage;
}
```

**Acceptance criteria:**
- [ ] `quote_get` returns a price for `ASX:CBA` within 15s with TV in foreground
- [ ] `data_get_ohlcv` returns OHLCV data for the active chart within 15s
- [ ] Root cause is documented in a comment in the relevant source file

---

### 2.3 Enhanced Health Check

**Problem:** `tv_health_check` confirms the CDP *connection* is alive but does NOT confirm the
*data pipeline* is working. You can have a healthy health check and all data tools timing out
simultaneously — as we observed.

**Fix:** Add a two-tier health check:

```typescript
// Tier 1 (existing): CDP connection alive?
// Tier 2 (new): Can we actually extract live data?

// tv_health_check should now return:
{
  cdp_connected: boolean,         // existing
  target_id: string,              // existing
  chart_symbol: string,           // existing
  api_available: boolean,         // existing
  data_pipeline_healthy: boolean, // NEW — result of a lightweight test read
  data_pipeline_latency_ms: number, // NEW — how long the test read took
  data_pipeline_error?: string,   // NEW — if unhealthy, why
}
```

**Lightweight test read:** Evaluate `document.querySelector('.chart-container') !== null` or
similar — something that requires a live round-trip to the page but is guaranteed to resolve
quickly if the data pipeline is working.

**Acceptance criteria:**
- [ ] `tv_health_check` returns `data_pipeline_healthy: true` when TV is in foreground
- [ ] `tv_health_check` returns `data_pipeline_healthy: false` with a reason when TV is backgrounded or data tools are broken
- [ ] Tier 2 check completes within 3s (it has its own sub-timeout)

---

### 2.4 Auto-Retry with CDP Re-attach

**Problem:** When the TradingView tab navigates or TV is briefly backgrounded, the CDP session
can go stale. Currently the server just hangs forever. It should re-attach and retry once.

**Fix:** Wrap data tool handlers with a retry decorator:

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  toolName: string,
  maxAttempts = 2
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.error(`[${toolName}] Attempt ${attempt} failed: ${err}. Re-attaching CDP...`);
      await reattachCDP(); // re-find the TV tab and reconnect
    }
  }
  throw new Error('unreachable');
}
```

**Acceptance criteria:**
- [ ] If a data tool fails on first attempt, it re-attaches and retries once automatically
- [ ] If retry also fails, error is surfaced to the caller (not another 4-min hang)
- [ ] Re-attach attempt is logged clearly

---

### 2.5 Fix `ui_open_panel` for Watchlist

**Problem:** `ui_open_panel({ panel: 'watchlist' })` returns "Button not found for panel: watchlist".

**Root cause:** The right sidebar "Watchlist, details, and news" button uses
`data-name="base"` not `data-name="watchlist"`. The panel open logic is using the wrong selector.

**Fix:**

```typescript
// In the panel → selector mapping, add:
'watchlist': '[data-name="base"][aria-label="Watchlist, details, and news"]',

// The open logic should:
// 1. Find the button using the correct selector
// 2. Check aria-pressed — if already "true", panel is already open, skip click
// 3. Click if not open
// 4. Wait up to 2s for .widgetbar-widgetbody to have non-empty content
```

**Acceptance criteria:**
- [ ] `ui_open_panel({ action: 'open', panel: 'watchlist' })` succeeds and the watchlist body is populated
- [ ] Calling it when already open is a no-op (idempotent)

---

### 2.6 Fix `tv_launch` Timeout

**Problem:** `tv_launch` hangs indefinitely when TradingView is not already running.

**Investigation:** Check whether the tool is using `child_process.spawn` or `exec` and whether
it's awaiting a promise that never resolves (e.g. waiting for a port to be available with no timeout).

**Fix:**
- Apply the 30s timeout from Section 2.1
- After spawning the process, poll `http://localhost:9222/json` every 500ms until it responds or timeout
- If timeout is hit, surface a clear error: "TradingView did not start within 30s. Try launching it manually with --remote-debugging-port=9222"

**Acceptance criteria:**
- [ ] `tv_launch` either succeeds within 30s or fails with a clear error
- [ ] Does not hang indefinitely under any circumstances

---

## 3. Data Tool Fixes

After completing Section 2 (especially the shared dependency audit), verify each tool below.

### 3.1 `quote_get`
- Should return bid/ask/last/volume for a given symbol
- Test with: `ASX:CBA`, `ASX:BHP`
- Must complete within 15s
- If symbol not found, return a clear error (not a hang)

### 3.2 `data_get_ohlcv`
- Should return OHLCV bar data for the active chart
- Test with: `{ summary: true }` then `{ count: 5 }`
- Must complete within 15s

### 3.3 `data_get_study_values`
- Should return current indicator values from the data window
- Test with no indicators applied (should return empty/zero values, not hang)
- Must complete within 15s

### 3.4 `batch_run`
- Should run an action across multiple timeframes
- Test with: `{ action: 'get_ohlcv', symbols: ['ASX:CBA'], timeframes: ['1D'] }`
- Must complete within 60s (batch has a higher timeout — individual tool timeout × number of calls)

---

## 4. Watchlist Management Suite (New Feature)

This is the primary new capability. Implement all tools listed below.

### 4.1 Architecture Decision: REST API vs UI Automation

**Preferred approach: TradingView REST API**

TradingView Desktop exposes internal REST endpoints for watchlist management. The global
`window.TV_WATCHLISTS_URL` is present in the page context (observed value was empty string,
suggesting it might be populated lazily or after auth). Investigate:

```javascript
// In ui_evaluate, probe for the REST API:
window.TV_WATCHLISTS_URL
// Also check network requests made when switching watchlists — use CDP's Network domain
// Expected endpoints pattern (from TradingView web):
// GET  /api/v1/symbols_history/
// GET  /watchlists/          -- or similar
// POST /watchlists/
// PUT  /watchlists/{id}/
// DELETE /watchlists/{id}/
```

To capture the actual endpoints: use CDP's `Network.enable` + `Network.requestWillBeSent` to
intercept requests made when the user manually switches watchlists in the UI. Decode the auth
cookie from the TradingView tab session to make authenticated API calls.

**Fallback approach: UI automation via CDP JavaScript evaluation**

If the REST API approach is not viable (auth is too complex, endpoints are undocumented):
- Drive all watchlist operations via `Runtime.evaluate` in the TV tab
- Use the React fiber tree to read data
- Use DOM button clicks + keyboard events to create/rename/delete
- This is more brittle but functional

**Implementation must choose one approach and be consistent.** Document the chosen approach
in a comment at the top of the watchlist module.

---

### 4.2 Internal Data Structures

From our investigation, the current watchlist state is accessible via:

```javascript
// Current watchlist name
document.querySelector('.titleRow-mQBvegEO')?.textContent

// Watchlist dropdown button
document.querySelector('[data-name="watchlists-button"]')

// Current symbols (via React fiber)
// el = document.querySelector('.watchlist-__KRxuOy')
// fiber = el.__reactFiber$... (key changes with TV version)
// Walk fiber.return chain looking for memoizedProps.symbols array
```

**IMPORTANT:** CSS class names like `__KRxuOy`, `mQBvegEO` are CSS modules hashes and WILL
change between TradingView versions. Do not hardcode them. Instead:
- Use stable selectors: `data-name`, `aria-label`, `role` attributes
- Use structural selectors: `.widgetHeader-*`, `.widgetbar-widget-watchlist`
- Detect the actual class names at runtime by querying known stable ancestors

---

### 4.3 Tool Specifications

#### `watchlist_list`
```
Returns all watchlists (public and private) with their IDs, names, and symbol counts.
```
**Parameters:** none

**Returns:**
```json
{
  "success": true,
  "watchlists": [
    { "id": "abc123", "name": "ASX_GOLD_SILVER", "count": 15, "type": "public" },
    { "id": "def456", "name": "My Watchlist", "count": 5, "type": "private" }
  ],
  "active_id": "abc123",
  "active_name": "ASX_GOLD_SILVER"
}
```

**Implementation notes:**
- Click the `[data-name="watchlists-button"]` dropdown and read the rendered list items
- Or use REST API if available
- Must ensure watchlist panel is open before attempting (auto-open if closed)

---

#### `watchlist_select`
```
Switches the active watchlist by name or ID.
```
**Parameters:**
- `name: string` — exact watchlist name (case-sensitive) OR
- `id: string` — watchlist ID

**Returns:**
```json
{
  "success": true,
  "selected": { "id": "abc123", "name": "ASX_GOLD_SILVER" },
  "previous": { "id": "def456", "name": "My Watchlist" }
}
```

**Error cases:**
- Watchlist not found → `{ success: false, error: "Watchlist 'XYZ' not found. Available: [...]" }`

---

#### `watchlist_get` (fix existing)
```
Returns all symbols in the currently active watchlist.
```
**Fix required:**
- Currently returns empty when panel is closed
- Must auto-open the panel if closed, then read symbols
- Return the watchlist name alongside the symbols

**Returns:**
```json
{
  "success": true,
  "name": "ASX_GOLD_SILVER",
  "id": "abc123",
  "count": 15,
  "symbols": ["ASX:NST", "ASX:EVN", "ASX:RMS"]
}
```

---

#### `watchlist_create`
```
Creates a new empty watchlist with the given name and optionally populates it with symbols.
```
**Parameters:**
- `name: string` — exact name to use (case-sensitive, no transformation)
- `symbols?: string[]` — optional initial symbol list
- `type?: 'public' | 'private'` — default `'public'`

**Returns:**
```json
{
  "success": true,
  "id": "new123",
  "name": "ASX_BANKS_FINANCIALS",
  "symbols_added": 8,
  "rejected": []
}
```

**Error cases:**
- Name already exists → `{ success: false, error: "Watchlist 'ASX_BANKS_FINANCIALS' already exists. Use watchlist_set to update it." }`

**Implementation notes:**
- Use the "+" / "New watchlist" button in the watchlist dropdown UI
- After creation, rename it to the exact target name
- Then add symbols one by one via `watchlist_add` (or batch via REST)

---

#### `watchlist_add` (audit + harden existing)
```
Adds one or more symbols to the currently active watchlist.
```
**Current issues to fix:**
- Unknown behaviour when symbol has leading digit (e.g. `ASX:29M`, `ASX:360`, `ASX:5GG`)
- Unknown behaviour when symbol already exists in list (should be idempotent, not duplicate)
- No clear error when symbol is rejected by TV

**Fix:**
- Accept `symbol: string` (single) OR `symbols: string[]` (batch)
- Return per-symbol result including rejected symbols with reason
- Detect duplicates before adding (read current list, skip if already present)

**Returns:**
```json
{
  "success": true,
  "added": ["ASX:CBA", "ASX:NAB"],
  "skipped_duplicates": ["ASX:ANZ"],
  "rejected": [{ "symbol": "ASX:29M", "reason": "Symbol not accepted by TradingView" }]
}
```

---

#### `watchlist_remove_symbol`
```
Removes one or more symbols from the currently active watchlist.
```
**Parameters:**
- `symbol: string` OR `symbols: string[]`

**Returns:**
```json
{
  "success": true,
  "removed": ["ASX:NST"],
  "not_found": ["ASX:XYZ"]
}
```

**Implementation notes:**
- Right-click on symbol row → "Remove from watchlist" context menu, OR
- Use REST API DELETE if available, OR
- Delete entire watchlist and recreate without the removed symbols (last resort — note this in response)

---

#### `watchlist_delete`
```
Deletes an entire watchlist by name or ID.
```
**Parameters:**
- `name: string` OR `id: string`

**Safety check:** Refuse to delete if name does not match any watchlist (no fuzzy matching).

**Returns:**
```json
{
  "success": true,
  "deleted": { "id": "abc123", "name": "ASX_BANKS_FINANCIALS" }
}
```

---

#### `watchlist_rename`
```
Renames a watchlist.
```
**Parameters:**
- `name: string` — current name
- `new_name: string` — target name

**Returns:**
```json
{
  "success": true,
  "old_name": "My Watchlist",
  "new_name": "ASX_PERSONAL"
}
```

---

#### `watchlist_set` (new — the UPSERT workhorse)
```
Idempotent UPSERT: sets the exact symbol list for a watchlist.
Creates the watchlist if it doesn't exist. Adds missing symbols and removes extras.
Safe to re-run — produces the same result regardless of starting state.
```
**Parameters:**
- `name: string` — watchlist name (case-sensitive, created if missing)
- `symbols: string[]` — exact desired symbol list (order not guaranteed)
- `type?: 'public' | 'private'` — only used on creation, default `'public'`

**Returns:**
```json
{
  "success": true,
  "name": "ASX_GOLD_SILVER",
  "status": "created" | "updated" | "unchanged",
  "added": ["ASX:BGL", "ASX:RED"],
  "removed": [],
  "rejected": [],
  "final_count": 15
}
```

**Algorithm:**
```
1. GET all watchlists via watchlist_list
2. IF name not found:
   a. CREATE watchlist with given name
   b. ADD all symbols → done
3. IF name found:
   a. SELECT the watchlist
   b. GET current symbols
   c. Compute: to_add = desired - current; to_remove = current - desired
   d. IF to_add is empty AND to_remove is empty → return status: "unchanged"
   e. ADD to_add symbols (skip if already present)
   f. REMOVE to_remove symbols
   g. Return status: "updated" with diff summary
```

---

### 4.4 Symbol Handling

**ASX prefix:** All symbols in the 24-watchlist source-of-truth use `ASX:` prefix.
The tools must accept symbols both with and without the prefix and normalise:
- `CBA` → `ASX:CBA`  (if the watchlist context implies ASX — document this behaviour)
- `ASX:CBA` → `ASX:CBA` (pass-through)
- Do not auto-prefix non-ASX symbols (user passes `NASDAQ:AAPL`, keep it as-is)

**Numeric-prefix tickers:** `ASX:29M`, `ASX:360`, `ASX:5GG` may fail in TradingView's symbol
lookup. Test each of these. If they fail:
- Log the rejection with the TradingView error message
- Continue with remaining symbols (do not abort the batch)
- Report rejected symbols in the tool response

---

## 5. Testing Requirements

### 5.1 Manual Test Script

After implementation, run the following sequence and verify each step:

```
# Phase 1: Infrastructure
1. tv_health_check → assert data_pipeline_healthy: true
2. quote_get(ASX:CBA) → assert price returned within 15s
3. data_get_ohlcv() → assert bars returned within 15s

# Phase 2: Watchlist read
4. watchlist_list → assert returns array (may be empty)
5. watchlist_get → assert returns name + symbols

# Phase 3: Watchlist write (use a test list to avoid touching real lists)
6. watchlist_create("__TEST_LIST__") → assert created
7. watchlist_select("__TEST_LIST__") → assert selected
8. watchlist_add(["ASX:CBA", "ASX:BHP", "ASX:29M"]) → assert CBA+BHP added, 29M result documented
9. watchlist_get → assert ["ASX:CBA", "ASX:BHP"] present
10. watchlist_remove_symbol("ASX:CBA") → assert removed
11. watchlist_get → assert only ["ASX:BHP"] present
12. watchlist_set("__TEST_LIST__", ["ASX:NAB", "ASX:ANZ"]) → assert updated
13. watchlist_get → assert exactly ["ASX:NAB", "ASX:ANZ"]
14. watchlist_set("__TEST_LIST__", ["ASX:NAB", "ASX:ANZ"]) → assert status: "unchanged"
15. watchlist_delete("__TEST_LIST__") → assert deleted
16. watchlist_list → assert "__TEST_LIST__" not present

# Phase 4: Safety check
17. watchlist_set("__TEST_LIST__", [...]) with bad name → assert handled gracefully
18. watchlist_delete("non_existent") → assert clean error, not a crash
```

### 5.2 The 24-Watchlist UPSERT Test

Once all tools pass the manual test script, run the full 24-watchlist UPSERT:
- Call `watchlist_set` for each of the 24 lists defined in the task specification
- Verify via `watchlist_list` + `watchlist_get` that all 24 exist with correct symbol counts
- Document any rejected symbols (especially `29M`, `360`, `5GG`)

---

## 6. Code Organisation

```
src/
  tools/
    watchlist/
      index.ts          ← exports all watchlist tools
      list.ts           ← watchlist_list
      select.ts         ← watchlist_select
      get.ts            ← watchlist_get (refactored)
      create.ts         ← watchlist_create
      add.ts            ← watchlist_add (refactored)
      remove.ts         ← watchlist_remove_symbol
      delete.ts         ← watchlist_delete
      rename.ts         ← watchlist_rename
      set.ts            ← watchlist_set (UPSERT)
      symbols.ts        ← shared symbol normalisation utilities
      panel.ts          ← shared panel open/read utilities
    data/
      quote.ts          ← quote_get (fixed)
      ohlcv.ts          ← data_get_ohlcv (fixed)
      study-values.ts   ← data_get_study_values (fixed)
  utils/
    timeout.ts          ← withTimeout utility
    retry.ts            ← withRetry utility
    cdp.ts              ← CDP session management, getActivePage()
    health.ts           ← tv_health_check (enhanced)
```

If the repo uses a different structure, follow its existing conventions — but keep watchlist
tools in their own module/directory.

---

## 7. Constraints & Non-Goals

- **Do not rename or delete watchlists not in the 24-list source of truth** — the tools must
  be safe to use alongside the user's existing personal watchlists
- **Do not modify existing watchlist tool parameter signatures** in a breaking way — add
  optional params only
- **TypeScript strict mode** — do not introduce `any` types without justification
- **No new runtime dependencies** unless absolutely necessary — prefer what the upstream repo
  already uses (Playwright / Puppeteer / CDP)
- **CSS class selectors are version-unstable** — always prefer `data-name`, `aria-label`,
  `role`, or structural selectors. Document any class-based selectors with a warning comment.

---

## 8. Delivery

On completion, the following should be true:
1. All tools in Section 1.2 (timeouts) now complete within 15s or return a clear error
2. `tv_health_check` returns `data_pipeline_healthy` field
3. All 8 new watchlist tools are implemented, registered in the MCP manifest, and passing the manual test script
4. `watchlist_set` can UPSERT all 24 ASX watchlists from scratch idempotently
5. A brief `CHANGES.md` entry summarises what was added/fixed
