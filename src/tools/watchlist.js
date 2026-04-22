import { z } from 'zod';
import { jsonResult } from './_format.js';
import { withToolTimeout } from '../utils/timeout.js';
import { withRetry } from '../utils/retry.js';
import * as core from '../core/watchlist.js';

export function registerWatchlistTools(server) {
  server.tool(
    'watchlist_get',
    'Get all symbols from the currently active TradingView watchlist. Returns name, id, count, and symbol list. Opens the watchlist panel if it is closed.',
    {},
    async () => {
      try {
        return jsonResult(await withToolTimeout(withRetry(() => core.get(), 'watchlist_get'), 'watchlist_get'));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    'watchlist_list',
    'Enumerate all watchlists (user-created and flag-lists) with id, name, symbol count, type, and which one is active.',
    {},
    async () => {
      try {
        return jsonResult(await withToolTimeout(withRetry(() => core.list(), 'watchlist_list'), 'watchlist_list'));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    'watchlist_select',
    'Switch the active watchlist by exact name or by id.',
    {
      name: z.string().optional().describe('Exact watchlist name (case-sensitive). One of `name` or `id` must be supplied.'),
      id: z.string().optional().describe('Watchlist id (as returned by watchlist_list). One of `name` or `id` must be supplied.'),
    },
    async ({ name, id }) => {
      try {
        return jsonResult(await withToolTimeout(withRetry(() => core.select({ name, id }), 'watchlist_select'), 'watchlist_select'));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    'watchlist_create',
    'Create a new watchlist with the given name and optionally populate it with an initial symbol list. Errors if the name already exists.',
    {
      name: z.string().describe('Exact watchlist name (case-sensitive).'),
      symbols: z.array(z.string()).optional().describe('Initial symbols to populate. Numeric-prefix ASX tickers like 29M may be rejected and reported separately.'),
    },
    async ({ name, symbols }) => {
      try {
        return jsonResult(await withToolTimeout(withRetry(() => core.create({ name, symbols }), 'watchlist_create'), 'watchlist_create'));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    'watchlist_add',
    'Add one or more symbols to the currently active watchlist. Accepts a single `symbol` or an array of `symbols`. Dedupes against current contents and reports TradingView rejections (e.g., numeric-prefix tickers) without aborting the batch.',
    {
      symbol: z.string().optional().describe('Single symbol (e.g., ASX:CBA, NASDAQ:AAPL, BTCUSD).'),
      symbols: z.array(z.string()).optional().describe('Array of symbols to add in a batch.'),
    },
    async ({ symbol, symbols }) => {
      try {
        return jsonResult(await withToolTimeout(withRetry(() => core.add({ symbol, symbols }), 'watchlist_add'), 'watchlist_add'));
      } catch (err) {
        // Best-effort cleanup: close any open search/input.
        try {
          const { getClient } = await import('../connection.js');
          const c = await getClient();
          await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
          await c.Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Escape', code: 'Escape' });
        } catch { /* best-effort */ }
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    'watchlist_remove_symbol',
    'Remove one or more symbols from the currently active watchlist. Accepts a single `symbol` or an array of `symbols`.',
    {
      symbol: z.string().optional().describe('Single symbol to remove.'),
      symbols: z.array(z.string()).optional().describe('Array of symbols to remove.'),
    },
    async ({ symbol, symbols }) => {
      try {
        return jsonResult(await withToolTimeout(withRetry(() => core.removeSymbol({ symbol, symbols }), 'watchlist_remove_symbol'), 'watchlist_remove_symbol'));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    'watchlist_delete',
    'Delete an entire watchlist by exact name or id. Refuses fuzzy matches and protected flag-lists.',
    {
      name: z.string().optional().describe('Exact watchlist name (case-sensitive). One of `name` or `id` must be supplied.'),
      id: z.string().optional().describe('Watchlist id. One of `name` or `id` must be supplied.'),
    },
    async ({ name, id }) => {
      try {
        return jsonResult(await withToolTimeout(withRetry(() => core.deleteList({ name, id }), 'watchlist_delete'), 'watchlist_delete'));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    'watchlist_rename',
    'Rename a watchlist. The target list becomes active during the rename.',
    {
      name: z.string().describe('Current watchlist name (case-sensitive).'),
      new_name: z.string().describe('New watchlist name.'),
    },
    async ({ name, new_name }) => {
      try {
        return jsonResult(await withToolTimeout(withRetry(() => core.rename({ name, new_name }), 'watchlist_rename'), 'watchlist_rename'));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    'watchlist_set',
    'Idempotent UPSERT: set the exact symbol list for a watchlist. Creates the watchlist if it does not exist, otherwise diffs current vs desired and adds/removes as needed. Safe to re-run. Returns `status`: "created" | "updated" | "unchanged".',
    {
      name: z.string().describe('Watchlist name (case-sensitive, created if missing).'),
      symbols: z.array(z.string()).describe('Exact desired symbol list.'),
    },
    async ({ name, symbols }) => {
      try {
        return jsonResult(await withToolTimeout(withRetry(() => core.set({ name, symbols }), 'watchlist_set'), 'watchlist_set'));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );
}
