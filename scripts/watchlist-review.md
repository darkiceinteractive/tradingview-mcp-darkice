# Watchlist Review — 2026-05-15

## Honest summary of state

**All 36 list names exist** in your TradingView account (confirmed via the "Open list…" dialog scrape). However, **the contents are partially scrambled** because of two bugs I hit during automation:

1. **Cross-contamination**: when `verify-active` checks raced against TV state, symbols got added to whatever list happened to be active at the moment, not the intended list. So some lists contain another list's symbols.
2. **Accidental clears**: my "clear search input" sequence (`Cmd+A` + `Delete`) sometimes leaked to the watchlist panel itself, which TV interprets as "select all symbols, delete them". A handful of lists got emptied.

I tried to repair in-place but the switch-to-list operation is itself unreliable enough that it kept compounding the mess. Stopping further automated edits — manual review in the TV UI will be quickest from here.

## How to review in TradingView

1. Open the watchlist panel
2. Click the list name dropdown (top-right of panel)
3. Click "Open list…" at the bottom of the menu
4. The dialog shows all your lists with symbol counts in a column on the right
5. Compare each count to the spec column below. Click a list to make it active and see its actual symbols on the right.

If a list shows the wrong content: select all its current symbols (Cmd+A then Delete in the watchlist sidebar), then refer to the spec below to manually re-add. Or use the `watchlist_set` MCP tool with the spec list (now that the underlying bugs are patched, it should work reliably for a fresh in→out replace).

## Spec (what each list SHOULD contain)

### US_AI_CONSUMER (10)
| Symbol | Exchange | Name |
|---|---|---|
| AAPL | NASDAQ | Apple |
| AMZN | NASDAQ | Amazon |
| GOOGL | NASDAQ | Alphabet (Class A) |
| META | NASDAQ | Meta Platforms |
| MSFT | NASDAQ | Microsoft |
| NVDA | NASDAQ | Nvidia |
| TSLA | NASDAQ | Tesla |
| SNAP | NASDAQ | Snap |
| RBLX | NASDAQ | Roblox |
| PINS | NASDAQ | Pinterest |

### US_AI_DATA_INFRA (12)
| Symbol | Exchange | Name |
|---|---|---|
| NVDA | NASDAQ | Nvidia |
| AMD | NASDAQ | AMD |
| SMCI | NASDAQ | Super Micro Computer |
| DELL | NYSE | Dell Technologies |
| HPE | NYSE | HP Enterprise |
| NTNX | NASDAQ | Nutanix |
| PSTG | NYSE | Pure Storage |
| NET | NYSE | Cloudflare |
| CRWD | NASDAQ | CrowdStrike |
| DDOG | NASDAQ | Datadog |
| ANET | NYSE | Arista Networks |
| ZS | NASDAQ | Zscaler |

### US_AI_INDUSTRIAL (12)
| Symbol | Exchange | Name |
|---|---|---|
| HON | NYSE | Honeywell |
| GE | NYSE | GE Aerospace |
| ROK | NYSE | Rockwell Automation |
| EMR | NYSE | Emerson Electric |
| LDOS | NYSE | Leidos |
| SAIC | NYSE | Science Applications International |
| CACI | NYSE | CACI International |
| AXON | NASDAQ | Axon Enterprise |
| PLTR | NYSE | Palantir |
| KTOS | NYSE | Kratos Defense |
| DRS | NYSE | Leonardo DRS |
| BWXT | NYSE | BWX Technologies |

### US_AI_PLATFORMS (12)
| Symbol | Exchange | Name |
|---|---|---|
| MSFT | NASDAQ | Microsoft |
| GOOGL | NASDAQ | Alphabet (Class A) |
| AMZN | NASDAQ | Amazon |
| META | NASDAQ | Meta Platforms |
| ORCL | NYSE | Oracle |
| SNOW | NYSE | Snowflake |
| PLTR | NYSE | Palantir |
| CRM | NYSE | Salesforce |
| IBM | NYSE | IBM |
| AI | NYSE | C3.ai |
| BBAI | NYSE | BigBear.ai |
| SOUN | NASDAQ | SoundHound AI |

### US_BANKS (5)
| Symbol | Exchange | Name |
|---|---|---|
| JPM | NYSE | JPMorgan Chase |
| BAC | NYSE | Bank of America |
| WFC | NYSE | Wells Fargo |
| C | NYSE | Citigroup |
| GS | NYSE | Goldman Sachs |

### US_BANKS_FINANCIALS (8)
| Symbol | Exchange | Name |
|---|---|---|
| JPM | NYSE | JPMorgan Chase |
| BAC | NYSE | Bank of America |
| BRK.B | NYSE | Berkshire Hathaway B |
| AXP | NYSE | American Express |
| BLK | NYSE | BlackRock |
| SCHW | NYSE | Charles Schwab |
| V | NYSE | Visa |
| MA | NYSE | Mastercard |

### US_COAL (6)
| Symbol | Exchange | Name |
|---|---|---|
| BTU | NYSE | Peabody Energy |
| ARCH | NYSE | Arch Resources |
| CEIX | NYSE | CONSOL Energy |
| AMR | NYSE | Alpha Metallurgical |
| HCC | NYSE | Warrior Met Coal |
| METC | NYSE | Ramaco Resources |

### US_CONSUMER_DISC (12)
| Symbol | Exchange | Name |
|---|---|---|
| AMZN | NASDAQ | Amazon |
| TSLA | NASDAQ | Tesla |
| HD | NYSE | Home Depot |
| MCD | NYSE | McDonald's |
| NKE | NYSE | Nike |
| SBUX | NASDAQ | Starbucks |
| TJX | NYSE | TJX Companies |
| BKNG | NASDAQ | Booking Holdings |
| LOW | NYSE | Lowe's |
| GM | NYSE | General Motors |
| CMG | NYSE | Chipotle |
| LULU | NASDAQ | Lululemon |

### US_CONSUMER_STAPLES (9)
| Symbol | Exchange | Name |
|---|---|---|
| PG | NYSE | Procter & Gamble |
| KO | NYSE | Coca-Cola |
| PEP | NASDAQ | PepsiCo |
| COST | NASDAQ | Costco |
| WMT | NYSE | Walmart |
| PM | NYSE | Philip Morris International |
| MO | NYSE | Altria |
| CL | NYSE | Colgate-Palmolive |
| KMB | NYSE | Kimberly-Clark |

### US_COPPER_BASE_METALS (5)
| Symbol | Exchange | Name |
|---|---|---|
| FCX | NYSE | Freeport-McMoRan |
| SCCO | NYSE | Southern Copper |
| AA | NYSE | Alcoa |
| CLF | NYSE | Cleveland-Cliffs |
| VALE | NYSE | Vale (ADR) |

### US_DEFENCE (6)
| Symbol | Exchange | Name |
|---|---|---|
| LMT | NYSE | Lockheed Martin |
| RTX | NYSE | RTX Corporation |
| NOC | NYSE | Northrop Grumman |
| GD | NYSE | General Dynamics |
| BA | NYSE | Boeing |
| HII | NYSE | Huntington Ingalls |

### US_ENERGY (9)
| Symbol | Exchange | Name |
|---|---|---|
| XOM | NYSE | ExxonMobil |
| CVX | NYSE | Chevron |
| COP | NYSE | ConocoPhillips |
| EOG | NYSE | EOG Resources |
| SLB | NYSE | SLB (Schlumberger) |
| OXY | NYSE | Occidental Petroleum |
| DVN | NYSE | Devon Energy |
| WMB | NYSE | Williams Companies |
| OKE | NYSE | Oneok |

### US_GAMING_LOTTERIES (8)
| Symbol | Exchange | Name |
|---|---|---|
| DKNG | NASDAQ | DraftKings |
| MGM | NYSE | MGM Resorts |
| LVS | NYSE | Las Vegas Sands |
| WYNN | NASDAQ | Wynn Resorts |
| CZR | NASDAQ | Caesars Entertainment |
| PENN | NASDAQ | PENN Entertainment |
| LNW | NASDAQ | Light & Wonder |
| IGT | NYSE | International Game Technology |

### US_GOLD_SILVER (15)
| Symbol | Exchange | Name |
|---|---|---|
| NEM | NYSE | Newmont |
| GOLD | NYSE | Barrick Mining |
| AEM | NYSE | Agnico Eagle Mines |
| WPM | NYSE | Wheaton Precious Metals |
| FNV | NYSE | Franco-Nevada |
| PAAS | NYSE | Pan American Silver |
| HL | NYSE | Hecla Mining |
| CDE | NYSE | Coeur Mining |
| KGC | NYSE | Kinross Gold |
| AGI | NYSE | Alamos Gold |
| MAG | NYSE | MAG Silver |
| SILV | NYSE | SilverCrest Metals |
| USAS | NYSE | Americas Gold and Silver |
| FSM | NYSE | Fortuna Mining |
| AU | NYSE | AngloGold Ashanti |

### US_HEALTHCARE (12)
| Symbol | Exchange | Name |
|---|---|---|
| JNJ | NYSE | Johnson & Johnson |
| UNH | NYSE | UnitedHealth |
| PFE | NYSE | Pfizer |
| ABBV | NYSE | AbbVie |
| MRK | NYSE | Merck |
| ABT | NYSE | Abbott |
| TMO | NYSE | Thermo Fisher |
| BMY | NYSE | Bristol-Myers Squibb |
| AMGN | NASDAQ | Amgen |
| LLY | NYSE | Eli Lilly |
| GILD | NASDAQ | Gilead |
| CVS | NYSE | CVS Health |

### US_HIGH_YIELD (13)
| Symbol | Exchange | Name |
|---|---|---|
| T | NYSE | AT&T |
| VZ | NYSE | Verizon |
| MO | NYSE | Altria |
| PM | NYSE | Philip Morris |
| XOM | NYSE | ExxonMobil |
| CVX | NYSE | Chevron |
| MPC | NYSE | Marathon Petroleum |
| OKE | NYSE | Oneok |
| EPD | NYSE | Enterprise Products Partners |
| WMB | NYSE | Williams Companies |
| KMI | NYSE | Kinder Morgan |
| MPLX | NYSE | MPLX |
| ET | NYSE | Energy Transfer |

### US_INDUSTRIALS (10)
| Symbol | Exchange | Name |
|---|---|---|
| GE | NYSE | GE Aerospace |
| HON | NYSE | Honeywell |
| MMM | NYSE | 3M |
| CAT | NYSE | Caterpillar |
| DE | NYSE | Deere |
| EMR | NYSE | Emerson |
| ROK | NYSE | Rockwell Automation |
| ETN | NYSE | Eaton |
| PH | NYSE | Parker-Hannifin |
| ITW | NYSE | Illinois Tool Works |

### US_INFRASTRUCTURE (8)
| Symbol | Exchange | Name |
|---|---|---|
| AMT | NYSE | American Tower |
| CCI | NYSE | Crown Castle |
| EQIX | NASDAQ | Equinix |
| WM | NYSE | Waste Management |
| RSG | NYSE | Republic Services |
| AWK | NYSE | American Water |
| XYL | NYSE | Xylem |
| PWR | NYSE | Quanta Services |

### US_INSURANCE (9)
| Symbol | Exchange | Name |
|---|---|---|
| BRK.B | NYSE | Berkshire Hathaway B |
| AIG | NYSE | American International Group |
| MET | NYSE | MetLife |
| PRU | NYSE | Prudential |
| AFL | NYSE | Aflac |
| AON | NYSE | Aon |
| CB | NYSE | Chubb |
| TRV | NYSE | Travelers |
| PGR | NYSE | Progressive |

### US_IRON_ORE (8) — *steel proxy; no US iron-ore pure-plays*
| Symbol | Exchange | Name |
|---|---|---|
| NUE | NYSE | Nucor |
| X | NYSE | US Steel |
| CLF | NYSE | Cleveland-Cliffs |
| STLD | NYSE | Steel Dynamics |
| CMC | NYSE | Commercial Metals |
| MT | NYSE | ArcelorMittal |
| TX | NYSE | Ternium |
| WOR | NYSE | Worthington Steel |

### US_LITHIUM (5)
| Symbol | Exchange | Name |
|---|---|---|
| ALB | NYSE | Albemarle |
| SQM | NYSE | SQM |
| LTHM | NASDAQ | Livent → now Arcadium |
| PLL | NASDAQ | Piedmont Lithium |
| LAC | NASDAQ | Lithium Americas |

### US_LITHIUM_BATTERY (8)
| Symbol | Exchange | Name |
|---|---|---|
| ALB | NYSE | Albemarle |
| SQM | NYSE | SQM |
| ENVX | NASDAQ | Enovix |
| QS | NYSE | QuantumScape |
| LAC | NASDAQ | Lithium Americas |
| LTHM | NASDAQ | Livent → Arcadium |
| PLL | NASDAQ | Piedmont Lithium |
| SLDP | NASDAQ | Solid Power |

### US_OIL_GAS (8)
| Symbol | Exchange | Name |
|---|---|---|
| XOM | NYSE | ExxonMobil |
| CVX | NYSE | Chevron |
| COP | NYSE | ConocoPhillips |
| EOG | NYSE | EOG Resources |
| OXY | NYSE | Occidental Petroleum |
| DVN | NYSE | Devon Energy |
| HES | NYSE | Hess |
| MRO | NYSE | Marathon Oil |

### US_RARE_EARTHS_CRITICAL (7) — *thin universe by design*
| Symbol | Exchange | Name |
|---|---|---|
| MP | NYSE | MP Materials |
| UUUU | NYSE | Energy Fuels |
| NB | NASDAQ | NioCorp Developments |
| PPTA | NASDAQ | Perpetua Resources |
| LAC | NASDAQ | Lithium Americas |
| PLL | NASDAQ | Piedmont Lithium |
| ALB | NYSE | Albemarle |

### US_REITS (15)
| Symbol | Exchange | Name |
|---|---|---|
| AMT | NYSE | American Tower |
| EQIX | NASDAQ | Equinix |
| PLD | NYSE | Prologis |
| SPG | NYSE | Simon Property |
| O | NYSE | Realty Income |
| VICI | NYSE | VICI Properties |
| EQR | NYSE | Equity Residential |
| AVB | NYSE | AvalonBay |
| PSA | NYSE | Public Storage |
| DLR | NYSE | Digital Realty |
| CCI | NYSE | Crown Castle |
| WELL | NYSE | Welltower |
| VTR | NYSE | Ventas |
| BXP | NYSE | BXP (Boston Properties) |
| KIM | NYSE | Kimco Realty |

### US_REITS_DIVERSIFIED_MANAGERS (5)
| Symbol | Exchange | Name |
|---|---|---|
| BX | NYSE | Blackstone |
| KKR | NYSE | KKR |
| APO | NYSE | Apollo Global |
| ARES | NYSE | Ares Management |
| CG | NYSE | Carlyle Group |

### US_REITS_OFFICE (8)
| Symbol | Exchange | Name |
|---|---|---|
| BXP | NYSE | BXP (Boston Properties) |
| VNO | NYSE | Vornado Realty |
| HIW | NYSE | Highwoods Properties |
| DEA | NYSE | Easterly Government |
| OFC | NYSE | COPT Defense Properties |
| PDM | NYSE | Piedmont Office Realty |
| SLG | NYSE | SL Green Realty |
| HPP | NYSE | Hudson Pacific Properties |

### US_REITS_RESIDENTIAL_MIXED (5)
| Symbol | Exchange | Name |
|---|---|---|
| EQR | NYSE | Equity Residential |
| AVB | NYSE | AvalonBay |
| UDR | NYSE | UDR |
| ESS | NYSE | Essex Property Trust |
| CPT | NYSE | Camden Property Trust |

### US_REITS_RETAIL (6)
| Symbol | Exchange | Name |
|---|---|---|
| SPG | NYSE | Simon Property |
| KIM | NYSE | Kimco Realty |
| REG | NYSE | Regency Centers |
| FRT | NYSE | Federal Realty |
| BRX | NYSE | Brixmor Property |
| ROIC | NYSE | Retail Opportunity Investments |

### US_ROBOTICS_AI (17)
| Symbol | Exchange | Name |
|---|---|---|
| NVDA | NASDAQ | Nvidia |
| AMD | NASDAQ | AMD |
| ISRG | NYSE | Intuitive Surgical |
| ROK | NYSE | Rockwell Automation |
| HON | NYSE | Honeywell |
| AXON | NASDAQ | Axon Enterprise |
| CGNX | NASDAQ | Cognex |
| TRMB | NYSE | Trimble |
| KTOS | NYSE | Kratos Defense |
| PLTR | NYSE | Palantir |
| DRS | NYSE | Leonardo DRS |
| BRKS | NASDAQ | Brooks Automation |
| FORM | NASDAQ | FormFactor |
| LDOS | NYSE | Leidos |
| SAIC | NYSE | Science Applications |
| AI | NASDAQ | C3.ai |
| CACI | NYSE | CACI International |

### US_TECH (12)
| Symbol | Exchange | Name |
|---|---|---|
| AAPL | NASDAQ | Apple |
| MSFT | NASDAQ | Microsoft |
| GOOGL | NASDAQ | Alphabet (Class A) |
| META | NASDAQ | Meta Platforms |
| NVDA | NASDAQ | Nvidia |
| AMZN | NASDAQ | Amazon |
| TSLA | NASDAQ | Tesla |
| ADBE | NASDAQ | Adobe |
| CRM | NYSE | Salesforce |
| ORCL | NYSE | Oracle |
| NOW | NYSE | ServiceNow |
| INTU | NASDAQ | Intuit |

### US_TELECOMS (9)
| Symbol | Exchange | Name |
|---|---|---|
| VZ | NYSE | Verizon |
| T | NYSE | AT&T |
| TMUS | NASDAQ | T-Mobile US |
| CHTR | NASDAQ | Charter Communications |
| CMCSA | NASDAQ | Comcast |
| LUMN | NYSE | Lumen Technologies |
| USM | NYSE | US Cellular |
| ATUS | NASDAQ | Altice USA |
| CABO | NASDAQ | Cable One |

### US_TOP20 (20)
| Symbol | Exchange | Name |
|---|---|---|
| AAPL | NASDAQ | Apple |
| MSFT | NASDAQ | Microsoft |
| NVDA | NASDAQ | Nvidia |
| AMZN | NASDAQ | Amazon |
| GOOGL | NASDAQ | Alphabet (Class A) |
| META | NASDAQ | Meta Platforms |
| TSLA | NASDAQ | Tesla |
| BRK.B | NYSE | Berkshire Hathaway B |
| JPM | NYSE | JPMorgan Chase |
| AVGO | NASDAQ | Broadcom |
| LLY | NYSE | Eli Lilly |
| UNH | NYSE | UnitedHealth |
| V | NYSE | Visa |
| XOM | NYSE | ExxonMobil |
| MA | NYSE | Mastercard |
| JNJ | NYSE | Johnson & Johnson |
| HD | NYSE | Home Depot |
| PG | NYSE | Procter & Gamble |
| COST | NASDAQ | Costco |
| WMT | NYSE | Walmart |

### US_TRANSPORT (9)
| Symbol | Exchange | Name |
|---|---|---|
| UPS | NYSE | UPS |
| FDX | NYSE | FedEx |
| ODFL | NASDAQ | Old Dominion Freight |
| JBHT | NASDAQ | J.B. Hunt Transport |
| KNX | NYSE | Knight-Swift |
| XPO | NYSE | XPO |
| GXO | NYSE | GXO Logistics |
| CSX | NYSE | CSX |
| UNP | NYSE | Union Pacific |

### US_TRAVEL_TOURISM (12)
| Symbol | Exchange | Name |
|---|---|---|
| DAL | NYSE | Delta Air Lines |
| UAL | NYSE | United Airlines Holdings |
| AAL | NYSE | American Airlines Group |
| LUV | NYSE | Southwest Airlines |
| BKNG | NASDAQ | Booking Holdings |
| EXPE | NASDAQ | Expedia |
| ABNB | NASDAQ | Airbnb |
| HLT | NYSE | Hilton Worldwide |
| MAR | NYSE | Marriott International |
| RCL | NYSE | Royal Caribbean |
| CCL | NYSE | Carnival |
| NCLH | NYSE | Norwegian Cruise Line |

### GLOBAL_MATERIALS_METALS (45)
US + ASX cross-listed metals/mining. View in USD via TV's currency selector.

| Symbol | Exchange | Name |
|---|---|---|
| NEM | NYSE | Newmont |
| GOLD | NYSE | Barrick Mining |
| AEM | NYSE | Agnico Eagle |
| WPM | NYSE | Wheaton Precious Metals |
| FNV | NYSE | Franco-Nevada |
| KGC | NYSE | Kinross Gold |
| AGI | NYSE | Alamos Gold |
| NST | ASX | Northern Star Resources |
| EVN | ASX | Evolution Mining |
| WGX | ASX | Westgold Resources |
| GMD | ASX | Genesis Minerals |
| DEG | ASX | De Grey Mining |
| RRL | ASX | Regis Resources |
| PAAS | NYSE | Pan American Silver |
| HL | NYSE | Hecla Mining |
| AG | NYSE | First Majestic Silver |
| FSM | NYSE | Fortuna Mining |
| SVL | ASX | Silver Mines |
| FCX | NYSE | Freeport-McMoRan |
| SCCO | NYSE | Southern Copper |
| TECK | NYSE | Teck Resources |
| SFR | ASX | Sandfire Resources |
| 29M | ASX | 29Metals |
| BHP | NYSE | BHP (ADR) |
| RIO | NYSE | Rio Tinto (ADR) |
| VALE | NYSE | Vale (ADR) |
| FMG | ASX | Fortescue |
| MIN | ASX | Mineral Resources |
| MGX | ASX | Mount Gibson Iron |
| MP | NYSE | MP Materials |
| UUUU | NYSE | Energy Fuels |
| LYC | ASX | Lynas Rare Earths |
| ILU | ASX | Iluka Resources |
| NTU | ASX | Northern Minerals |
| HAS | ASX | Hastings Technology Metals |
| ALB | NYSE | Albemarle |
| SQM | NYSE | SQM |
| PLS | ASX | Pilbara Minerals |
| LTR | ASX | Liontown Resources |
| GL1 | ASX | Global Lithium Resources |
| TLG | ASX | Talga Group |
| FGR | ASX | First Graphene |
| NVX | ASX | Novonix |
| IGO | ASX | IGO Limited |
| NIC | ASX | Nickel Industries |

---

## What I confirmed during automation today

These are populated correctly (per `watchlist_get` calls):

| List | Symbols populated | Spec count | Status |
|---|---|---|---|
| US_AI_CONSUMER | 10 (AAPL, AMZN, GOOGL, META, MSFT, NVDA, TSLA, SNAP, RBLX, PINS) | 10 | ✅ |
| US_DEFENCE | 6 (LMT, RTX, NOC, GD, BA, HII) | 6 | ✅ |
| US_COPPER_BASE_METALS | 5 (FCX, SCCO, AA, CLF, VALE) | 5 | ✅ |

These show counts but mostly with **wrong content** (cross-contaminated from another list during a flaky switch):

| List | Apparent count | Notes |
|---|---|---|
| US_AI_DATA_INFRA | 17 → contains US_INFRASTRUCTURE symbols | needs clear + repopulate from spec |
| US_GOLD_SILVER | 6 → contains US_DEFENCE symbols | needs clear + repopulate |
| US_INFRASTRUCTURE | 15 → contains US_GOLD_SILVER symbols | needs clear + repopulate |

## What needs your manual attention

1. **Open each list in TV** and compare to the spec table above
2. **For wrong-content lists**: select-all → delete → re-add from spec (Cmd+A then Delete inside the watchlist sidebar works for bulk delete)
3. **For TV "symbol invalid" rejections** during my runs (BMY, AMGN, LLY, BKNG, etc.): try entering them via the symbol search inside TV directly — the desktop search resolves ambiguities better than the watchlist API. The exchange prefix in the spec may need adjustment (NYSE vs NASDAQ vs BATS).
4. **GLOBAL_MATERIALS_METALS** is reported populated with 45 — these include both US and ASX tickers. Use TV's currency selector to view in USD.

## Underlying bugs I fixed (now in working tree)

- `src/core/ui.js:316-319` — `mouseClick` bitmask was wrong (`0/2/1` instead of `1/2/4`), `mouseReleased` was missing `clickCount: 1`. Without these, real CDP clicks were silently no-oping on TradingView's portal menus.
- `src/core/watchlist.js:101-127` — `openListsDropdown` reverted to JS `.click()` because CDP click on that specific toggle button is unreliable.

These fixes are committed in the working tree. Future runs of `watchlist_set` should work reliably end-to-end without the gymnastics I had to do this session.
