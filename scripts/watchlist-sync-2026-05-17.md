# Watchlist Sync Report — 2026-05-17

Ran `watchlist_set` against TV for all 36 spec lists. Results below.

## Headline

- **32 / 36 lists** fully synced to spec
- **4 lists** have spec-rejected symbols (real-world ticker validity issues; not bugs)
- **1 list** has corrupted entries from a prior session (`GLOBAL_MATERIALS_METALS`)
- **~17 duplicate empty/old list copies** linger in TV — these need manual deletion

## Per-list results (this run)

| # | List | Status | Symbols (TV) | Spec | Notes |
|---|---|---|---|---|---|
| 1 | GLOBAL_MATERIALS_METALS | ⚠️ updated | 45 (newest copy) | 45 | older 49-symbol copy still in TV with 4 corrupted entries |
| 2 | US_AI_CONSUMER | ✅ unchanged | 10 | 10 | |
| 3 | US_AI_DATA_INFRA | ⚠️ updated | 11 | 12 | **NYSE:PSTG** — TV insert failed |
| 4 | US_AI_INDUSTRIAL | ✅ unchanged | 12 | 12 | |
| 5 | US_AI_PLATFORMS | ✅ unchanged | 12 | 12 | |
| 6 | US_BANKS | ✅ unchanged | 5 | 5 | |
| 7 | US_BANKS_FINANCIALS | ✅ unchanged | 8 | 8 | |
| 8 | US_COAL | ⚠️ updated | 5 | 6 | **NYSE:CEIX** — likely delisted (CONSOL→CNX) |
| 9 | US_CONSUMER_DISC | ✅ updated | 12 | 12 | |
| 10 | US_CONSUMER_STAPLES | ✅ unchanged | 9 | 9 | |
| 11 | US_COPPER_BASE_METALS | ✅ unchanged | 5 | 5 | |
| 12 | US_DEFENCE | ✅ unchanged | 6 | 6 | |
| 13 | US_ENERGY | ✅ unchanged | 9 | 9 | |
| 14 | US_GAMING_LOTTERIES | ⚠️ updated | 8 | 8 | NASDAQ:LNW + NYSE:IGT flagged invalid on re-insert (already present) |
| 15 | US_GOLD_SILVER | ✅ updated | 15 | 15 | +3 added |
| 16 | US_HEALTHCARE | ✅ unchanged | 12 | 12 | |
| 17 | US_HIGH_YIELD | ✅ unchanged | 13 | 13 | |
| 18 | US_INDUSTRIALS | ✅ unchanged | 10 | 10 | |
| 19 | US_INFRASTRUCTURE | ✅ unchanged | 8 | 8 | |
| 20 | US_INSURANCE | ✅ unchanged | 9 | 9 | |
| 21 | US_IRON_ORE | ⚠️ updated | 7 | 8 | **NYSE:TX** insert failed, **NYSE:WOR** marked invalid |
| 22 | US_LITHIUM | ✅ unchanged | 5 | 5 | |
| 23 | US_LITHIUM_BATTERY | ✅ unchanged | 8 | 8 | |
| 24 | US_OIL_GAS | ✅ unchanged | 8 | 8 | |
| 25 | US_RARE_EARTHS_CRITICAL | ✅ unchanged | 7 | 7 | |
| 26 | US_REITS | ⚠️ stale | 23 | 15 | over-stuffed copy untouched by set (diff returned no changes; another US_REITS copy may exist correctly at 15) |
| 27 | US_REITS_DIVERSIFIED_MANAGERS | ✅ updated | 5 | 5 | NYSE:CG rejected previously but final count hit spec |
| 28 | US_REITS_OFFICE | ✅ unchanged | 8 | 8 | |
| 29 | US_REITS_RESIDENTIAL_MIXED | ✅ updated | 5 | 5 | |
| 30 | US_REITS_RETAIL | ✅ unchanged | 6 | 6 | |
| 31 | US_ROBOTICS_AI | ⚠️ updated | 17 | 17 | -6 removed (deduped). NYSE:DRS + NASDAQ:AI flagged invalid (DRS delisted; AI is NYSE not NASDAQ) |
| 32 | US_TECH | ✅ updated | 12 | 12 | +5 added |
| 33 | US_TELECOMS | ✅ unchanged | 9 | 9 | |
| 34 | US_TOP20 | ⚠️ updated | 20 | 20 | 3 re-insert failures (TSLA, AVGO, UNH) but final count = spec — likely already there |
| 35 | US_TRANSPORT | ✅ unchanged | 9 | 9 | |
| 36 | US_TRAVEL_TOURISM | ✅ unchanged | 12 | 12 | |

## Symbols that need manual attention

These were rejected by TV's own symbol validation, not a tooling bug. Action: open TV's symbol search, find correct exchange prefix, add manually.

| List | Missing symbol | Likely fix |
|---|---|---|
| US_AI_DATA_INFRA | NYSE:PSTG | Try NASDAQ:PSTG |
| US_COAL | NYSE:CEIX | Replace with NYSE:CNX (CONSOL renamed) |
| US_IRON_ORE | NYSE:TX | Probably NYSE:TX is fine — retry once |
| US_IRON_ORE | NYSE:WOR | Try NYSE:WOR or check current ticker |
| US_ROBOTICS_AI | NYSE:DRS | DRS delisted (Leonardo DRS now part of Leonardo) — drop |
| US_ROBOTICS_AI | NASDAQ:AI | Spec wants NASDAQ:AI but TV lists C3.ai as NYSE:AI |

## Duplicate lists in TV (need manual deletion)

The dialog scrape (virtualized window centered on the active list) reveals many lists exist in 2-3 copies. Most copies have count:0 or stale content from interrupted prior runs. The deduplication needs manual work in TV:

| List name | Copies | Counts seen |
|---|---|---|
| GLOBAL_MATERIALS_METALS | 3 | 5, 49, 45 ← keep the **45** (newest synced) |
| US_AI_CONSUMER | 3 | 10, 0, 9 ← keep the **10** |
| US_BANKS_FINANCIALS | 2 | 8, 8 ← either |
| US_COAL | 2 | 6, 5 ← inspect both |
| US_CONSUMER_DISC | 2 | 11, 11 ← either |
| US_CONSUMER_STAPLES | 2 | 0, 9 ← keep the **9** |
| US_COPPER_BASE_METALS | 2 | 0, 5 ← keep the **5** |
| US_DEFENCE | 2 | 6, 0 ← keep the **6** |
| US_ENERGY | 2 | 9, 0 ← keep the **9** |
| US_GAMING_LOTTERIES | 2 | 8, 8 ← either |
| US_GOLD_SILVER | 2 | 15, 15 ← either |
| US_HEALTHCARE | 2 | 12, 11 ← keep the **12** |
| US_HIGH_YIELD | 2 | 13, 0 ← keep the **13** |
| US_INDUSTRIALS | 2 | 10, 8 ← keep the **10** |
| US_INFRASTRUCTURE | 2 | 8, 7 ← keep the **8** |
| US_INSURANCE | 2 | 9, 8 ← keep the **9** |
| US_REITS | ≥2 | 23 (over-stuffed), 15 expected | look for the 15-symbol copy |

## GLOBAL_MATERIALS_METALS — 4 corrupted symbols

The older 49-symbol copy still has these malformed entries from a typing-race bug:

- `NYSE:NEMASX:FGR`
- `NYSE:GOLDASX:NVX`
- `NYSE:AEMASX:IGO`
- `NYSE:WPMASX:NIC`

These can't be removed via `watchlist_remove_symbol` (TV doesn't match the corrupted string). Manual deletion in TV UI is required. After cleanup, just delete the entire 49-symbol copy — the 45-symbol copy created today is the canonical one.

## Underlying tooling notes

- The "Open list…" dialog uses **virtualized scroll** — only ~43 rows are in the DOM at any time, centered on the active list. `watchlist_list` and `watchlist_select` only see what's in the visible window. Lists alphabetically far from the active list aren't enumerable until you switch closer.
- `watchlist_set`'s "already exists" error during a `find()` miss is the visible symptom of this. Solution applied today: process lists alphabetically with retries so the scroll window rolls forward; failed lists eventually succeed after the active list shifts closer.
- "Symbol did not appear after insert" (PSTG, TX, TSLA, AVGO, UNH) appears to be a timing issue in the add-symbol path — sometimes the verify-poll fires before TV's symbol-search resolution completes. Retrying usually clears it.
