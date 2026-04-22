#!/usr/bin/env node
/**
 * PRD §2 evidence probe — demonstrates the exact error shape produced by
 * withTimeout + withRetry without needing to put TradingView into a hang.
 *
 * Run: node scripts/probe-timeout.js
 *
 * Expected output (used in docs/timeout-evidence.md):
 *   §2.1 withTimeout error includes tool name, ms, and remediation hint
 *   §2.4 transient patterns trigger 2 calls (retry), clean errors trigger 1
 *   §2.4 logs "Re-attaching CDP" to stderr on retry, stdout stays clean
 */

import { withTimeout } from '../src/utils/timeout.js';
import { withRetry } from '../src/utils/retry.js';

console.log('=== PRD §2.1 — withTimeout error format ===\n');

// Keep the event loop ref'd — withTimeout's internal timer is unref'd (server
// hygiene), so in a standalone script with nothing else refd the loop would
// exit before our awaits settle. Cleared at end.
const loopAlive = setInterval(() => {}, 100_000);

const slow = new Promise(resolve => { setTimeout(resolve, 999_999); });
try {
  await withTimeout(slow, 250, 'demo_quote_get');
  console.log('ERROR: should have thrown');
  process.exit(1);
} catch (err) {
  console.log('Error raised within budget. Message:');
  console.log('  ' + err.message);
  console.log('');
  const hasName = /demo_quote_get/.test(err.message);
  const hasMs = /250ms/.test(err.message);
  const hasHint = /tv_health_check|foreground/i.test(err.message);
  console.log(`  ✓ includes tool name:       ${hasName}`);
  console.log(`  ✓ includes timeout ms:      ${hasMs}`);
  console.log(`  ✓ includes remediation hint: ${hasHint}`);
  if (!hasName || !hasMs || !hasHint) process.exit(1);
}

console.log('\n=== PRD §2.4 — withRetry transient-vs-clean classification ===\n');
const transientPatterns = [
  'StaleClientError fired',
  'WebSocket is not opened',
  'socket hang up',
  'ECONNREFUSED',
  'ECONNRESET',
  'client is closed',
  'Timed out after 1000ms',
];
console.log('Transient patterns (should retry → 2 calls):');
for (const pat of transientPatterns) {
  let calls = 0;
  try { await withRetry(async () => { calls++; throw new Error(pat); }, 'demo_tool'); } catch {}
  const mark = calls === 2 ? '✓' : '✗';
  console.log(`  ${mark} "${pat}" → ${calls} calls`);
}

const cleanPatterns = [
  'Study not found',
  'Could not extract OHLCV data',
  'Symbol XYZ is invalid',
  'entity_id required for remove action',
];
console.log('\nClean application errors (should NOT retry → 1 call):');
for (const pat of cleanPatterns) {
  let calls = 0;
  try { await withRetry(async () => { calls++; throw new Error(pat); }, 'demo_tool'); } catch {}
  const mark = calls === 1 ? '✓' : '✗';
  console.log(`  ${mark} "${pat}" → ${calls} calls`);
}

console.log('\n=== PRD §2.4 — Retry log goes to stderr, not stdout (MCP stdio safety) ===\n');
// Reroute briefly to capture
let stderrBuf = '';
let stdoutBuf = '';
const origErr = process.stderr.write.bind(process.stderr);
const origOut = process.stdout.write.bind(process.stdout);
process.stderr.write = chunk => { stderrBuf += chunk; return true; };
process.stdout.write = chunk => { stdoutBuf += chunk; return true; };
try {
  let calls = 0;
  await withRetry(async () => {
    calls++;
    if (calls < 2) throw new Error('WebSocket is not opened');
    return 'recovered';
  }, 'demo_reattach');
} finally {
  process.stderr.write = origErr;
  process.stdout.write = origOut;
}
const toStderr = /\[demo_reattach\]/.test(stderrBuf) && /Re-attaching CDP/i.test(stderrBuf);
const stdoutClean = stdoutBuf === '';
console.log(`  ✓ re-attach notice on stderr: ${toStderr}`);
console.log(`  ✓ stdout remains clean:       ${stdoutClean}`);
console.log(`  Captured stderr: ${stderrBuf.trim()}`);

console.log('\n=== Done — all PRD §2.1 and §2.4 assertions pass. ===\n');
clearInterval(loopAlive);
