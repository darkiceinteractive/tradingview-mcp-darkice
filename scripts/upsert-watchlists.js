#!/usr/bin/env node
/**
 * Bulk watchlist UPSERT driver — PRD §5.2.
 *
 * Reads a JSON file of {name, symbols} entries and calls watchlist_set for
 * each one sequentially. Safe to re-run: watchlist_set is idempotent so
 * repeated runs report "unchanged" for lists already at the desired state.
 *
 * Accepts either:
 *   [{ "name": "...", "symbols": [...] }, ...]
 * or:
 *   { "watchlists": [{...}, ...] }
 *
 * Usage:
 *   node scripts/upsert-watchlists.js                 # default: data/watchlists.json
 *   node scripts/upsert-watchlists.js my-file.json    # custom path
 *   node scripts/upsert-watchlists.js --dry-run       # validate + count only
 *
 * Exit codes:
 *   0 — all entries ran (some may have failed individually; see report)
 *   1 — file missing, schema invalid, or fatal error
 *
 * The core orchestration is exported (runUpsert, validate, aggregateReport)
 * so it is unit-testable without touching TradingView.
 */

import { readFileSync, existsSync } from 'node:fs';

/**
 * Validate a single entry. Throws with a prefixed message on first issue.
 * Empty symbol arrays are rejected — we refuse to create a list with nothing
 * in it, because `watchlist_set` treats an empty desired state as "delete
 * everything" and that is surprising in a bulk driver.
 */
export function validateEntry(entry, index) {
  const where = `entry[${index}]${entry?.name ? ` ("${entry.name}")` : ''}`;
  if (entry == null || typeof entry !== 'object') {
    throw new Error(`${where}: must be an object`);
  }
  if (typeof entry.name !== 'string' || !entry.name.trim()) {
    throw new Error(`${where}: "name" must be a non-empty string`);
  }
  if (!Array.isArray(entry.symbols)) {
    throw new Error(`${where}: "symbols" must be an array`);
  }
  if (entry.symbols.length === 0) {
    throw new Error(`${where}: "symbols" is empty — refusing to create an empty list. Add at least one symbol or remove the entry.`);
  }
  for (let i = 0; i < entry.symbols.length; i++) {
    const s = entry.symbols[i];
    if (typeof s !== 'string' || !s.trim()) {
      throw new Error(`${where}: symbols[${i}] must be a non-empty string, got ${JSON.stringify(s)}`);
    }
  }
  // Warn on duplicates within the same list — not fatal, but usually a copy-paste bug.
  const seen = new Set();
  const dupes = [];
  for (const s of entry.symbols) {
    const key = s.trim().toUpperCase();
    if (seen.has(key)) dupes.push(s);
    seen.add(key);
  }
  return { duplicates_in_source: dupes };
}

/**
 * Parse + validate the input file. Returns the normalized list array.
 * Also detects duplicate names across entries (would cause later entries to
 * overwrite earlier ones silently).
 */
export function parseInput(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error(`Input is not valid JSON: ${e.message}`); }

  const entries = Array.isArray(parsed) ? parsed
    : (parsed && Array.isArray(parsed.watchlists)) ? parsed.watchlists
    : null;
  if (!entries) {
    throw new Error('Expected a top-level JSON array OR an object with a "watchlists" array.');
  }
  if (entries.length === 0) {
    throw new Error('Input contains zero watchlists — nothing to do.');
  }

  const perEntryWarnings = [];
  entries.forEach((e, i) => perEntryWarnings.push(validateEntry(e, i)));

  const nameCount = new Map();
  for (const e of entries) {
    const k = e.name;
    nameCount.set(k, (nameCount.get(k) || 0) + 1);
  }
  const dupeNames = [...nameCount.entries()].filter(([, n]) => n > 1).map(([name]) => name);
  if (dupeNames.length) {
    throw new Error(`Duplicate list name(s) in input: ${dupeNames.join(', ')}. Each list name must be unique.`);
  }

  return { entries, warnings: perEntryWarnings };
}

/**
 * Aggregate per-entry results into a summary report. Pure function — easy
 * to test against hand-crafted result arrays.
 */
export function aggregateReport(results) {
  const rejected = new Map(); // symbol -> Set<list names it failed in>
  let created = 0, updated = 0, unchanged = 0, failed = 0;

  for (const r of results) {
    if (r.success === false) { failed++; continue; }
    if (r.status === 'created') created++;
    else if (r.status === 'updated') updated++;
    else if (r.status === 'unchanged') unchanged++;

    for (const rej of (r.rejected || [])) {
      const sym = rej.symbol || rej;
      if (!rejected.has(sym)) rejected.set(sym, new Set());
      rejected.get(sym).add(r.name);
    }
  }

  return {
    total: results.length,
    created, updated, unchanged, failed,
    rejected_symbols: [...rejected.entries()].map(([sym, lists]) => ({
      symbol: sym,
      rejected_in_lists: [...lists],
    })).sort((a, b) => a.symbol.localeCompare(b.symbol)),
    details: results,
  };
}

/**
 * Core orchestration — loops over the validated entries and calls setFn
 * for each one. setFn is injected so tests can run without TradingView.
 *
 * setFn signature must match src/core/watchlist.js#set:
 *   ({ name, symbols }) => Promise<{ success, status, added?, removed?, rejected? }>
 *
 * logFn defaults to writing to stderr so MCP stdio stays clean. Tests
 * supply a capturing function.
 */
export async function runUpsert({ entries, setFn, logFn = (m) => process.stderr.write(m + '\n') }) {
  const results = [];
  logFn(`Upserting ${entries.length} watchlists...`);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    logFn(`[${i + 1}/${entries.length}] ${entry.name}: ${entry.symbols.length} symbols`);
    try {
      const r = await setFn({ name: entry.name, symbols: entry.symbols });
      const added = r.added?.length ?? 0;
      const removed = r.removed?.length ?? 0;
      const rejected = r.rejected?.length ?? 0;
      logFn(`  → ${r.status} (added=${added}, removed=${removed}, rejected=${rejected})`);
      results.push({ name: entry.name, ...r });
    } catch (err) {
      logFn(`  → FAILED: ${err.message}`);
      results.push({ name: entry.name, success: false, error: err.message });
    }
  }
  return aggregateReport(results);
}

// --- CLI wrapper (skipped when imported as a module) -----------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const path = args.find(a => !a.startsWith('--')) || 'data/watchlists.json';

  if (!existsSync(path)) {
    console.error(`No such file: ${path}`);
    console.error(`Copy data/watchlists.example.json to ${path} and fill in your 24 lists.`);
    process.exit(1);
  }

  let entries, warnings;
  try {
    ({ entries, warnings } = parseInput(readFileSync(path, 'utf8')));
  } catch (e) {
    console.error(`Schema error: ${e.message}`);
    process.exit(1);
  }

  const totalSymbols = entries.reduce((n, e) => n + e.symbols.length, 0);
  const dupeWarnings = warnings.flatMap((w, i) =>
    (w.duplicates_in_source || []).map(s => `${entries[i].name}: duplicate symbol ${s}`));
  for (const w of dupeWarnings) process.stderr.write(`WARN: ${w}\n`);

  if (dryRun) {
    console.log(JSON.stringify({
      dry_run: true,
      lists: entries.length,
      total_symbols: totalSymbols,
      lists_summary: entries.map(e => ({ name: e.name, count: e.symbols.length })),
      duplicate_warnings: dupeWarnings,
    }, null, 2));
    return;
  }

  const { set } = await import('../src/core/watchlist.js');
  const { disconnect } = await import('../src/connection.js');

  let report;
  try {
    report = await runUpsert({ entries, setFn: set });
  } finally {
    // Always release the CDP singleton so the Node process exits cleanly.
    await disconnect().catch(() => {});
  }

  console.log(JSON.stringify(report, null, 2));
}

// Only run main() when executed directly, not when imported by tests.
const isDirectRun = import.meta.url === `file://${process.argv[1]}`
  || process.argv[1]?.endsWith('upsert-watchlists.js');
if (isDirectRun) {
  main().catch(err => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
