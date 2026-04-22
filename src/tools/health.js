import { z } from 'zod';
import { jsonResult } from './_format.js';
import { withToolTimeout, withLaunchTimeout } from '../utils/timeout.js';
import * as core from '../core/health.js';

export function registerHealthTools(server) {
  // Exempt per PRD Section 2.1 — tv_health_check has its own fast-fail logic.
  server.tool('tv_health_check', 'Check CDP connection to TradingView and return current chart state', {}, async () => {
    try { return jsonResult(await core.healthCheck()); }
    catch (err) { return jsonResult({ success: false, error: err.message, hint: 'TradingView is not running with CDP enabled. Use the tv_launch tool to start it automatically.' }, true); }
  });

  // Exempt per PRD Section 2.1 — tv_discover has its own fast-fail logic.
  server.tool('tv_discover', 'Report which known TradingView API paths are available and their methods', {}, async () => {
    try { return jsonResult(await core.discover()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tv_ui_state', 'Get current UI state: which panels are open, what buttons are visible/enabled/disabled', {}, async () => {
    try { return jsonResult(await withToolTimeout(core.uiState(), 'tv_ui_state')); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tv_launch', 'Launch TradingView Desktop with Chrome DevTools Protocol (remote debugging) enabled. Auto-detects install location on Mac, Windows, and Linux.', {
    port: z.coerce.number().optional().describe('CDP port (default 9222)'),
    kill_existing: z.coerce.boolean().optional().describe('Kill existing TradingView instances first (default true)'),
  }, async ({ port, kill_existing }) => {
    try { return jsonResult(await withLaunchTimeout(core.launch({ port, kill_existing }), 'tv_launch')); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
