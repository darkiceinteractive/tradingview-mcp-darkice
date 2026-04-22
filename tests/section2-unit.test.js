/**
 * Unit tests for PRD Section 2 infrastructure.
 * Pure unit — no TradingView / CDP connection required. Safe to run in CI.
 *
 * Covers:
 *   Section 2.1 — withTimeout / env config (src/utils/timeout.js)
 *   Section 2.4 — withRetry decorator (src/utils/retry.js)
 *   Section 2.6 — tv_launch source-level contract (src/core/health.js)
 *
 * Run: node --test tests/section2-unit.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Section 2.1 — withTimeout / getToolTimeoutMs / getLaunchTimeoutMs
// ---------------------------------------------------------------------------

describe('Section 2.1 — withTimeout & env config', () => {
  beforeEach(() => {
    delete process.env.TV_MCP_TOOL_TIMEOUT_MS;
    delete process.env.TV_MCP_LAUNCH_TIMEOUT_MS;
  });

  it('resolves when the wrapped promise settles before the deadline', async () => {
    const { withTimeout } = await import('../src/utils/timeout.js');
    const result = await withTimeout(Promise.resolve(42), 500, 'unit');
    assert.equal(result, 42);
  });

  it('rejects with a message containing tool name, ms, and remediation hint', async () => {
    const { withTimeout } = await import('../src/utils/timeout.js');
    const slow = new Promise(res => { const t = setTimeout(res, 1000); t.unref?.(); });
    await assert.rejects(
      () => withTimeout(slow, 50, 'quote_get'),
      (err) => {
        assert.match(err.message, /\[quote_get\]/);
        assert.match(err.message, /50ms/);
        assert.match(err.message, /tv_health_check/);
        assert.match(err.message, /foreground/);
        return true;
      },
    );
  });

  it('default tool timeout is 15000ms', async () => {
    const { getToolTimeoutMs } = await import('../src/utils/timeout.js');
    assert.equal(getToolTimeoutMs(), 15000);
  });

  it('default launch timeout is 30000ms', async () => {
    const { getLaunchTimeoutMs } = await import('../src/utils/timeout.js');
    assert.equal(getLaunchTimeoutMs(), 30000);
  });

  it('honours TV_MCP_TOOL_TIMEOUT_MS override', async () => {
    process.env.TV_MCP_TOOL_TIMEOUT_MS = '5000';
    const { getToolTimeoutMs } = await import('../src/utils/timeout.js');
    assert.equal(getToolTimeoutMs(), 5000);
  });

  it('honours TV_MCP_LAUNCH_TIMEOUT_MS override', async () => {
    process.env.TV_MCP_LAUNCH_TIMEOUT_MS = '45000';
    const { getLaunchTimeoutMs } = await import('../src/utils/timeout.js');
    assert.equal(getLaunchTimeoutMs(), 45000);
  });

  it('falls back to default on non-numeric env', async () => {
    process.env.TV_MCP_TOOL_TIMEOUT_MS = 'garbage';
    const { getToolTimeoutMs } = await import('../src/utils/timeout.js');
    assert.equal(getToolTimeoutMs(), 15000);
  });

  it('falls back to default on zero / negative env', async () => {
    process.env.TV_MCP_TOOL_TIMEOUT_MS = '-5';
    const { getToolTimeoutMs } = await import('../src/utils/timeout.js');
    assert.equal(getToolTimeoutMs(), 15000);
    process.env.TV_MCP_TOOL_TIMEOUT_MS = '0';
    assert.equal(getToolTimeoutMs(), 15000);
  });

  it('withToolTimeout honours the current env value at call time', async () => {
    process.env.TV_MCP_TOOL_TIMEOUT_MS = '60';
    const { withToolTimeout } = await import('../src/utils/timeout.js');
    const slow = new Promise(res => { const t = setTimeout(res, 500); t.unref?.(); });
    await assert.rejects(() => withToolTimeout(slow, 'env_tool'), /60ms/);
  });
});

// ---------------------------------------------------------------------------
// Section 2.4 — withRetry
// ---------------------------------------------------------------------------

describe('Section 2.4 — withRetry', () => {
  // Silence the expected stderr re-attach logs during this block so test output
  // stays clean. Restore after each test.
  let stderrWrite;
  beforeEach(() => {
    stderrWrite = process.stderr.write;
    process.stderr.write = () => true;
  });

  function restoreStderr() { process.stderr.write = stderrWrite; }

  it('non-transient error throws on the first attempt (no retry)', async () => {
    const { withRetry } = await import('../src/utils/retry.js');
    let calls = 0;
    try {
      await assert.rejects(
        () => withRetry(async () => { calls++; throw new Error('Study not found'); }, 'unit'),
        /Study not found/,
      );
      assert.equal(calls, 1, 'should not retry non-transient errors');
    } finally { restoreStderr(); }
  });

  it('transient error recovers on the second attempt', async () => {
    const { withRetry } = await import('../src/utils/retry.js');
    let calls = 0;
    try {
      const result = await withRetry(async () => {
        calls++;
        if (calls < 2) throw new Error('WebSocket is not opened');
        return 'ok';
      }, 'unit');
      assert.equal(result, 'ok');
      assert.equal(calls, 2);
    } finally { restoreStderr(); }
  });

  it('transient error exhausts after exactly 2 attempts', async () => {
    const { withRetry } = await import('../src/utils/retry.js');
    let calls = 0;
    try {
      await assert.rejects(
        () => withRetry(async () => { calls++; throw new Error('Timed out after 1000ms'); }, 'unit'),
        /Timed out/,
      );
      assert.equal(calls, 2);
    } finally { restoreStderr(); }
  });

  it('recognises each documented transient pattern', async () => {
    const { withRetry } = await import('../src/utils/retry.js');
    const patterns = [
      'StaleClientError fired',
      'WebSocket connection was lost',
      'socket hang up',
      'ECONNREFUSED',
      'ECONNRESET',
      'client is closed',
      'not opened',
      'Timed out after 200ms',
      'timed out waiting for reply',
    ];
    try {
      for (const p of patterns) {
        let calls = 0;
        try { await withRetry(async () => { calls++; throw new Error(p); }, 'unit'); }
        catch { /* expected */ }
        assert.equal(calls, 2, `pattern "${p}" should trigger retry (expected 2 calls, got ${calls})`);
      }
    } finally { restoreStderr(); }
  });

  it('does NOT retry clean application-level error messages', async () => {
    const { withRetry } = await import('../src/utils/retry.js');
    const patterns = [
      'Study not found',
      'Could not extract OHLCV data',
      'Symbol XYZ is invalid',
      'entity_id required for remove action',
    ];
    try {
      for (const p of patterns) {
        let calls = 0;
        try { await withRetry(async () => { calls++; throw new Error(p); }, 'unit'); }
        catch { /* expected */ }
        assert.equal(calls, 1, `pattern "${p}" should NOT retry (expected 1 call, got ${calls})`);
      }
    } finally { restoreStderr(); }
  });

  it('writes re-attach notice to stderr (not stdout) on retry', async () => {
    const { withRetry } = await import('../src/utils/retry.js');
    let stderrBuf = '';
    let stdoutBuf = '';
    const origErr = process.stderr.write;
    const origOut = process.stdout.write;
    process.stderr.write = (chunk) => { stderrBuf += chunk; return true; };
    process.stdout.write = (chunk) => { stdoutBuf += chunk; return true; };
    try {
      let calls = 0;
      await withRetry(async () => {
        calls++;
        if (calls < 2) throw new Error('WebSocket is not opened');
        return 'ok';
      }, 'my_tool');
    } finally {
      process.stderr.write = origErr;
      process.stdout.write = origOut;
    }
    assert.match(stderrBuf, /\[my_tool\]/);
    assert.match(stderrBuf, /Re-attaching CDP/);
    assert.equal(stdoutBuf, '', 'stdout must remain clean — MCP stdio protocol');
  });
});

// ---------------------------------------------------------------------------
// Section 2.6 — tv_launch source-level contract
//
// We check the source code directly rather than executing launch(), because
// launch() kills TradingView by default and would destroy other test context.
// These assertions are sufficient because the control flow is simple and
// the PRD-mandated constants / error string are what matter.
// ---------------------------------------------------------------------------

describe('Section 2.6 — launch() source-level contract', () => {
  const healthSrc = readFileSync(resolve(repoRoot, 'src/core/health.js'), 'utf8');

  it('contains the PRD-mandated 30s timeout error string', () => {
    assert.match(
      healthSrc,
      /TradingView did not start within 30s\. Try launching it manually with --remote-debugging-port=/,
    );
  });

  it('uses a 500ms poll interval', () => {
    assert.match(healthSrc, /POLL_INTERVAL_MS\s*=\s*500\b/);
  });

  it('uses a 30_000ms total poll budget', () => {
    assert.match(healthSrc, /POLL_BUDGET_MS\s*=\s*30_?000\b/);
  });

  it('uses fetch + AbortController for per-request timeout', () => {
    assert.match(healthSrc, /AbortController\s*\(/);
    assert.match(healthSrc, /fetch\(cdpVersionUrl/);
  });

  it('no longer returns a soft success with cdp_ready:false on timeout', () => {
    // The old behaviour returned a success object with cdp_ready:false and a
    // warning string. PRD 2.6 requires a hard throw instead.
    assert.doesNotMatch(healthSrc, /cdp_ready:\s*false/);
    assert.doesNotMatch(healthSrc, /warning:\s*['"]TradingView launched but CDP not responding/);
  });
});
