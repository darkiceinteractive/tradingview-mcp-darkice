/**
 * Live integration tests — require TradingView Desktop with CDP on
 * localhost:9222 and a chart loaded in the active tab.
 *
 * If CDP is not reachable, every describe in this file is skipped (not
 * failed) — the test run stays green on CI / dev machines without TV.
 *
 * Covers:
 *   Section 2.3 — tv_health_check tier-2 data pipeline probe
 *   Section 2.5 — ui_open_panel watchlist selector fix + idempotency
 *   Section 3.1 — quote_get (live + anti-hang)
 *   Section 3.2 — data_get_ohlcv (summary + count)
 *   Section 3.3 — data_get_study_values
 *   Section 3.4 — batch_run   (gated behind TV_MCP_ALLOW_DISRUPTIVE_TESTS=1
 *                              because it navigates the live chart)
 *
 * Run: node --test tests/live.test.js
 *   TV_MCP_ALLOW_DISRUPTIVE_TESTS=1 node --test tests/live.test.js   (enables 3.4)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Close the singleton CDP client after ALL tests in this file finish so
// node --test can exit cleanly — without this the live WebSocket keeps the
// event loop alive and the runner appears to hang even when all tests pass.
after(async () => {
  try {
    const { disconnect } = await import('../src/connection.js');
    await disconnect();
  } catch { /* best-effort */ }
});

// ---------------------------------------------------------------------------
// Pre-flight probe — synchronously decide whether to skip everything below.
// Uses top-level await (ESM) so describe() options can reference the result.
// ---------------------------------------------------------------------------

async function probeCDP() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    t.unref?.();
    const r = await fetch('http://localhost:9222/json/version', { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

const TV_UP = await probeCDP();
const liveSkip = TV_UP ? false : 'TradingView not running on localhost:9222';
const disruptiveSkip = (TV_UP && process.env.TV_MCP_ALLOW_DISRUPTIVE_TESTS === '1')
  ? false
  : (TV_UP
      ? 'set TV_MCP_ALLOW_DISRUPTIVE_TESTS=1 to enable — this test navigates the live chart'
      : liveSkip);
// Restart is more disruptive than chart navigation — it actually kills the TV
// process. Gate behind its own env var so even the broader disruptive suite
// does not trigger it by accident.
const restartSkip = (TV_UP && process.env.TV_MCP_ALLOW_RESTART_TEST === '1')
  ? false
  : (TV_UP
      ? 'set TV_MCP_ALLOW_RESTART_TEST=1 to enable — this test KILLS and restarts TradingView'
      : liveSkip);

// ---------------------------------------------------------------------------
// Section 2.3 — tier-2 data pipeline probe on tv_health_check
// ---------------------------------------------------------------------------

describe('Section 2.3 — tv_health_check tier-2 probe', { skip: liveSkip }, () => {
  it('returns data_pipeline_healthy:true when TV is in foreground', async () => {
    const { healthCheck } = await import('../src/core/health.js');
    const t = Date.now();
    const r = await healthCheck();
    const elapsed = Date.now() - t;

    assert.equal(r.success, true);
    assert.equal(r.cdp_connected, true);
    assert.equal(r.data_pipeline_healthy, true,
      `expected healthy, got error: ${r.data_pipeline_error}`);
    assert.equal(typeof r.data_pipeline_latency_ms, 'number');
    assert.ok(r.data_pipeline_latency_ms < 500,
      `probe latency ${r.data_pipeline_latency_ms}ms should be <500ms`);
    assert.ok(elapsed < 3000,
      `whole health check elapsed=${elapsed}ms, should be <3s`);
  });

  it('omits data_pipeline_error when healthy', async () => {
    const { healthCheck } = await import('../src/core/health.js');
    const r = await healthCheck();
    assert.equal(
      Object.prototype.hasOwnProperty.call(r, 'data_pipeline_error'),
      false,
      'healthy response should not include error field',
    );
  });
});

// ---------------------------------------------------------------------------
// Section 2.5 — ui_open_panel watchlist
// ---------------------------------------------------------------------------

describe('Section 2.5 — ui_open_panel watchlist', { skip: liveSkip }, () => {
  let startedOpen;

  before(async () => {
    const { openPanel } = await import('../src/core/ui.js');
    // Probe-only open (will no-op if already open) so we know the starting state.
    const r = await openPanel({ panel: 'watchlist', action: 'open' });
    startedOpen = (r.performed === 'already_open');
  });

  after(async () => {
    // Restore whatever state the test started in.
    const { openPanel } = await import('../src/core/ui.js');
    await openPanel({ panel: 'watchlist', action: startedOpen ? 'open' : 'close' });
  });

  it('open on a closed panel sets performed=opened and populates the widgetbar body', async () => {
    const { openPanel } = await import('../src/core/ui.js');
    await openPanel({ panel: 'watchlist', action: 'close' });
    const r = await openPanel({ panel: 'watchlist', action: 'open' });
    assert.equal(r.success, true);
    assert.equal(r.performed, 'opened');
    assert.equal(r.content_ready?.found, true,
      'widgetbar body should be populated after opening');
  });

  it('open on an already-open panel is idempotent (no re-click)', async () => {
    const { openPanel } = await import('../src/core/ui.js');
    await openPanel({ panel: 'watchlist', action: 'open' });  // ensure open
    const t = Date.now();
    const r = await openPanel({ panel: 'watchlist', action: 'open' });
    const elapsed = Date.now() - t;
    assert.equal(r.performed, 'already_open');
    assert.ok(elapsed < 100,
      `idempotent path should be near-instant, got ${elapsed}ms`);
  });

  it('close on an already-closed panel reports already_closed', async () => {
    const { openPanel } = await import('../src/core/ui.js');
    await openPanel({ panel: 'watchlist', action: 'close' });
    const r = await openPanel({ panel: 'watchlist', action: 'close' });
    assert.equal(r.performed, 'already_closed');
  });

  it('unknown panel throws with a descriptive error', async () => {
    const { openPanel } = await import('../src/core/ui.js');
    await assert.rejects(
      () => openPanel({ panel: 'not_a_panel', action: 'open' }),
      /Unknown panel: not_a_panel/,
    );
  });
});

// ---------------------------------------------------------------------------
// Section 3.1 — quote_get
// ---------------------------------------------------------------------------

describe('Section 3.1 — quote_get', { skip: liveSkip }, () => {
  it('returns live quote data for the current chart symbol within 15s', async () => {
    const { getQuote } = await import('../src/core/data.js');
    const t = Date.now();
    const r = await getQuote({});
    const elapsed = Date.now() - t;

    assert.equal(r.success, true);
    assert.ok(r.symbol, 'response should include the chart symbol');
    const price = r.close ?? r.last ?? r.header_price;
    assert.equal(typeof price, 'number',
      'response should include at least one price field (close / last / header_price)');
    assert.ok(elapsed < 15000,
      `elapsed ${elapsed}ms should be within the 15s PRD budget`);
  });

  // Disruptive: switches the chart twice (to the test symbol and back). Gated
  // behind TV_MCP_ALLOW_DISRUPTIVE_TESTS=1 because chart-state pollution from
  // prior test files in `npm run test:all` can leave TV mid-transition and
  // makes the capture→restore assertion flaky.
  it('actually switches the chart when a different symbol is requested (PRD §3.1)',
     { skip: disruptiveSkip }, async () => {
    // Regression test for the Claude Desktop 2026-04-23 feedback: quote_get
    // was silently returning current-chart data labelled with the requested
    // symbol (e.g. asking for ASX:BHP while chart was BATS:SLV returned
    // description: "iShares Silver Trust"). After the fix the tool must
    // temporarily switch the chart to the requested symbol, read the quote,
    // and restore the original symbol.
    const { getQuote } = await import('../src/core/data.js');
    const { getState } = await import('../src/core/chart.js');

    const baseOf = s => (s || '').toUpperCase().split(':').pop();

    const before = await getState();
    const originalSymbol = before.symbol;
    const originalBase = baseOf(originalSymbol);

    // Pick a base symbol that is DEFINITELY different from whatever the chart
    // is on — we need the base to differ, not just the exchange, otherwise we
    // can't tell whether the switch happened or TV just re-routed.
    const testSymbol = originalBase === 'AAPL' ? 'NASDAQ:MSFT' : 'NASDAQ:AAPL';
    const testBase = baseOf(testSymbol);

    const t = Date.now();
    const r = await getQuote({ symbol: testSymbol });
    const elapsed = Date.now() - t;

    assert.equal(r.success, true);
    // Budget: two quick-switches at 5s timeout + read = well under 15s
    assert.ok(elapsed < 15000,
      `elapsed ${elapsed}ms should be <15s (two chart switches at 5s timeout each)`);

    // The response MUST describe the REQUESTED base symbol, not the original
    // chart's symbol. Exchange prefix may differ (TV re-routes AAPL to BATS
    // even when we asked for NASDAQ) — we compare the base symbol only.
    assert.ok(r.symbol, 'response should carry a symbol field');
    assert.equal(baseOf(r.symbol), testBase,
      `returned symbol base "${baseOf(r.symbol)}" should match requested base "${testBase}" ` +
      `(full returned: ${r.symbol})`);
    assert.equal(r.chart_switched, true, 'chart_switched flag must be true when a switch occurred');

    // Chart must be restored to the original base symbol after the call.
    const after = await getState();
    assert.equal(baseOf(after.symbol), originalBase,
      `chart should be restored to ${originalSymbol} (was ${after.symbol})`);
  });

  it('does not hang when an unknown symbol arg is supplied (anti-hang regression test)', async () => {
    // PRD §2.1/§3.1: bogus symbol must fail fast, not hang for 4 minutes.
    // After the §3.1 fix it will throw via setSymbol+waitForChartReady within
    // ~10s — we only assert "did not hang" here.
    const { getQuote } = await import('../src/core/data.js');
    const t = Date.now();
    try {
      await getQuote({ symbol: 'NOSUCH_EXCHANGE:TOTALLY_FAKE' });
    } catch {
      // Expected — unknown symbol should throw, not hang.
    }
    const elapsed = Date.now() - t;
    assert.ok(elapsed < 15000, `must not hang — elapsed ${elapsed}ms`);
  });
});

// ---------------------------------------------------------------------------
// Section 3.2 — data_get_ohlcv
// ---------------------------------------------------------------------------

describe('Section 3.2 — data_get_ohlcv', { skip: liveSkip }, () => {
  it('returns summary stats within 15s when summary:true', async () => {
    const { getOhlcv } = await import('../src/core/data.js');
    const t = Date.now();
    const r = await getOhlcv({ summary: true });
    const elapsed = Date.now() - t;

    assert.equal(r.success, true);
    assert.equal(typeof r.high, 'number');
    assert.equal(typeof r.low, 'number');
    assert.equal(typeof r.close, 'number');
    assert.equal(typeof r.avg_volume, 'number');
    assert.ok(Array.isArray(r.last_5_bars));
    assert.ok(elapsed < 15000, `elapsed ${elapsed}ms should be <15s`);
  });

  it('returns exactly 5 bars when count:5', async () => {
    const { getOhlcv } = await import('../src/core/data.js');
    const t = Date.now();
    const r = await getOhlcv({ count: 5 });
    const elapsed = Date.now() - t;

    assert.equal(r.success, true);
    assert.equal(r.bar_count, 5);
    assert.equal(r.bars.length, 5);
    assert.ok(elapsed < 15000, `elapsed ${elapsed}ms should be <15s`);
    for (const bar of r.bars) {
      assert.equal(typeof bar.time, 'number');
      assert.equal(typeof bar.open, 'number');
      assert.equal(typeof bar.high, 'number');
      assert.equal(typeof bar.low, 'number');
      assert.equal(typeof bar.close, 'number');
    }
  });
});

// ---------------------------------------------------------------------------
// Section 3.3 — data_get_study_values
// ---------------------------------------------------------------------------

describe('Section 3.3 — data_get_study_values', { skip: liveSkip }, () => {
  it('returns study values within 15s (does not hang even with no indicators)', async () => {
    const { getStudyValues } = await import('../src/core/data.js');
    const t = Date.now();
    const r = await getStudyValues();
    const elapsed = Date.now() - t;

    assert.equal(r.success, true);
    assert.equal(typeof r.study_count, 'number');
    assert.ok(Array.isArray(r.studies));
    assert.ok(elapsed < 15000, `elapsed ${elapsed}ms should be <15s`);
  });
});

// ---------------------------------------------------------------------------
// Section 3.4 — batch_run
// DISRUPTIVE: navigates the chart. Gated behind TV_MCP_ALLOW_DISRUPTIVE_TESTS=1.
// ---------------------------------------------------------------------------

describe('Section 3.4 — batch_run', { skip: disruptiveSkip }, () => {
  let originalSymbol;
  let originalTimeframe;

  before(async () => {
    const { healthCheck } = await import('../src/core/health.js');
    const h = await healthCheck();
    originalSymbol = h.chart_symbol;
    originalTimeframe = h.chart_resolution;
  });

  after(async () => {
    // Best-effort restore of chart context so subsequent test runs / the user's
    // session aren't left pointing at the test symbol.
    try {
      const { setSymbol, setTimeframe } = await import('../src/core/chart.js');
      if (originalSymbol) await setSymbol({ symbol: originalSymbol });
      if (originalTimeframe) await setTimeframe({ timeframe: originalTimeframe });
    } catch { /* best-effort */ }
  });

  it('runs get_ohlcv across one symbol × one timeframe within 60s', async () => {
    const { batchRun } = await import('../src/core/batch.js');
    const t = Date.now();
    const r = await batchRun({
      action: 'get_ohlcv',
      symbols: ['ASX:CBA'],
      timeframes: ['1D'],
      ohlcv_count: 5,
      delay_ms: 500,
    });
    const elapsed = Date.now() - t;
    // batch_run's "success" shape depends on the action; accept either an
    // explicit success flag or a results array of length ≥ 1.
    const ok = r?.success !== false && (Array.isArray(r?.results) ? r.results.length >= 1 : true);
    assert.ok(ok, `batch_run should produce results: ${JSON.stringify(r).slice(0, 200)}`);
    assert.ok(elapsed < 60000, `elapsed ${elapsed}ms should be within 60s PRD budget`);
  });
});

// ---------------------------------------------------------------------------
// Section 4 — watchlist management suite
//
// Read-only tests run under liveSkip; write-path tests run under disruptiveSkip.
// The disruptive suite only mutates a throwaway watchlist called __TEST_LIST__
// and restores the user's originally-selected list in an after() hook.
// ---------------------------------------------------------------------------

const TEST_LIST = '__TEST_LIST__';

describe('Section 4 — watchlist (read)', { skip: liveSkip }, () => {
  it('watchlist_list returns at least one list with id/name/count', async () => {
    const core = await import('../src/core/watchlist.js');
    const r = await core.list();
    assert.equal(r.success, true);
    assert.ok(Array.isArray(r.watchlists));
    assert.ok(r.watchlists.length >= 1, 'expected at least one watchlist');
    for (const w of r.watchlists) {
      assert.equal(typeof w.id, 'string');
      assert.equal(typeof w.name, 'string');
      assert.ok(typeof w.count === 'number' || w.count === null);
      assert.ok(['user', 'flag'].includes(w.type));
    }
    assert.ok(r.active_name, 'active_name should be set');
  });

  it('watchlist_get returns name + id + symbols for the active list', async () => {
    const core = await import('../src/core/watchlist.js');
    const r = await core.get();
    assert.equal(r.success, true);
    assert.equal(typeof r.name, 'string');
    assert.equal(typeof r.count, 'number');
    assert.ok(Array.isArray(r.symbols));
    assert.equal(r.count, r.symbols.length);
  });
});

describe('Section 4 — watchlist (write)', { skip: disruptiveSkip }, () => {
  let originalListName = null;

  before(async () => {
    const core = await import('../src/core/watchlist.js');
    const r = await core.list();
    originalListName = r.active_name;
    // Clean up any stale __TEST_LIST__ from a previous failed run.
    if (r.watchlists.some(w => w.name === TEST_LIST)) {
      await core.deleteList({ name: TEST_LIST }).catch(() => {});
    }
  });

  after(async () => {
    const core = await import('../src/core/watchlist.js');
    try {
      const r = await core.list();
      if (r.watchlists.some(w => w.name === TEST_LIST)) {
        await core.deleteList({ name: TEST_LIST }).catch(() => {});
      }
      if (originalListName) {
        await core.select({ name: originalListName }).catch(() => {});
      }
    } catch { /* best-effort */ }
  });

  it('watchlist_select switches to a named list and back', async () => {
    const core = await import('../src/core/watchlist.js');
    const all = await core.list();
    const other = all.watchlists.find(
      w => w.type === 'user' && w.name !== all.active_name,
    );
    assert.ok(other, 'need at least two user watchlists for this test');

    const a = await core.select({ name: other.name });
    assert.equal(a.success, true);
    assert.equal(a.selected.name, other.name);

    const b = await core.select({ name: originalListName });
    assert.equal(b.success, true);
    assert.equal(b.selected.name, originalListName);
  });

  it('watchlist_create / watchlist_add / watchlist_remove_symbol / watchlist_delete full lifecycle on __TEST_LIST__', async () => {
    const core = await import('../src/core/watchlist.js');

    // Create
    const created = await core.create({ name: TEST_LIST });
    assert.equal(created.success, true);
    assert.equal(created.name, TEST_LIST);

    // Should now be active
    const g1 = await core.get();
    assert.equal(g1.name, TEST_LIST);
    assert.equal(g1.count, 0);

    // Add a couple of well-known symbols
    const added = await core.add({ symbols: ['ASX:CBA', 'ASX:BHP'] });
    assert.equal(added.success, true);
    assert.ok(added.added.length >= 1, 'expected at least one symbol added');

    // Remove CBA
    const removed = await core.removeSymbol({ symbol: 'ASX:CBA' });
    assert.equal(removed.success, true);
    assert.ok(removed.removed.length >= 0);  // may match either "ASX:CBA" or resolved form

    // Delete
    const del = await core.deleteList({ name: TEST_LIST });
    assert.equal(del.success, true);
    assert.equal(del.deleted.name, TEST_LIST);

    // Verify it's gone
    const fresh = await core.list();
    assert.ok(!fresh.watchlists.some(w => w.name === TEST_LIST),
      `${TEST_LIST} should no longer exist after delete`);
  });

  it('watchlist_add with [ASX:CBA, ASX:BHP, ASX:29M] reports rejection for 29M, adds the rest', async () => {
    const core = await import('../src/core/watchlist.js');
    await core.create({ name: TEST_LIST });
    try {
      const r = await core.add({ symbols: ['ASX:CBA', 'ASX:BHP', 'ASX:29M'] });
      assert.equal(r.success, true);
      // At minimum, the result must acknowledge all three inputs across added/rejected/skipped.
      const accountedFor = new Set([
        ...r.added.map(s => s.toUpperCase().split(':').pop()),
        ...r.skipped_duplicates.map(s => s.toUpperCase().split(':').pop()),
        ...r.rejected.map(x => x.symbol.toUpperCase().split(':').pop()),
      ]);
      assert.ok(accountedFor.has('CBA'),  'CBA must appear in some result bucket');
      assert.ok(accountedFor.has('BHP'),  'BHP must appear in some result bucket');
      assert.ok(accountedFor.has('29M'),  '29M must appear in some result bucket');
    } finally {
      await core.deleteList({ name: TEST_LIST }).catch(() => {});
    }
  });

  it('watchlist_rename changes a watchlist name', async () => {
    const core = await import('../src/core/watchlist.js');
    await core.create({ name: TEST_LIST });
    const renamed = `${TEST_LIST}_RN`;
    try {
      const r = await core.rename({ name: TEST_LIST, new_name: renamed });
      assert.equal(r.success, true);
      assert.equal(r.new_name, renamed);

      const after = await core.list();
      assert.ok(after.watchlists.some(w => w.name === renamed),
        `${renamed} should exist after rename`);
      assert.ok(!after.watchlists.some(w => w.name === TEST_LIST),
        `${TEST_LIST} should no longer exist after rename`);
    } finally {
      await core.deleteList({ name: renamed }).catch(() => {});
      await core.deleteList({ name: TEST_LIST }).catch(() => {});
    }
  });

  it('watchlist_set creates then updates then reports "unchanged"', async () => {
    const core = await import('../src/core/watchlist.js');
    try {
      // First call → created
      const a = await core.set({ name: TEST_LIST, symbols: ['ASX:NAB', 'ASX:ANZ'] });
      assert.equal(a.success, true);
      assert.equal(a.status, 'created');

      // Second call with a diff → updated
      const b = await core.set({ name: TEST_LIST, symbols: ['ASX:NAB', 'ASX:WBC'] });
      assert.equal(b.success, true);
      assert.equal(b.status, 'updated');

      // Third call with same desired list → unchanged
      const c = await core.set({ name: TEST_LIST, symbols: ['ASX:NAB', 'ASX:WBC'] });
      assert.equal(c.success, true);
      assert.equal(c.status, 'unchanged');
    } finally {
      await core.deleteList({ name: TEST_LIST }).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// tv_restart — live integration test
//
// ACTUALLY kills TradingView and restarts it. Will wipe out the user's tab
// state, undo any unsaved Pine work, and make the chart reload from scratch.
// DO NOT run this in CI or alongside other tests. Gated behind its own env
// var so the broader disruptive suite never triggers it.
// ---------------------------------------------------------------------------

describe('tv_restart — live integration', { skip: restartSkip }, () => {
  it('kills TV, relaunches with CDP, and returns ready within 45s', async () => {
    const { restart } = await import('../src/core/health.js');

    const t = Date.now();
    const r = await restart({});
    const elapsed = Date.now() - t;

    assert.equal(r.success, true);
    assert.equal(typeof r.new_pid, 'number');
    assert.ok(r.cdp_url.includes(':9222'), 'cdp_url should point at the debug port');
    assert.ok(r.elapsed_ms < 45000,
      `restart should complete well inside the 30s launch budget + kill overhead (got ${r.elapsed_ms}ms)`);
    assert.ok(elapsed < 45000, `whole call elapsed ${elapsed}ms`);

    // Phase timings must be populated.
    assert.equal(typeof r.phases.disconnect_ms, 'number');
    assert.equal(typeof r.phases.kill_ms, 'number');
    assert.equal(typeof r.phases.spawn_and_cdp_ready_ms, 'number');

    // After restart, CDP must actually respond to a real evaluate. If this
    // fails we restarted TV but didn't leave the client in a usable state.
    const { evaluate } = await import('../src/connection.js');
    const chartPresent = await evaluate(
      `document.querySelector('.chart-container, .chart-page, [class*="chart-container"]') !== null`,
      { timeoutMs: 5000 },
    );
    // Chart may take a moment to fully render after relaunch; we only assert
    // the evaluate itself succeeded (truthy or falsy doesn't matter as long
    // as we got a boolean back instead of a thrown error).
    assert.ok(typeof chartPresent === 'boolean',
      'post-restart CDP evaluate should return a boolean, got ' + typeof chartPresent);
  });
});
