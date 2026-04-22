# Watchlist architecture scout — findings

## Recommendation

**UI automation (with a small REST bonus for the quote surface).**

TradingView Desktop has no user-facing REST endpoint for watchlist CRUD: no global token, no traffic on list-switch/add-symbol, no in-page API exposed, and no LocalStorage/IndexedDB mirror. The UI widget is the source of truth; writes sync server-side through an opaque Electron path we cannot intercept. UI automation via the existing `src/core/watchlist.js` pattern is the only viable path for the 8 PRD §4.3 tools. Separately, `scanner.tradingview.com/global/scan` is a clean unauthenticated POST endpoint that can replace `quote_get`'s temp-switch — big win, but scope-adjacent.

## Evidence

### REST surface

No watchlist REST endpoint is reachable from the page. `window.TV_WATCHLISTS_URL` exists as an empty string and `window.TV_WATCHLISTS_TOKEN` is undefined. `window.TradingViewApi._watchlistApiDeferredPromise` exists as a slot but is literally `null` even after the watchlist widget is mounted, and `_watchlistApiRejectionReason` is also null — the deferred was never created. Over 20s of idle + dropdown-click + add-symbol-click, zero watchlist-related HTTP fired; the only observed hostnames were `s3-symbol-logo.tradingview.com` (logos) and one hit to `symbol-search.tradingview.com`. The lone non-logo REST endpoint discovered is `POST https://scanner.tradingview.com/global/scan?label-product=popup-watchlists`, triggered by clicking `[data-name="advanced-view-button"]`; it accepts `{columns, symbols:{tickers:[…]}}` and returns per-symbol column arrays. Verified unauthenticated via `curl` — `close/change/change_abs/volume/high/low/open` all work, no cookies needed. This is our replacement for `quote_get`'s temp-switch but does not help with CRUD.

### React fiber surface

The watchlist widget does NOT use React. `document.querySelector('.widgetbar-widget-watchlist')` has **zero own properties** (no `__reactFiber$*`, no `__reactProps$*`, no Preact `_vnode`). Only plain React elements like `[data-name="base"]` (the panel toggle button) carry fiber keys (e.g. `__reactFiber$kvmu6kwt4d9`), and walking that button's `fiber.return` chain does not reach a widget instance — the widget is mounted via a different framework (probably TV's internal widget factory) whose instance lives in closures that are not reachable from the DOM. `window.TVSettings` exists and has `getValue/setValue/getJSON/setJSON/keys/sync/onSync`, but enumerating all 95 keys returns only two watchlist-ish hits (`symbollist.recents`, `watchlistsdialog.hotlist.exchange`) — both side-state. Watchlist content is not in TVSettings, not in `localStorage`, and not in IndexedDB. This is the hard blocker: there is no in-page data model we can read or write.

### UI selectors

Stable selectors discovered inside `.widgetbar-widget-watchlist`:
- `[data-name="watchlists-button"]` — button whose `.textContent` is the active watchlist name (observed: `"ASX_GOLD_SILVER"`). Click opens the lists dropdown.
- `[data-name="add-symbol-button"]` — opens symbol-search popup (aria-label="Add symbol"). The existing `watchlist_add` already drives this.
- `[data-name="advanced-view-button"]` — opens the full watchlist manager (the big popup). This is the ONLY click that fires a REST call.
- `[data-name="settings-button"]` — opens the watchlist settings menu (rename/delete live here).
- `[data-name="symbol-list-wrap"]` — scrollable container for rows.
- `[data-name="tree"]` — direct parent of the rows.
- `[data-symbol-full="ASX:NST"]` — per-row symbol anchor. Stable across versions.

Per-row price data IS rendered in the DOM. A row for ASX:NST shows leaf text `["N","NST","D","Market closed","22.80","−0.86","−3.63%","6.71 M"]` — last/change/change%/volume extractable via row.textContent scraping. Row wrapper class is `wrap-IEe5qpW4` (hashed — avoid). Invalid symbols get an `invalid-RsFlttSS` class (hashed but detectable via `class*="invalid"`).

Class hashes to avoid hard-coding: `wrap-IEe5qpW4`, `symbol-RsFlttSS`, `headerMenuContent-mQBvegEO`. Always use `[data-name=…]` or `[data-symbol-full]`.

### Quote surface (bonus)

**Two options, both non-disruptive.**

1. **`POST scanner.tradingview.com/global/scan`** (recommended). Unauthenticated, accepts arbitrary ticker arrays, returns requested columns in parallel. Example: `{"columns":["close","change","change_abs","volume","high","low","open"],"symbols":{"tickers":["ASX:CBA","NASDAQ:AAPL"]}}` returned `{"totalCount":2,"data":[{"s":"ASX:CBA","d":[175.04,-2.53,-4.54,1249256,178.98,174.68,178.05]},{"s":"NASDAQ:AAPL","d":[273.17,2.63,7,42724679,273.74,266.87,267.82]}]}`. Bid/ask are NOT in the column set the `popup-watchlists` request uses — need to test whether TV's scanner column list includes `bid/ask/last` (it does for some symbols via other labels like `label-product=popup-screener`). Worth implementing as `quote_get` fast-path; fall back to temp-switch if scanner returns no data for a symbol.

2. **Watchlist DOM scrape** (fallback, narrower). Only works for symbols already in the active watchlist, but prices are always rendered in the row. Use as a zero-network path when the symbol is one of the ~30 the user has on screen.

The in-page WebSocket at `data.tradingview.com` carries a `qs_multiplexer_watchlist_*` session that streams `qsd` (quote-session-data) frames for all watchlist symbols — but only metadata + `update_mode`, no `lp/ch/chp/bid/ask`. Price fields (bid/ask streaming) arrive ONLY on the chart's `qs_multiplexer_full_*` session for the currently-displayed symbol. So the websocket is not useful for arbitrary-symbol quotes.

No `window.TradingViewApi.getSymbolInfo`, `.quoteSession`, `.createQuoteSession`, or similar resolver exists — all probes came back `undefined`.

## Implementation implications

Given UI automation is the path, here is the per-tool difficulty and approach:

**Easy (DOM read from widget that's already populated):**
- `watchlist_get` (fix) — already works, just needs to also return the watchlist name from `[data-name="watchlists-button"].textContent` and auto-open the panel via `[data-name="base"][aria-label="Watchlist, details, and news"]` toggle if `aria-pressed !== 'true'`.
- `watchlist_list` — click `[data-name="watchlists-button"]`, read items from the rendered menu. The probe saw the menu disappear before readback (offsetParent=null), so it needs a wait-for-menu-visible loop before scraping. Menu items are portal-rendered outside `.widgetbar-widget-watchlist`.

**Medium (click + keyboard + wait):**
- `watchlist_select` — open dropdown, click the target list's menu item by text match.
- `watchlist_add` (audit + harden) — existing impl works; add idempotent dedupe (read current symbols first, skip existing), detect rejection via `.invalid-*` class on the new row after insert, and batch support by looping.
- `watchlist_remove_symbol` — right-click on `[data-symbol-full="<sym>"]` (`dispatchEvent('contextmenu')`) then click the "Remove from watchlist" menu item. Right-click menus render into a portal; need selector-by-text for the action.
- `watchlist_create` — open lists dropdown, click "Create new list" menu item, type name, Enter. No direct button selector observed — will need to find by text.
- `watchlist_set` (UPSERT) — composed of `watchlist_list` + `watchlist_select` + `watchlist_create` (if missing) + diffed `watchlist_add` / `watchlist_remove_symbol`. Pure orchestration, no new probes needed.

**Harder (may require context menu navigation):**
- `watchlist_rename` — from `[data-name="settings-button"]` context menu or from list dropdown right-click. Needs a probe-during-implementation to find the exact rename affordance.
- `watchlist_delete` — same path as rename; "Delete list" is a menu item. Safety-check by reading name back via `watchlists-button.textContent` after selection, refuse if name doesn't match.

**Risks:**
- **Menu-portal rendering.** Dropdown menus (`role="menu"`) render outside `.widgetbar-widget-watchlist` into a popover layer. Our probe did not see them via `querySelectorAll('[role="menu"]')` — the menu either uses a non-standard role, closes on blur (the probe's subsequent queries fired after autoclose), or is in a separate document. Recommend using `[class*="menuBox"]` / `[class*="dropdown"]` + text-match and pair each click with a short (250-500ms) settle delay before readback.
- **Fragility of text-matching.** Rename/delete/create actions are menu items identified by visible English text. Users on non-English locales will break. Worth adding a locale-aware lookup or documenting en-US-only.
- **Rate limits on scanner endpoint.** Unknown. Tested once, 3 symbols, 200 OK. Should be fine for single-call `quote_get`; large batches may need throttling. Not PII-sensitive; no auth headers sent by our test.
- **No transactional CRUD.** A failure midway through `watchlist_set` (create list, add 20 symbols, network blip on symbol 11) leaves a partial list. Tool should record + return the partial state so the caller can retry.
- **No way to read "all watchlists" without UI interaction.** Every `watchlist_list` call has to open the dropdown and close it again. That's a visible UI blink for the user. Consider caching with a ~30s TTL to reduce churn during `watchlist_set` loops.

PRD §4.3 gating: all 8 tools are implementable via UI automation, none blocked. But `watchlist_rename` and `watchlist_delete` need a one-more-probe step during implementation to confirm exact menu-item text and portal selector.

## Probe artefacts

All under `scripts/probe-*.js`, uncommitted, safe to delete after review:

- `scripts/probe-watchlist-globals.js` — window.TV_WATCHLISTS_URL, cookie names, service registry scan
- `scripts/probe-watchlist-api.js` — first attempt to resolve `_watchlistApiDeferredPromise`
- `scripts/probe-watchlist-deep.js` — deeper scan of TradingViewApi keys for watchlist matches
- `scripts/probe-watchlist-inpage.js` — in-page resolution of deferred promise (confirmed it's null)
- `scripts/probe-watchlist-widget.js` — open watchlist panel, re-probe API, walk React fiber tree
- `scripts/probe-fiber-dom.js` — enumerate DOM selectors inside widget, find fiber keys
- `scripts/probe-network.js` — 20s network capture during idle + dropdown + add-symbol click
- `scripts/probe-websocket.js` — first WebSocket attempt (created before attach)
- `scripts/probe-websocket-v2.js` — WebSocket frame capture with in-page constructor hook
- `scripts/probe-quote-frames.js` — dissect qsd frame payloads for ~27 fields (first wave = metadata)
- `scripts/probe-quote-long.js` — 35s capture of streaming quote frames (bid/ask for chart only)
- `scripts/probe-final.js` — confirm watchlist symbols receive no price frames
- `scripts/probe-dom-prices.js` — per-row DOM scrape + trigger scanner REST via advanced-view
- `scripts/probe-scanner.js` — capture scanner request body (columns + tickers) and response
- `scripts/probe-tvsettings.js` — TVSettings introspection (getValue/setValue/sync)
- `scripts/probe-tvsettings-keys.js` — enumerate all 95 TVSettings keys, no watchlist data in storage
- `scripts/probe-initdata.js` — final sweep of initData, Symbol props, widget DOM own-props

No chart mutations, no watchlist mutations, no `__SCOUT_PROBE__` symbol added (probe flow reached the symbol-search popup then dismissed with Escape before any add fired).
