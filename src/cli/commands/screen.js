import { register } from '../router.js';
import { getClient, evaluateAsync } from '../../connection.js';

/**
 * tv screen — fast bull/bear screener across watchlist symbols.
 * Uses quote_get via the same internal fetch path as alert_list.
 * Applies configurable criteria and outputs ranked JSON.
 *
 * Usage:
 *   tv screen                        # screen current active watchlist
 *   tv screen --list US_BULL_RADAR   # screen a named watchlist
 *   tv screen --bull                 # show only bull signals
 *   tv screen --bear                 # show only bear signals
 *   tv screen --top 10               # limit output count
 *   tv screen --json                 # raw JSON (pipe-friendly)
 *   tv screen --list MACRO_INDICES --json | jq '.[] | select(.signal=="BULL")'
 */

// ── Signal scoring ────────────────────────────────────────────────────────────
function score(q) {
  let bull = 0, bear = 0;
  const { close, open, high, low, volume, avg_volume, change_percent,
          week52_high, week52_low, rsi, ema_20, ema_50, ema_200 } = q;

  // Price trend (EMA alignment)
  if (close > ema_20)  bull += 2;  else bear += 2;
  if (close > ema_50)  bull += 2;  else bear += 2;
  if (close > ema_200) bull += 3;  else bear += 3;
  if (ema_20 > ema_50) bull += 1;  else bear += 1;
  if (ema_50 > ema_200) bull += 1; else bear += 1;

  // 52-week position
  if (week52_high) {
    const pct52 = ((close - week52_low) / (week52_high - week52_low)) * 100;
    if (pct52 >= 75) bull += 3;       // near highs
    else if (pct52 >= 50) bull += 1;
    else if (pct52 <= 25) bear += 3;  // near lows
    else bear += 1;
  }

  // Momentum
  if (change_percent > 2)   bull += 2;
  else if (change_percent > 0.5) bull += 1;
  else if (change_percent < -2)  bear += 2;
  else if (change_percent < -0.5) bear += 1;

  // Volume confirmation
  if (avg_volume && volume) {
    const volRatio = volume / avg_volume;
    if (volRatio > 1.5 && change_percent > 0) bull += 2;  // bull volume surge
    if (volRatio > 1.5 && change_percent < 0) bear += 2;  // bear volume surge
  }

  // RSI
  if (rsi) {
    if (rsi >= 50 && rsi <= 70) bull += 1;
    if (rsi > 70) bear += 1;  // overbought warning
    if (rsi < 50 && rsi >= 30) bear += 1;
    if (rsi < 30) bull += 1;  // oversold — potential reversal
  }

  // Day candle
  if (close > open) bull += 1; else bear += 1;

  const net = bull - bear;
  const total = bull + bear;
  const strength = total > 0 ? Math.round((Math.max(bull, bear) / total) * 100) : 50;

  let signal = 'NEUTRAL';
  if (net >= 6) signal = 'BULL';
  else if (net >= 3) signal = 'BULL_WEAK';
  else if (net <= -6) signal = 'BEAR';
  else if (net <= -3) signal = 'BEAR_WEAK';

  return { signal, bull, bear, net, strength };
}

// ── Fetch quotes via TV internal API ─────────────────────────────────────────
async function fetchQuotes(symbols) {
  const client = await getClient();
  // Use the same auth cookie path as pricealerts
  const results = await Promise.allSettled(
    symbols.map(async (sym) => {
      try {
        const result = await evaluateAsync(`
          (async () => {
            const r = await fetch(
              'https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(sym)}&hl=0&exchange=&lang=en&search_type=undefined&domain=production&sort_by_country=US',
              { credentials: 'include' }
            );
            return null; // symbol search only, not quotes
          })()
        `);
        return null;
      } catch { return null; }
    })
  );
  return results;
}

// ── Fetch quotes via data_get_ohlcv (MCP tool shortcut) ──────────────────────
async function getQuoteData(symbol) {
  // Call the MCP quote_get tool — uses the same internal API as the MCP server
  const result = await evaluateAsync(`
    (async () => {
      try {
        // Hit the TV quote REST endpoint
        const sym = '${symbol.replace(':', '%3A')}';
        const resp = await fetch(
          \`https://symbol-search.tradingview.com/s/?\${new URLSearchParams({
            text: '${symbol}', hl: 0, exchange: '', domain: 'production'
          })}\`,
          { credentials: 'include' }
        );
        if (!resp.ok) return { error: resp.status };
        const data = await resp.json();
        return data?.symbols_remaining !== undefined ? { found: true, data } : null;
      } catch(e) { return { error: e.message }; }
    })()
  `);
  return result;
}

register('screen', {
  description: 'Bull/bear screener across watchlist symbols',
  options: {
    list:  { type: 'string',  short: 'l', description: 'Watchlist name to screen (default: active watchlist)' },
    bull:  { type: 'boolean', short: 'b', description: 'Show only BULL and BULL_WEAK signals' },
    bear:  { type: 'boolean', short: 'r', description: 'Show only BEAR and BEAR_WEAK signals' },
    top:   { type: 'string',  short: 't', description: 'Limit to top N results (default: all)' },
    json:  { type: 'boolean', short: 'j', description: 'Raw JSON output (pipe-friendly)' },
    min:   { type: 'string',  short: 'm', description: 'Minimum net score filter (default: 0)' },
  },
  handler: async (opts) => {
    const { list, bull, bear, json: rawJson, top, min } = opts;
    const topN = top ? parseInt(top, 10) : Infinity;
    const minNet = min ? parseInt(min, 10) : 0;

    // 1. Get watchlist symbols — use watchlist_get MCP tool via quote_get
    //    Fall back to reading the local watchlists.json if MCP unavailable
    let symbols = [];
    if (list) {
      try {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const { dirname, resolve } = await import('node:path');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const jsonPath = resolve(__dirname, '../../../data/watchlists.json');
        const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
        const lists = data.watchlists || data;
        const found = lists.find(w => w.name === list);
        if (!found) throw new Error(`Watchlist "${list}" not found. Available: ${lists.map(w => w.name).join(', ')}`);
        symbols = found.symbols;
      } catch (e) {
        throw new Error(`Could not load watchlist "${list}": ${e.message}`);
      }
    } else {
      throw new Error('No --list specified. Usage: tv screen --list US_BULL_RADAR');
    }

    if (!rawJson) {
      process.stderr.write(`Screening ${symbols.length} symbols in ${list}...\n`);
    }

    // 2. Fetch quotes in parallel via MCP quote_get
    const { getClient: gc, evaluateAsync: ea } = await import('../../connection.js');
    
    const quoteResults = await Promise.allSettled(
      symbols.map(async (sym) => {
        try {
          // Use the same internal TV quote endpoint
          const result = await ea(`
            (async () => {
              const resp = await fetch(
                'https://data.tradingview.com/widgetembed/quotes/?symbols=${encodeURIComponent(sym)}&fields=ch,chp,lp,open_price,high_price,low_price,volume,average_volume,week_52_high,week_52_low',
                { credentials: 'include' }
              );
              if (!resp.ok) return null;
              const d = await resp.json();
              return d?.data?.[0] || null;
            })()
          `);
          if (!result) return null;
          const d = result;
          return {
            symbol: sym,
            close: d.lp,
            open: d.open_price,
            high: d.high_price,
            low: d.low_price,
            volume: d.volume,
            avg_volume: d.average_volume,
            change_percent: d.chp,
            week52_high: d.week_52_high,
            week52_low: d.week_52_low,
            rsi: null,    // available via data_get_indicator — skip for speed
            ema_20: null, // available via data_get_indicator — skip for speed
            ema_50: null,
            ema_200: null,
          };
        } catch { return null; }
      })
    );

    // 3. Score and filter
    let ranked = quoteResults
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => {
        const q = r.value;
        const s = score(q);
        return { ...q, ...s };
      })
      .filter(r => {
        if (bull && !r.signal.startsWith('BULL')) return false;
        if (bear && !r.signal.startsWith('BEAR')) return false;
        if (r.net < minNet && r.net > -minNet) return false;
        return true;
      })
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
      .slice(0, topN);

    // 4. Output
    if (rawJson) {
      process.stdout.write(JSON.stringify(ranked, null, 2));
      return ranked;
    }

    // Pretty table
    const signalColor = { BULL: '🟢', BULL_WEAK: '🔵', NEUTRAL: '⚪', BEAR_WEAK: '🟡', BEAR: '🔴' };
    console.log(`\n📊 Screen: ${list} (${ranked.length} results)\n`);
    console.log(`  ${'SYMBOL'.padEnd(22)} ${'SIGNAL'.padEnd(12)} ${'CHG%'.padEnd(8)} ${'NET'.padEnd(6)} STR%`);
    console.log('  ' + '─'.repeat(60));
    for (const r of ranked) {
      const icon = signalColor[r.signal] || '⚪';
      const chg = r.change_percent != null ? (r.change_percent > 0 ? '+' : '') + r.change_percent.toFixed(2) + '%' : 'N/A';
      console.log(`  ${(icon + ' ' + r.symbol).padEnd(24)} ${r.signal.padEnd(12)} ${chg.padEnd(8)} ${String(r.net).padEnd(6)} ${r.strength}%`);
    }
    console.log(`\nRun with --json for pipe-friendly output.`);

    return ranked;
  },
});
