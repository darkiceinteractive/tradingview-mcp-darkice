/**
 * Core watchlist logic — PRD §4 UI-automation approach.
 *
 * Architecture decision (per docs/watchlist-scout.md):
 *   TradingView Desktop exposes no in-page REST/JS API for watchlist CRUD.
 *   `window.TradingViewApi._watchlistApiDeferredPromise` is null even after
 *   the widget mounts, and no HTTP traffic fires on list-switch / add-symbol.
 *   UI automation via CDP evaluate + keyboard events is the only viable path.
 *
 * Stable selectors used (all discovered via live CDP probes — see
 * scripts/probe-watchlist-*-iter*.js which were iterated during this work):
 *   - `[data-name="watchlists-button"]` — active-list dropdown toggle.
 *        `.textContent` holds the active list name.
 *   - `[data-name="add-symbol-button"]` — opens symbol-search popup.
 *   - `[data-name="advanced-view-button"]` — opens fullscreen list popup.
 *   - `[data-name="settings-button"]` — opens column-customisation menu (NOT
 *        rename/delete).
 *   - `[data-symbol-full="EXCHANGE:TICKER"]` — per-row symbol anchor.
 *   - `[data-name="watchlists-dialog"]` — the Open-list… dialog. Contains
 *        one `[data-id="<numeric>"]` row per watchlist plus `[data-name=
 *        "remove-button"]` and a `[title="Rename"]` icon per row.
 *   - `[class*="removeButton-"]` — per-symbol-row delete affordance inside
 *        `[class*="overlayEnd-"]`. Class name is hashed but the
 *        `removeButton-` prefix is semantically stable.
 *
 * Menu portals render outside `.widgetbar-widget-watchlist` as
 * `[class*="menuBox"]` — we poll for them with short (200–500ms) settle
 * windows rather than arbitrary long sleeps.
 *
 * Symbol normalisation (PRD §4.4):
 *   - Accept both `ASX:CBA` and bare `CBA`. Do NOT auto-prefix bare tickers
 *     — pass them through exactly as given. TradingView resolves them via
 *     its own symbol-search logic, which is already exchange-aware.
 *   - Numeric-prefix ASX tickers (`ASX:29M`, `ASX:360`, `ASX:5GG`) may be
 *     rejected by TV — we detect via `[class*="invalid"]` on the row OR
 *     absence of the `[data-symbol-full]` selector after the insert settle
 *     window. Rejected symbols are surfaced in the tool response; the batch
 *     continues.
 *
 * All core functions throw on failure. The tool wrap (registerWatchlistTools)
 * catches and converts to the `{ success: false, error }` envelope.
 */
import { evaluate, getClient } from '../connection.js';
import { openPanel, mouseClick } from './ui.js';

const PANEL_SETTLE_MS = 400;
const MENU_SETTLE_MS = 300;
const DIALOG_SETTLE_MS = 1200;  // "Open list…" and advanced-view both do a network call.
const SYMBOL_SETTLE_MS = 800;   // Time TV needs to reject invalid symbols / confirm valid ones.
const POLL_INTERVAL_MS = 100;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Ensure the watchlist side-panel is open. Idempotent. */
async function ensurePanelOpen() {
  const r = await openPanel({ panel: 'watchlist', action: 'open' });
  if (r.performed === 'opened') {
    // openPanel already polls for widget body readiness, but give DOM a moment
    // to finish laying out symbol rows.
    await sleep(PANEL_SETTLE_MS);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Press Escape via CDP keyboard (closes menus/dialogs). */
async function pressEscape() {
  const c = await getClient();
  await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape' });
}

/** Press Enter via CDP keyboard. */
async function pressEnter() {
  const c = await getClient();
  await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
}

/** Poll `fn` up to `timeoutMs` ms, resolving when it returns truthy. */
async function waitFor(fn, timeoutMs = 2000, intervalMs = POLL_INTERVAL_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fn();
    if (r) return r;
    await sleep(intervalMs);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lists dropdown (for active-list operations: Rename, Clear list, Create, Select)
// ---------------------------------------------------------------------------

/**
 * Open the lists dropdown anchored on [data-name="watchlists-button"] and wait
 * for the portal-rendered menu to appear. Throws if it doesn't materialise.
 */
async function openListsDropdown() {
  await ensurePanelOpen();
  const clicked = await evaluate(`
    (function() {
      var btn = document.querySelector('[data-name="watchlists-button"]');
      if (!btn) return { error: 'watchlists-button not found' };
      btn.click();
      return { clicked: true };
    })()
  `);
  if (clicked?.error) throw new Error(clicked.error);

  const ready = await waitFor(async () => {
    return await evaluate(`
      (function() {
        var menu = document.querySelector('[class*="menuBox"]');
        if (!menu) return false;
        if (menu.offsetParent === null && menu.offsetWidth === 0) return false;
        // The dropdown shows "Create new list…" — use that as a readiness marker.
        var txt = menu.innerText || '';
        return txt.indexOf('Create new list') !== -1;
      })()
    `);
  }, 2000);

  if (!ready) throw new Error('Lists dropdown did not appear within 2s');
}

/** Click an action row in the open lists dropdown, matching by exact label text. */
async function clickDropdownAction(label) {
  // TV swallows JS .click() on portal menu items — use real CDP mouse events via mouseClick().
  const rect = await evaluate(`
    (function() {
      var menu = document.querySelector('[class*="menuBox"]');
      if (!menu) return { error: 'menu gone' };
      var items = Array.from(menu.querySelectorAll('span, div'));
      for (var i = 0; i < items.length; i++) {
        if ((items[i].textContent || '').trim() !== ${JSON.stringify(label)}) continue;
        var row = items[i];
        while (row && row !== menu) {
          var cls = (row.className || '').toString();
          if (cls.indexOf('background-') !== -1 || cls.indexOf('button-H') !== -1 || cls.indexOf('accessible-') !== -1) {
            var r = row.getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
          }
          row = row.parentElement;
        }
        var r2 = items[i].getBoundingClientRect();
        return { x: Math.round(r2.x + r2.width / 2), y: Math.round(r2.y + r2.height / 2) };
      }
      return { error: 'action not found: ' + ${JSON.stringify(label)} };
    })()
  `);
  if (rect?.error) throw new Error(rect.error);
  await mouseClick({ x: rect.x, y: rect.y });
}
async function openListDialog() {
  await openListsDropdown();
  await clickDropdownAction('Open list…');

  const ready = await waitFor(async () => {
    return await evaluate(`!!document.querySelector('[data-name="watchlists-dialog"]')`);
  }, DIALOG_SETTLE_MS + 1000);

  if (!ready) throw new Error('Open-list dialog did not appear within 2.2s');
  // Small extra settle for row data to hydrate
  await sleep(300);
}

/** Close any open watchlists dialog / dropdown. Idempotent. */
async function closeAnyOverlay() {
  await pressEscape();
  await sleep(150);
  // Double-Escape — some states stack (dropdown over dialog).
  await pressEscape();
  await sleep(150);
}

/**
 * Scrape all watchlists from the `[data-name="watchlists-dialog"]` dialog.
 * Returns the raw array — caller attaches `active_id`/`active_name`.
 */
async function scrapeAllLists() {
  const expr = `
    (function() {
      var dialog = document.querySelector('[data-name="watchlists-dialog"]');
      if (!dialog) return { error: 'watchlists-dialog not present' };
      var rows = dialog.querySelectorAll('[data-id]');
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var el = rows[i];
        var id = el.getAttribute('data-id');
        if (!id) continue;
        // Walk up to the container-ODL8WA9K row wrapper for class/active detection.
        var wrap = el;
        for (var j = 0; j < 5; j++) {
          if (!wrap.parentElement) break;
          if (wrap.className && wrap.className.toString().indexOf('container-ODL8WA9K') !== -1) break;
          wrap = wrap.parentElement;
        }
        var wrapCls = (wrap.className || '').toString();
        var isActive = wrapCls.indexOf('selected') !== -1 || wrapCls.indexOf('active') !== -1;

        // Extract name: the row text is "NAME\\n<count>" — take everything before the trailing digits.
        var rawText = (el.innerText || el.textContent || '').trim();
        // Try a more reliable path: find the span that contains the symbol count as title, e.g.
        // title="8 symbols, 0 sections" — then everything before it is the name.
        var countTitle = null;
        var countSpan = wrap.querySelector('[title*="symbols"]');
        if (countSpan) countTitle = countSpan.getAttribute('title');
        var count = null;
        if (countTitle) {
          var m = countTitle.match(/^(\\d+)\\s+symbol/);
          if (m) count = parseInt(m[1], 10);
        }
        // Name extraction: pull all text then strip trailing digits after a newline.
        var name = rawText.replace(/\\s*\\n?\\s*\\d+\\s*$/, '').trim();
        // Type: "red" and "colored" lists are flag-lists; numeric ids are user-created.
        var type = /^\\d+$/.test(id) ? 'user' : 'flag';
        out.push({ id: id, name: name, count: count, type: type, is_active: isActive });
      }
      return { rows: out };
    })()
  `;
  return await evaluate(expr);
}

// ---------------------------------------------------------------------------
// Public tool: watchlist_list
// ---------------------------------------------------------------------------

export async function list() {
  try {
    await openListDialog();
    const scraped = await scrapeAllLists();
    if (scraped?.error) throw new Error(scraped.error);
    const rows = scraped.rows || [];
    // Find active entry
    const active = rows.find(r => r.is_active);
    // Clean up dialog
    await closeAnyOverlay();
    return {
      success: true,
      watchlists: rows.map(({ id, name, count, type }) => ({ id, name, count, type })),
      active_id: active?.id || null,
      active_name: active?.name || null,
    };
  } catch (err) {
    await closeAnyOverlay().catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public tool: watchlist_select
// ---------------------------------------------------------------------------

export async function select({ name, id } = {}) {
  if (!name && !id) throw new Error('watchlist_select requires either `name` or `id`');

  await ensurePanelOpen();
  const previousName = await readActiveListName();

  try {
    await openListDialog();
    const scraped = await scrapeAllLists();
    if (scraped?.error) throw new Error(scraped.error);
    const rows = scraped.rows || [];

    let target;
    if (id) target = rows.find(r => r.id === id);
    else    target = rows.find(r => r.name === name);

    if (!target) {
      const avail = rows.map(r => r.name).join(', ');
      await closeAnyOverlay().catch(() => {});
      throw new Error(`Watchlist ${id ? `'${id}'` : `'${name}'`} not found. Available: [${avail}]`);
    }

    const previousId = rows.find(r => r.is_active)?.id || null;

    // Click the target row to select it. The dialog auto-closes on click.
    const clicked = await evaluate(`
      (function() {
        var dialog = document.querySelector('[data-name="watchlists-dialog"]');
        if (!dialog) return { error: 'dialog gone' };
        var row = dialog.querySelector('[data-id=${JSON.stringify(target.id)}]');
        if (!row) return { error: 'row not found' };
        row.click();
        return { clicked: true };
      })()
    `);
    if (clicked?.error) throw new Error(clicked.error);

    // Wait for the dropdown button label to reflect the new list name.
    const confirmed = await waitFor(async () => {
      const cur = await readActiveListName();
      return cur === target.name ? cur : null;
    }, 3000);

    if (!confirmed) {
      await closeAnyOverlay().catch(() => {});
      throw new Error(`watchlist_select: clicked '${target.name}' but active list did not change within 3s`);
    }

    return {
      success: true,
      selected: { id: target.id, name: target.name },
      previous: { id: previousId, name: previousName || null },
    };
  } catch (err) {
    await closeAnyOverlay().catch(() => {});
    throw err;
  }
}

/** Read the active watchlist name from the watchlists-button label. */
async function readActiveListName() {
  return await evaluate(`
    (function() {
      var btn = document.querySelector('[data-name="watchlists-button"]');
      return btn ? (btn.textContent || '').trim() : null;
    })()
  `);
}

// ---------------------------------------------------------------------------
// Public tool: watchlist_get (refactored — name + id + count + symbols)
// ---------------------------------------------------------------------------

export async function get() {
  await ensurePanelOpen();

  const name = await readActiveListName();

  // Read symbols from the widget rows via [data-symbol-full].
  const symbols = await evaluate(`
    (function() {
      var rows = document.querySelectorAll('.widgetbar-widget-watchlist [data-symbol-full]');
      var seen = {};
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var s = rows[i].getAttribute('data-symbol-full');
        if (!s || seen[s]) continue;
        seen[s] = true;
        out.push(s);
      }
      return out;
    })()
  `);

  // For id, we'd need to open the Open-list dialog. To avoid the extra UI cost
  // on every get() call, we read id opportunistically via the dialog only when
  // requested — but watchlist_get per PRD §4.3 SHOULD return id. Use the
  // advanced-view route which doesn't require an extra dialog: the
  // portfolio-dialog carries data-dialog-name that may include the id. Fallback
  // is to open the list dialog just to resolve the id.
  let id = null;
  try {
    await openListDialog();
    const scraped = await scrapeAllLists();
    await closeAnyOverlay().catch(() => {});
    const active = (scraped?.rows || []).find(r => r.is_active);
    if (active) id = active.id;
  } catch {
    // Non-fatal — id resolution is best-effort.
    await closeAnyOverlay().catch(() => {});
  }

  return {
    success: true,
    name: name || null,
    id,
    count: symbols.length,
    symbols,
  };
}

// ---------------------------------------------------------------------------
// Public tool: watchlist_create
// ---------------------------------------------------------------------------

export async function create({ name, symbols } = {}) {
  if (!name || typeof name !== 'string') throw new Error('watchlist_create requires `name: string`');

  // Pre-flight: refuse if a watchlist with that name already exists.
  const existing = await list();
  if (existing.watchlists.some(w => w.name === name)) {
    throw new Error(`Watchlist '${name}' already exists. Use watchlist_set to update it.`);
  }

  await ensurePanelOpen();

  // 1. Open dropdown and click "Create new list…"
  await openListsDropdown();
  await clickDropdownAction('Create new list…');

  // 2. Wait for an input field (name prompt) — TradingView opens a dialog with
  //    an input pre-focused.
  const inputReady = await waitFor(async () => {
    return await evaluate(`
      (function() {
        var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
        for (var i = 0; i < inputs.length; i++) {
          if (inputs[i].offsetParent !== null) return true;
        }
        return false;
      })()
    `);
  }, 2000);
  if (!inputReady) {
    await closeAnyOverlay().catch(() => {});
    throw new Error('Create-list input did not appear within 2s');
  }

  // 3. Clear any existing value (TV pre-populates "Watchlist") + type the new name.
  const c = await getClient();
  // Select-all then delete to clear input.
  await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 4, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp',   modifiers: 4, key: 'a', code: 'KeyA' });
  await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Delete', code: 'Delete' });
  await sleep(100);
  await c.Input.insertText({ text: name });
  await sleep(200);
  await pressEnter();
  await sleep(700);  // server round-trip to persist the new list

  // 4. Confirm it exists and is active.
  const activeName = await readActiveListName();
  if (activeName !== name) {
    // The create may have succeeded but not activated — or failed silently.
    // Re-list and throw if not present.
    const verify = await list();
    if (!verify.watchlists.some(w => w.name === name)) {
      throw new Error(`watchlist_create: list '${name}' was not created (active is '${activeName}')`);
    }
    // Select it before adding symbols.
    await select({ name });
  }

  // 5. Add symbols if requested.
  let added = [], skipped_duplicates = [], rejected = [];
  if (Array.isArray(symbols) && symbols.length > 0) {
    const addResult = await add({ symbols });
    added = addResult.added;
    skipped_duplicates = addResult.skipped_duplicates;
    rejected = addResult.rejected;
  }

  // 6. Resolve id for response.
  const after = await list();
  const created = after.watchlists.find(w => w.name === name);

  return {
    success: true,
    id: created?.id || null,
    name,
    symbols_added: added.length,
    added,
    skipped_duplicates,
    rejected,
  };
}

// ---------------------------------------------------------------------------
// Public tool: watchlist_add (hardened — string or array, dedupe, reject detect)
// ---------------------------------------------------------------------------

export async function add({ symbol, symbols } = {}) {
  const inputs = [];
  if (Array.isArray(symbols)) inputs.push(...symbols);
  if (typeof symbol === 'string') inputs.push(symbol);
  if (inputs.length === 0) throw new Error('watchlist_add requires `symbol: string` or `symbols: string[]`');

  await ensurePanelOpen();

  // Read current symbols once for dedup.
  const current = await evaluate(`
    (function() {
      var rows = document.querySelectorAll('.widgetbar-widget-watchlist [data-symbol-full]');
      var seen = {};
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var s = rows[i].getAttribute('data-symbol-full');
        if (!s || seen[s]) continue;
        seen[s] = true;
        out.push(s);
      }
      return out;
    })()
  `);
  const present = new Set(current.map(s => s.toUpperCase()));

  const added = [];
  const skipped_duplicates = [];
  const rejected = [];

  for (const raw of inputs) {
    const sym = String(raw).trim();
    if (!sym) continue;

    // Dedup: exact-match only (don't collapse EXCHANGE:X vs bare X — TV
    // resolves them differently and the user may legitimately want both).
    if (present.has(sym.toUpperCase())) {
      skipped_duplicates.push(sym);
      continue;
    }

    // Attempt to add via the add-symbol popup.
    const result = await addOneSymbol(sym);
    if (result.status === 'added') {
      added.push(result.resolved || sym);
      present.add((result.resolved || sym).toUpperCase());
    } else if (result.status === 'duplicate') {
      skipped_duplicates.push(sym);
    } else {
      rejected.push({ symbol: sym, reason: result.reason || 'Symbol not accepted by TradingView' });
    }
  }

  return { success: true, added, skipped_duplicates, rejected };
}

async function addOneSymbol(sym) {
  const c = await getClient();

  // Click "Add symbol" button
  const opened = await evaluate(`
    (function() {
      var btn = document.querySelector('[data-name="add-symbol-button"]');
      if (!btn) return { error: 'add-symbol-button not found' };
      btn.click();
      return { ok: true };
    })()
  `);
  if (opened?.error) return { status: 'rejected', reason: opened.error };

  // Wait for search input
  const ready = await waitFor(async () => {
    return await evaluate(`
      (function() {
        // Search popup has an input field that's focused.
        var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
        for (var i = 0; i < inputs.length; i++) {
          if (inputs[i].offsetParent !== null && inputs[i] === document.activeElement) return true;
        }
        return false;
      })()
    `);
  }, 1500);
  if (!ready) {
    await pressEscape();
    return { status: 'rejected', reason: 'Add-symbol popup did not open' };
  }

  // Type + Enter
  await c.Input.insertText({ text: sym });
  await sleep(400);  // Let the search results populate
  await pressEnter();
  await sleep(SYMBOL_SETTLE_MS);
  await pressEscape();  // Close the popup
  await sleep(200);

  // Verify: did the symbol appear as a valid row?
  // TV may resolve "CBA" to "ASX:CBA" or similar — check by matching
  // suffix-of-base.
  const verdict = await evaluate(`
    (function() {
      var target = ${JSON.stringify(sym.toUpperCase())};
      var rows = document.querySelectorAll('.widgetbar-widget-watchlist [data-symbol-full]');
      for (var i = 0; i < rows.length; i++) {
        var s = (rows[i].getAttribute('data-symbol-full') || '').toUpperCase();
        // Match either exact, or the base ticker matches (after ':').
        var matches = s === target || s.split(':').pop() === target.split(':').pop();
        if (matches) {
          // Check for invalid class on row or any ancestor up to wrap-*
          var cur = rows[i];
          for (var j = 0; j < 6; j++) {
            if (!cur) break;
            var cls = (cur.className || '').toString();
            if (cls.indexOf('invalid') !== -1) return { status: 'invalid', resolved: s };
            cur = cur.parentElement;
          }
          return { status: 'added', resolved: s };
        }
      }
      return { status: 'missing' };
    })()
  `);

  if (verdict?.status === 'added') return { status: 'added', resolved: verdict.resolved };
  if (verdict?.status === 'invalid') return { status: 'rejected', reason: 'TradingView marked the symbol invalid' };
  return { status: 'rejected', reason: 'Symbol did not appear in watchlist after insert' };
}

// ---------------------------------------------------------------------------
// Public tool: watchlist_remove_symbol
// ---------------------------------------------------------------------------

export async function removeSymbol({ symbol, symbols } = {}) {
  const inputs = [];
  if (Array.isArray(symbols)) inputs.push(...symbols);
  if (typeof symbol === 'string') inputs.push(symbol);
  if (inputs.length === 0) throw new Error('watchlist_remove_symbol requires `symbol: string` or `symbols: string[]`');

  await ensurePanelOpen();
  const removed = [];
  const not_found = [];

  for (const raw of inputs) {
    const sym = String(raw).trim();
    if (!sym) continue;

    // Click the per-row [class*="removeButton-"] element.
    // We match by exact data-symbol-full OR base ticker suffix.
    const clicked = await evaluate(`
      (function() {
        var target = ${JSON.stringify(sym.toUpperCase())};
        var rows = document.querySelectorAll('.widgetbar-widget-watchlist [data-symbol-full]');
        for (var i = 0; i < rows.length; i++) {
          var s = (rows[i].getAttribute('data-symbol-full') || '').toUpperCase();
          if (s !== target && s.split(':').pop() !== target.split(':').pop()) continue;
          // Walk up to the row wrapper (wrap-*)
          var wrap = rows[i];
          for (var j = 0; j < 6; j++) {
            if (!wrap.parentElement) break;
            wrap = wrap.parentElement;
            if (wrap.matches && wrap.matches('[class*="wrap-"]')) break;
          }
          var btn = wrap.querySelector('[class*="removeButton-"]');
          if (!btn) return { error: 'remove button not found on row', sym: s };
          btn.click();
          return { ok: true, clicked: s };
        }
        return { not_found: true };
      })()
    `);

    if (clicked?.not_found) { not_found.push(sym); continue; }
    if (clicked?.error) { not_found.push(sym); continue; }

    // Verify removal
    await sleep(400);
    const gone = await evaluate(`
      (function() {
        var target = ${JSON.stringify((clicked.clicked || sym).toUpperCase())};
        var rows = document.querySelectorAll('.widgetbar-widget-watchlist [data-symbol-full]');
        for (var i = 0; i < rows.length; i++) {
          var s = (rows[i].getAttribute('data-symbol-full') || '').toUpperCase();
          if (s === target) return false;
        }
        return true;
      })()
    `);
    if (gone) removed.push(clicked.clicked || sym);
    else      not_found.push(sym);  // click was dispatched but row survived
  }

  return { success: true, removed, not_found };
}

// ---------------------------------------------------------------------------
// Public tool: watchlist_delete
// ---------------------------------------------------------------------------

export async function deleteList({ name, id } = {}) {
  if (!name && !id) throw new Error('watchlist_delete requires either `name` or `id`');

  await ensurePanelOpen();
  await openListDialog();

  try {
    const scraped = await scrapeAllLists();
    if (scraped?.error) throw new Error(scraped.error);
    const rows = scraped.rows || [];

    let target;
    if (id)   target = rows.find(r => r.id === id);
    else      target = rows.find(r => r.name === name);

    if (!target) {
      const avail = rows.map(r => r.name).join(', ');
      throw new Error(`Watchlist ${id ? `'${id}'` : `'${name}'`} not found. Available: [${avail}]`);
    }
    if (target.type === 'flag') {
      throw new Error(`Cannot delete '${target.name}' — it is a flag list, not a user-created list.`);
    }

    // Click that row's [data-name="remove-button"].
    const clicked = await evaluate(`
      (function() {
        var dialog = document.querySelector('[data-name="watchlists-dialog"]');
        if (!dialog) return { error: 'dialog gone' };
        var row = dialog.querySelector('[data-id=${JSON.stringify(target.id)}]');
        if (!row) return { error: 'row missing' };
        // Walk up to the container row that holds the remove button.
        var wrap = row;
        for (var j = 0; j < 5; j++) {
          if (!wrap.parentElement) break;
          if (wrap.querySelector && wrap.querySelector('[data-name="remove-button"]')) break;
          wrap = wrap.parentElement;
        }
        var btn = wrap.querySelector('[data-name="remove-button"]');
        if (!btn) return { error: 'no remove button' };
        btn.click();
        return { ok: true };
      })()
    `);
    if (clicked?.error) throw new Error(clicked.error);

    // TV may show a confirmation dialog — accept it.
    await sleep(500);
    const confirmed = await evaluate(`
      (function() {
        var buttons = document.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
          var t = (buttons[i].textContent || '').trim();
          if (/^(Delete|Remove|Yes|Confirm|OK)$/i.test(t) && buttons[i].offsetParent !== null) {
            buttons[i].click();
            return { clicked: t };
          }
        }
        return { none: true };
      })()
    `);
    // confirmed.none is OK — not every install prompts.

    // Wait for the row to disappear from the dialog (or for the dialog itself
    // to refresh).
    await sleep(800);
    const stillThere = await evaluate(`
      (function() {
        var dialog = document.querySelector('[data-name="watchlists-dialog"]');
        if (!dialog) return false;  // Dialog closed — treat as deleted (we'll re-verify below).
        return !!dialog.querySelector('[data-id=${JSON.stringify(target.id)}]');
      })()
    `);

    await closeAnyOverlay();

    if (stillThere) {
      throw new Error(`watchlist_delete: row for '${target.name}' is still present after remove click`);
    }

    // Re-verify via a fresh enumeration.
    const fresh = await list();
    const stillFound = fresh.watchlists.find(w => w.id === target.id || w.name === target.name);
    if (stillFound) {
      throw new Error(`watchlist_delete: '${target.name}' still exists after delete attempt`);
    }

    return { success: true, deleted: { id: target.id, name: target.name } };
  } catch (err) {
    await closeAnyOverlay().catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public tool: watchlist_rename
// ---------------------------------------------------------------------------

export async function rename({ name, new_name } = {}) {
  if (!name || typeof name !== 'string')     throw new Error('watchlist_rename requires `name: string`');
  if (!new_name || typeof new_name !== 'string') throw new Error('watchlist_rename requires `new_name: string`');
  if (name === new_name) return { success: true, old_name: name, new_name, unchanged: true };

  await ensurePanelOpen();

  // Ensure the target list is active so "Rename" in the dropdown applies to it.
  const active = await readActiveListName();
  if (active !== name) {
    await select({ name });
  }

  // Open dropdown, click "Rename"
  await openListsDropdown();
  await clickDropdownAction('Rename');

  // An input appears (same pattern as Create new list…). Wait for it, then
  // select-all + type + Enter.
  const ready = await waitFor(async () => {
    return await evaluate(`
      (function() {
        var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
        for (var i = 0; i < inputs.length; i++) {
          if (inputs[i].offsetParent !== null) return true;
        }
        return false;
      })()
    `);
  }, 2000);
  if (!ready) throw new Error('Rename input did not appear within 2s');

  const c = await getClient();
  await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 4, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp',   modifiers: 4, key: 'a', code: 'KeyA' });
  await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Delete', code: 'Delete' });
  await sleep(100);
  await c.Input.insertText({ text: new_name });
  await sleep(150);
  await pressEnter();
  await sleep(700);

  const confirmed = await readActiveListName();
  if (confirmed !== new_name) {
    throw new Error(`watchlist_rename: expected active list to be '${new_name}', got '${confirmed}'`);
  }
  return { success: true, old_name: name, new_name };
}

// ---------------------------------------------------------------------------
// Public tool: watchlist_set (UPSERT orchestration — no new UI primitives)
// ---------------------------------------------------------------------------

export function baseSymbol(s) {
  const u = String(s).trim().toUpperCase();
  return u.includes(':') ? u.split(':').pop() : u;
}

export async function set({ name, symbols } = {}) {
  if (!name || typeof name !== 'string') throw new Error('watchlist_set requires `name: string`');
  if (!Array.isArray(symbols)) throw new Error('watchlist_set requires `symbols: string[]`');

  // 1. Enumerate.
  const all = await list();
  const exists = all.watchlists.find(w => w.name === name);

  // 2. Create if missing.
  if (!exists) {
    const createResult = await create({ name, symbols });
    const finalSymbols = (await get()).symbols;
    return {
      success: true,
      name,
      status: 'created',
      added: createResult.added,
      removed: [],
      rejected: createResult.rejected,
      final_count: finalSymbols.length,
    };
  }

  // 3. Select + compute diff.
  const activeName = await readActiveListName();
  if (activeName !== name) await select({ name });

  const current = await get();
  const currentBases = new Map(current.symbols.map(s => [baseSymbol(s), s]));
  const desiredBases = new Set(symbols.map(baseSymbol));

  const to_add = symbols.filter(s => !currentBases.has(baseSymbol(s)));
  const to_remove = [...currentBases.entries()]
    .filter(([b]) => !desiredBases.has(b))
    .map(([, full]) => full);

  if (to_add.length === 0 && to_remove.length === 0) {
    return {
      success: true,
      name,
      status: 'unchanged',
      added: [],
      removed: [],
      rejected: [],
      final_count: current.symbols.length,
    };
  }

  // 4. Apply.
  let added = [], rejected = [], removed = [];
  if (to_add.length > 0) {
    const addRes = await add({ symbols: to_add });
    added = addRes.added;
    rejected = addRes.rejected;
  }
  if (to_remove.length > 0) {
    const rmRes = await removeSymbol({ symbols: to_remove });
    removed = rmRes.removed;
  }

  const finalSymbols = (await get()).symbols;
  return {
    success: true,
    name,
    status: 'updated',
    added,
    removed,
    rejected,
    final_count: finalSymbols.length,
  };
}
