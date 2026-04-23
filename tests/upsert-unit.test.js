/**
 * Unit + integration tests for scripts/upsert-watchlists.js.
 *
 * Unit: validateEntry, parseInput, aggregateReport — pure functions.
 * Integration (still offline): runUpsert with a mocked setFn, verifies the
 * orchestration calls setFn once per entry, aggregates results correctly,
 * and keeps going after individual failures.
 *
 * Run: node --test tests/upsert-unit.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const {
  validateEntry,
  parseInput,
  aggregateReport,
  runUpsert,
} = await import('../scripts/upsert-watchlists.js');

// ---------------------------------------------------------------------------
// validateEntry
// ---------------------------------------------------------------------------

describe('validateEntry', () => {
  it('accepts a valid entry', () => {
    const r = validateEntry({ name: 'X', symbols: ['ASX:CBA', 'ASX:NAB'] }, 0);
    assert.deepEqual(r.duplicates_in_source, []);
  });

  it('flags duplicates within the same list (non-fatal)', () => {
    const r = validateEntry({ name: 'X', symbols: ['ASX:CBA', 'asx:cba'] }, 0);
    assert.deepEqual(r.duplicates_in_source, ['asx:cba']);
  });

  it('rejects non-object entries', () => {
    assert.throws(() => validateEntry(null, 0), /must be an object/);
    assert.throws(() => validateEntry('string', 0), /must be an object/);
    assert.throws(() => validateEntry(42, 0), /must be an object/);
  });

  it('rejects empty or non-string name', () => {
    assert.throws(() => validateEntry({ name: '', symbols: ['X'] }, 0), /"name".*non-empty string/);
    assert.throws(() => validateEntry({ name: '   ', symbols: ['X'] }, 0), /"name".*non-empty string/);
    assert.throws(() => validateEntry({ name: 123, symbols: ['X'] }, 0), /"name".*non-empty string/);
    assert.throws(() => validateEntry({ symbols: ['X'] }, 0), /"name".*non-empty string/);
  });

  it('rejects non-array symbols', () => {
    assert.throws(() => validateEntry({ name: 'X', symbols: 'ASX:CBA' }, 0), /"symbols" must be an array/);
    assert.throws(() => validateEntry({ name: 'X' }, 0), /"symbols" must be an array/);
  });

  it('refuses to create an empty list', () => {
    assert.throws(() => validateEntry({ name: 'X', symbols: [] }, 0), /"symbols" is empty/);
  });

  it('rejects invalid symbol values', () => {
    assert.throws(
      () => validateEntry({ name: 'X', symbols: ['ASX:CBA', 42] }, 0),
      /symbols\[1\] must be a non-empty string/,
    );
    assert.throws(
      () => validateEntry({ name: 'X', symbols: ['ASX:CBA', '  '] }, 0),
      /symbols\[1\] must be a non-empty string/,
    );
  });

  it('error messages include the list name and index for locatability', () => {
    try {
      validateEntry({ name: 'ASX_BANKS', symbols: null }, 3);
      assert.fail('should have thrown');
    } catch (e) {
      assert.match(e.message, /entry\[3\]/);
      assert.match(e.message, /ASX_BANKS/);
    }
  });
});

// ---------------------------------------------------------------------------
// parseInput
// ---------------------------------------------------------------------------

describe('parseInput', () => {
  it('accepts top-level array form', () => {
    const raw = JSON.stringify([
      { name: 'A', symbols: ['ASX:CBA'] },
      { name: 'B', symbols: ['ASX:BHP'] },
    ]);
    const { entries } = parseInput(raw);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].name, 'A');
  });

  it('accepts { watchlists: [...] } form', () => {
    const raw = JSON.stringify({
      watchlists: [{ name: 'A', symbols: ['ASX:CBA'] }],
    });
    const { entries } = parseInput(raw);
    assert.equal(entries.length, 1);
  });

  it('rejects malformed JSON', () => {
    assert.throws(() => parseInput('{broken'), /not valid JSON/);
  });

  it('rejects unexpected shapes', () => {
    assert.throws(() => parseInput('{"foo":"bar"}'), /top-level JSON array OR .* "watchlists" array/);
    assert.throws(() => parseInput('"just a string"'), /top-level JSON array OR .* "watchlists" array/);
  });

  it('rejects empty input', () => {
    assert.throws(() => parseInput('[]'), /zero watchlists/);
    assert.throws(() => parseInput('{"watchlists":[]}'), /zero watchlists/);
  });

  it('rejects duplicate list names across entries', () => {
    const raw = JSON.stringify([
      { name: 'A', symbols: ['ASX:CBA'] },
      { name: 'A', symbols: ['ASX:BHP'] },
    ]);
    assert.throws(() => parseInput(raw), /Duplicate list name.*A/);
  });

  it('propagates per-entry validation errors', () => {
    const raw = JSON.stringify([{ name: '', symbols: ['X'] }]);
    assert.throws(() => parseInput(raw), /entry\[0\].*non-empty string/);
  });

  it('the example file is schema-valid', () => {
    // If we ship an example file, it had better parse.
    const example = readFileSync(
      resolve(repoRoot, 'data/watchlists.example.json'),
      'utf8',
    );
    const { entries } = parseInput(example);
    assert.ok(entries.length >= 1);
    for (const e of entries) {
      assert.equal(typeof e.name, 'string');
      assert.ok(Array.isArray(e.symbols));
      assert.ok(e.symbols.length > 0);
    }
  });
});

// ---------------------------------------------------------------------------
// aggregateReport
// ---------------------------------------------------------------------------

describe('aggregateReport', () => {
  it('counts created / updated / unchanged / failed separately', () => {
    const results = [
      { name: 'A', success: true, status: 'created' },
      { name: 'B', success: true, status: 'updated' },
      { name: 'C', success: true, status: 'unchanged' },
      { name: 'D', success: false, error: 'boom' },
    ];
    const r = aggregateReport(results);
    assert.equal(r.total, 4);
    assert.equal(r.created, 1);
    assert.equal(r.updated, 1);
    assert.equal(r.unchanged, 1);
    assert.equal(r.failed, 1);
  });

  it('aggregates rejected symbols across lists', () => {
    const results = [
      {
        name: 'List1', success: true, status: 'created',
        rejected: [{ symbol: 'ASX:29M', reason: 'x' }, { symbol: 'ASX:360', reason: 'y' }],
      },
      {
        name: 'List2', success: true, status: 'updated',
        rejected: [{ symbol: 'ASX:29M', reason: 'x' }],
      },
      { name: 'List3', success: true, status: 'unchanged', rejected: [] },
    ];
    const r = aggregateReport(results);
    assert.equal(r.rejected_symbols.length, 2);
    const m29 = r.rejected_symbols.find(x => x.symbol === 'ASX:29M');
    assert.ok(m29);
    assert.deepEqual(m29.rejected_in_lists.sort(), ['List1', 'List2']);
    const m360 = r.rejected_symbols.find(x => x.symbol === 'ASX:360');
    assert.deepEqual(m360.rejected_in_lists, ['List1']);
  });

  it('handles plain-string rejected entries (tolerant to impl variation)', () => {
    const results = [
      { name: 'L', success: true, status: 'created', rejected: ['ASX:29M'] },
    ];
    const r = aggregateReport(results);
    assert.equal(r.rejected_symbols[0].symbol, 'ASX:29M');
  });

  it('copes with results missing the rejected field', () => {
    const results = [{ name: 'L', success: true, status: 'unchanged' }];
    const r = aggregateReport(results);
    assert.deepEqual(r.rejected_symbols, []);
  });
});

// ---------------------------------------------------------------------------
// runUpsert — integration test with mocked setFn
// ---------------------------------------------------------------------------

describe('runUpsert', () => {
  it('calls setFn once per entry with the expected args and aggregates', async () => {
    const calls = [];
    const setFn = async ({ name, symbols }) => {
      calls.push({ name, symbols });
      return { success: true, status: 'created', added: symbols, removed: [], rejected: [] };
    };

    const entries = [
      { name: 'A', symbols: ['ASX:CBA'] },
      { name: 'B', symbols: ['ASX:BHP', 'ASX:RIO'] },
    ];
    const logs = [];
    const report = await runUpsert({ entries, setFn, logFn: (m) => logs.push(m) });

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { name: 'A', symbols: ['ASX:CBA'] });
    assert.deepEqual(calls[1], { name: 'B', symbols: ['ASX:BHP', 'ASX:RIO'] });
    assert.equal(report.total, 2);
    assert.equal(report.created, 2);
    // Log shape includes progress counter + per-entry status
    assert.ok(logs.some(l => /1\/2/.test(l)));
    assert.ok(logs.some(l => /2\/2/.test(l)));
    assert.ok(logs.some(l => /created/.test(l)));
  });

  it('continues past a failing entry (does NOT abort the batch)', async () => {
    let i = 0;
    const setFn = async ({ name }) => {
      i++;
      if (name === 'BREAKS') throw new Error('network blip');
      return { success: true, status: 'created', added: [], removed: [], rejected: [] };
    };

    const entries = [
      { name: 'OK1', symbols: ['X'] },
      { name: 'BREAKS', symbols: ['X'] },
      { name: 'OK2', symbols: ['X'] },
    ];
    const report = await runUpsert({ entries, setFn, logFn: () => {} });

    assert.equal(i, 3, 'all three entries must be attempted');
    assert.equal(report.created, 2);
    assert.equal(report.failed, 1);
    const failed = report.details.find(d => d.name === 'BREAKS');
    assert.equal(failed.success, false);
    assert.match(failed.error, /network blip/);
  });

  it('aggregates rejected symbols across the whole batch', async () => {
    const setFn = async ({ name }) => ({
      success: true, status: 'updated', added: [], removed: [],
      rejected: name === 'L1'
        ? [{ symbol: 'ASX:29M', reason: 'r' }]
        : [{ symbol: 'ASX:29M', reason: 'r' }, { symbol: 'ASX:360', reason: 'r' }],
    });

    const entries = [
      { name: 'L1', symbols: ['A'] },
      { name: 'L2', symbols: ['B'] },
    ];
    const report = await runUpsert({ entries, setFn, logFn: () => {} });
    const m29 = report.rejected_symbols.find(x => x.symbol === 'ASX:29M');
    assert.deepEqual(m29.rejected_in_lists.sort(), ['L1', 'L2']);
    assert.equal(report.rejected_symbols.length, 2);
  });
});

// ---------------------------------------------------------------------------
// CLI binding — smoke-test the argv handling without actually calling setFn
// ---------------------------------------------------------------------------

describe('CLI contract (source-level)', () => {
  const src = readFileSync(
    resolve(repoRoot, 'scripts/upsert-watchlists.js'),
    'utf8',
  );

  it('supports --dry-run mode', () => {
    assert.match(src, /--dry-run/);
  });

  it('defaults to data/watchlists.json when no path supplied', () => {
    assert.match(src, /data\/watchlists\.json/);
  });

  it('disconnects CDP in finally so the process exits cleanly', () => {
    assert.match(src, /await disconnect\(\)/);
  });

  it('exits 1 on schema error', () => {
    assert.match(src, /Schema error.*process\.exit\(1\)/s);
  });
});
