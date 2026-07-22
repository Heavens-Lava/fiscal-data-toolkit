# Command reference

Copy-paste commands for every script in `scripts/`. All are keyless unless noted. Run from the project root.

## Weekly social post (charts + captions)

`scripts/weekly-digest.mjs` â€” writes `social/<topic>-<date>.png/.html/.txt/.csv`.

```bash
node scripts/weekly-digest.mjs                              # this week's rotation topic
node scripts/weekly-digest.mjs --all                        # every topic
node scripts/weekly-digest.mjs --no-image                   # skip PNG (HTML + caption only)
node scripts/weekly-digest.mjs --table                      # also print + save a .csv data table
node scripts/weekly-digest.mjs --topic gas --years 10        # override the chart's lookback window
```

`--years` works on: `jobs`\*, `inflation`, `hires`, `debt`, `gas`, `gas-az`, `mortgage`, `banks`, `border` â€” each has its own default that `--years` overrides: `debt` 1yr, `inflation`/`hires`/`border` 2yr, `gas`/`gas-az`/`mortgage` 5yr, `banks` 15yr. Titles and captions ("5-year high", "over the past 12 months", etc.) update to match. Not applicable to snapshot-in-time topics (`tax-dollar`, `household-debt`, `debt-holders*`, `trade`). \*`jobs` ignores `--years` â€” its chart is always the trailing 12 months.

Rotation (auto-picked week to week) â€” add `--table` to any of these to print the full data table (and it's always saved to the `.csv` regardless):

```bash
node scripts/weekly-digest.mjs --topic jobs --table
node scripts/weekly-digest.mjs --topic inflation --table
node scripts/weekly-digest.mjs --topic debt --table
node scripts/weekly-digest.mjs --topic hires --table
node scripts/weekly-digest.mjs --topic mortgage --table
```

Evergreen (any week):

```bash
node scripts/weekly-digest.mjs --topic tax-dollar --table
node scripts/weekly-digest.mjs --topic household-debt --table
node scripts/weekly-digest.mjs --topic debt-holders --table               # credit-card loans
node scripts/weekly-digest.mjs --topic debt-holders-consumer --table      # consumer loans
node scripts/weekly-digest.mjs --topic debt-holders-real-estate --table   # real-estate loans
node scripts/weekly-digest.mjs --topic gas --table
node scripts/weekly-digest.mjs --topic gas-az --table
node scripts/weekly-digest.mjs --topic banks --table
node scripts/weekly-digest.mjs --topic border --table
node scripts/weekly-digest.mjs --topic trade --table                      # needs CENSUS_API_KEY
```

Note: without `--years`, the terminal table truncates to the most recent 120 rows ("full set in the .csv"). Pass `--years` explicitly (e.g. `--years 20`) and the terminal prints that entire window, no truncation â€” the .csv always has the full data either way.

## Monthly social brief

`scripts/monthly-briefs.mjs` â€” runs a curated set of weekly-digest topics and copies the assets into `social/monthly-brief-YYYY-MM/` with a `brief.md` posting checklist and `manifest.json`.

```bash
npm run monthly
node scripts/monthly-briefs.mjs --month 2026-07
node scripts/monthly-briefs.mjs --no-image
node scripts/monthly-briefs.mjs --topics jobs,inflation,mortgage,household-debt
node scripts/monthly-briefs.mjs --topics jobs,inflation,debt,hires,mortgage,household-debt,tax-dollar,gas-az
```

Default monthly topics: `jobs`, `inflation`, `debt`, `hires`, `mortgage`, `household-debt`, `tax-dollar`, `gas-az`.

## Publishing tools

```bash
npm run social:index       # node scripts/social-index.mjs
npm run calendar           # node scripts/monthly-content-calendar.mjs
npm run ready              # node scripts/post-readiness-check.mjs
npm run freshness          # node scripts/data-freshness-dashboard.mjs
node scripts/monthly-content-calendar.mjs --month 2026-07 --per-week 1
node scripts/monthly-content-calendar.mjs --topics jobs,inflation,mortgage,household-debt
```

`promote-queued-posts.mjs` — the approval queue (`stage-facebook-post.mjs`) can hold more content than Facebook's ~27-day scheduling window has slots for (confirmed via testing: `scheduled_publish_time` beyond ~27-28 days out is rejected). This walks the queue oldest-staged-first and schedules as many as currently fit, stopping cleanly once the window is full instead of erroring — run it periodically (e.g. daily) so posts that didn't fit last time get promoted automatically as earlier slots publish and roll off.

```bash
npm run promote-queue
node scripts/promote-queued-posts.mjs --limit 5   # cap how many to promote in one run
```

`install-promote-queue-schedule.ps1` registers a daily Windows Task Scheduler job to run it automatically (mirrors `install-social-schedule.ps1`'s pattern):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-promote-queue-schedule.ps1
powershell -ExecutionPolicy Bypass -File scripts\install-promote-queue-schedule.ps1 -At "06:30"
```

`social-index.mjs` writes `social/index.md` and `social/index.json`.
`monthly-content-calendar.mjs` writes `social/content-calendar-YYYY-MM.md/.json`.
`post-readiness-check.mjs` writes `social/post-readiness-report.md/.json`.
`data-freshness-dashboard.mjs` writes `social/data-freshness-dashboard.md/.json`.

```bash
npm run performance
node scripts/post-performance.mjs --file "C:/path/to/export.csv"   # override auto-detected file
node scripts/post-performance.mjs --min-views 500
```

`post-performance.mjs` ingests a Meta Business Suite "Content > Publish time > Summary" CSV (download it from Meta Business Suite → Insights → Content, no API — Facebook doesn't expose Page insights via a public read API) and ranks which posts actually performed. Auto-detects the newest matching file in `~/Downloads`, or pass `--file`. Keeps a durable ledger at `social/post-performance-history.json` (keyed by Post ID, so re-running with a later export accumulates instead of overwriting) and writes `social/post-performance-report.md`. Two confirmed non-toolkit posts are hardcoded in `DEFAULT_EXCLUDE`; add more Post IDs to `social/post-performance-exclude.json` as personal/non-toolkit posts show up in future exports.

## Congressional bills & roll-call votes

`scripts/congress-votes.mjs` — two modes: curated historic landmark votes, and enacted-law rankings for any year 1973+.

```bash
node scripts/congress-votes.mjs landmark                                    # slavery, civil rights, voting rights, women's rights — full history
node scripts/congress-votes.mjs landmark --topic slavery
node scripts/congress-votes.mjs landmark --topic civil-rights
node scripts/congress-votes.mjs landmark --topic voting-rights
node scripts/congress-votes.mjs landmark --topic womens-rights
node scripts/congress-votes.mjs landmark --topic treaties                   # 7 US-Soviet/Russia nuclear arms treaties, NPT to New START
node scripts/congress-votes.mjs landmark --bill 13th-amendment --social     # single-bill "stat block" card (PASSED banner, party bars, why-it-mattered)
node scripts/congress-votes.mjs landmark --bill new-start-2010 --social
node scripts/congress-votes.mjs landmark --bill salt-ii-1979 --social       # "never ratified" timeline card (no vote was ever taken)
node scripts/congress-votes.mjs year --year 2023                            # enacted public laws, ranked by closest floor vote
node scripts/congress-votes.mjs year --year 2023 --top 10 --limit 250
node scripts/congress-votes.mjs timeline --start 2016 --end 2025            # closest enacted law in each year + Facebook post/chart
npm run congress-closest -- --start 2016 --end 2025
```

`landmark` pulls live yea/nay + party-line breakdowns for verified roll calls (13th/14th/15th/19th Amendments, Civil Rights Acts of 1866/1964/1968, Voting Rights Act of 1965, ERA, and 7 nuclear arms treaties) from Voteview (UCLA/Stanford, ICPSR-digitized, keyless, covers 1789–present). `--topic treaties` covers the Nuclear Non-Proliferation Treaty (1968), ABM Treaty/SALT I (1972), INF Treaty (1988), START I (1992), START II (1996), Moscow Treaty/SORT (2003), and New START (2010) — each Senate ratification vote cross-verified against Congress.gov's own action text before being added. The party breakdown tells its own story: every Cold War-era treaty passed near-unanimously (88–100% "yes" from both parties); New START (2010) split sharply along party lines (100% Democrat, 33% Republican). `--bill <slug>` targets a single landmark vote for a standalone card (slugs: `13th-amendment`, `civil-rights-act-1866`, `14th-amendment`, `15th-amendment`, `19th-amendment`, `civil-rights-act-1964`, `voting-rights-act-1965`, `fair-housing-act-1968`, `era-1972`, `npt-1968`, `abm-salt-1-1972`, `inf-treaty-1988`, `start-1-1992`, `start-2-1996`, `moscow-treaty-2003`, `new-start-2010`). `salt-ii-1979` is a special case (`NO_VOTE_TREATIES`) — SALT II never got a Senate floor vote at all (shelved after the Soviet invasion of Afghanistan, formally withdrawn 21 years later in 2000), so it renders a timeline card instead of the usual PASSED/vote-tally stat block; sourced from `v3/treaty/96/25/actions` on Congress.gov, not Voteview. `year` pulls enacted laws from the Congress.gov API (only covers 1973+) and ranks them by how close their recorded vote was — Congress.gov doesn't publish view counts, so vote closeness is used as the objective proxy for "most contested." A free key from https://api.congress.gov/sign-up/ set as `CONGRESS_API_KEY` in `.env` is strongly recommended for `year` mode — the shared `DEMO_KEY` rate-limits hard.

## Reservoir watch

`scripts/reservoir-watch.mjs` — current fill level (% of capacity) across 9 major Bureau of Reclamation reservoirs spanning California, the Colorado River Basin, and New Mexico (Lake Mead, Lake Powell, Shasta, Flaming Gorge, Trinity, Elephant Butte, Navajo, Folsom, Blue Mesa).

```bash
npm run reservoirs
node scripts/reservoir-watch.mjs --no-image
```

Live storage comes from the Bureau of Reclamation's RISE API (keyless). Each reservoir's capacity (official maximum storage at full pool) is hardcoded from Reclamation project engineering figures — a fixed physical fact RISE doesn't expose as a queryable field, verified against official project data before use. Broader than `arizona-water-watch.mjs`, which tracks only Mead/Powell storage year-over-year — this is a same-day snapshot ranked by fill percentage across all 9.

## Patents by state

`scripts/patents-by-state.mjs` — granted U.S. patents by inventor's home state for a given year, ranked by raw count and by patents per 100,000 residents.

```bash
npm run patents
node scripts/patents-by-state.mjs --year 2024
node scripts/patents-by-state.mjs --no-image
```

Source: USPTO Open Data Portal Patent File Wrapper API (`api.uspto.gov`). Requires `USPTO_API_KEY` in `.env` — unlike most keys in this toolkit, getting one requires identity verification via ID.me (government ID upload) at https://data.uspto.gov/myodp, not just an email signup. Population for the per-capita rate comes from Census PEP (`CENSUS_API_KEY`, already used elsewhere in this toolkit). Note: state codes must be quoted in USPTO query strings (`geographicRegionCode:"OR"`) — otherwise Oregon's abbreviation is parsed as the Lucene `OR` boolean operator and silently returns zero results.

## Patents by company

`scripts/patents-by-company.mjs` — which companies hold the most granted U.S. patents for a given year, among a curated list of ~20 major global filers (Samsung, IBM, Apple, TSMC, Qualcomm, etc.).

```bash
npm run patents-company
node scripts/patents-by-company.mjs --year 2024
node scripts/patents-by-company.mjs --no-image
```

Same USPTO API/key as `patents-by-state.mjs`. The API has no assignee-aggregation endpoint, so this checks a fixed, pre-verified list of company assignee names rather than scanning every applicant — it's "the leader among companies tracked," not a claim to have found the literal #1 patent recipient in America (the caption says this explicitly). Company assignee names were verified against the live database first — several companies file through an IP-holding subsidiary rather than the parent brand (Ford → "Ford Global Technologies," Microsoft → "Microsoft Technology Licensing," GM → "GM Global Technology Operations," Amazon → "Amazon Technologies").

## Booming industries

`scripts/business-formation-by-industry.mjs` — which industries are starting the most new businesses, ranked by year-over-year growth in new business applications by NAICS sector.

```bash
npm run booming-industries
node scripts/business-formation-by-industry.mjs --month 2026-06
node scripts/business-formation-by-industry.mjs --no-image
```

Source: Census Bureau Business Formation Statistics timeseries API (`CENSUS_API_KEY`), seasonally adjusted business applications (`data_type_code=BA_BA`) by 2-digit NAICS sector. The industry-sector cut that neither `business-formation-watch.mjs` (national trend) nor `business-formation-by-state.mjs` (state ranking) covers.

## State exports

`scripts/state-exports-watch.mjs` — which states export the most goods internationally, ranked by total export value for the latest available month.

```bash
npm run state-exports
node scripts/state-exports-watch.mjs --month 2026-05
node scripts/state-exports-watch.mjs --no-image
```

Source: Census Bureau international trade timeseries API (`exports/statenaics`, `CENSUS_API_KEY`), summing 2-digit NAICS goods-sector export values (world total, all countries) per state. Covers physical goods only, not services exports. Note: this endpoint silently returns 204 (no content) when `get=` requests only a single column — the script requests two columns and discards the unused one as a workaround.

## Public data watch scripts

```bash
npm run campaigns
node scripts/campaign-finance-watch.mjs --cycle 2024 --office P
node scripts/campaign-finance-watch.mjs --cycle 2024 --office S

npm run crime
node scripts/crime-trend-watch.mjs --offense violent-crime
node scripts/crime-trend-watch.mjs --offense property-crime

npm run college
node scripts/college-cost-watch.mjs --min-size 10000

npm run electricity
node scripts/electricity-price-watch.mjs --sector RES
node scripts/electricity-price-watch.mjs --sector COM

npm run energy-value
node scripts/energy-value-watch.mjs

npm run energy-person
node scripts/energy-per-person.mjs --no-image      # per-capita energy use + spending, energy units and dollars (needs EIA_API_KEY)
node scripts/energy-per-person.mjs --no-trend      # skip the 2nd card (20-year per-person consumption trend, 2006-latest)
node scripts/energy-per-person.mjs --no-cost-trend # skip the 3rd card (20-year per-person cost trend: nominal vs. real $, plus $/MMBtu unit price)

npm run unemployment
node scripts/state-unemployment-watch.mjs

npm run life
node scripts/state-life-expectancy.mjs --top 10
node scripts/state-life-expectancy.mjs --top 10 --exclude-dc

npm run mortality
node scripts/cdc-mortality-watch.mjs --cause drug-overdose
node scripts/cdc-mortality-watch.mjs --cause suicide
node scripts/cdc-mortality-watch.mjs --cause homicide
node scripts/cdc-mortality-watch.mjs --cause motor-vehicle

npm run wealth
node scripts/wealth-concentration-watch.mjs

node scripts/wealth-ownership-watch.mjs   # two charts: household net worth by asset class (donut), and net worth by economic sector — households, corporations, government (diverging bar; keyless, FRED)

npm run debt-holders-foreign
node scripts/debt-foreign-holders-watch.mjs

npm run contractors
node scripts/federal-contractors-watch.mjs
node scripts/federal-contractors-watch.mjs 2024

npm run tariffs
node scripts/tariff-revenue-watch.mjs

npm run business-formation
node scripts/business-formation-watch.mjs
npm run business-state
node scripts/business-formation-by-state.mjs --top 10
node scripts/business-formation-by-state.mjs --top 10 --exclude-dc

npm run air-quality
node scripts/air-quality-watch.mjs --top 10

npm run ssa
node scripts/ssa-trust-fund-watch.mjs

npm run veterans-homeless
node scripts/veteran-homelessness-watch.mjs

npm run credit-card
node scripts/credit-card-cost-watch.mjs

npm run military
node scripts/military-spending-watch.mjs                        # Ukraine vs Russia, % of GDP, 2011-latest (default)
node scripts/military-spending-watch.mjs --countries USA,CHN --years 20
node scripts/military-spending-watch.mjs --countries UKR,RUS --years 5

npm run profits-vs-wages
node scripts/corporate-profits-vs-wages-watch.mjs                # 45-year window (default)
node scripts/corporate-profits-vs-wages-watch.mjs --years 60

npm run az-water
node scripts/arizona-water-watch.mjs --years 10                  # Lake Mead/Powell + Arizona drought

npm run complaints
node scripts/consumer-complaint-watch.mjs                         # latest 12 months, US + Arizona

npm run vehicle-recalls
node scripts/vehicle-recall-watch.mjs                             # latest NHTSA campaigns + largest recalls

npm run housing-supply
node scripts/housing-supply-watch.mjs --base 2019                # population growth vs housing-stock growth

npm run food-recalls
node scripts/food-recall-watch.mjs --days 365                    # FDA Class I and II reports

npm run time-use
node scripts/american-time-use.mjs                               # latest BLS annual time-use table

npm run disasters
node scripts/disaster-declarations-watch.mjs --years 10          # unique FEMA declarations by state

npm run baby-names
node scripts/baby-name-trends.mjs --years 10                     # US and Arizona name trends
```

Campaign finance, crime, and college use api.data.gov-style keys; set `FEC_API_KEY` in `.env` and optionally `FBI_CDE_API_KEY`. Electricity, `energy-value-watch.mjs`, and `energy-per-person.mjs` use `EIA_API_KEY` (free, instant, at https://www.eia.gov/opendata/register.php). State unemployment uses BLS direct API and can run without a key at this volume. CDC mortality needs no key but is capped at 2020 (see the script header for why) — for current-year figures, use CDC's own NCHS press releases instead. Arizona water, CFPB complaints, NHTSA recalls, housing supply, FDA food recalls, BLS time use, FEMA disasters, and SSA baby names are keyless. Housing supply will use `CENSUS_API_KEY` from `.env` when available. Wealth concentration, foreign debt holders, contractors, tariffs, business formation, the SSA trust fund check, veteran homelessness, and the credit-card cost check are also keyless (wealth via FRED, foreign holders via Treasury TIC, contractors via USASpending, tariffs via Treasury MTS, business formation via the existing `CENSUS_API_KEY`, SSA via a scrape of SSA's own Office of the Chief Actuary page since no JSON API exists, veteran homelessness via a HUD USER `.xlsx` workbook — HUD's full point-in-time dataset is `.xlsb`-only, which `scripts/lib/xlsx-lite.mjs` can't read, but the veteran-specific breakdown is real `.xlsx`; HUD USER also requires a browser-like `User-Agent` header or it WAF-challenges the request; credit-card cost via FRED revolving credit, credit-card APR, and household-count series; military spending via World Bank's military-expenditure indicator, sourced from SIPRI — the World Bank API silently truncates to page 1 if `per_page` isn't set well above `countries × years`, so the all-countries ranking query in this script uses `per_page=2000`). Corporate profits vs. wages uses the existing `BEA_API_KEY` (NIPA Table 1.12, National Income by Type of Income).

## Post idea snapshots

```bash
npm run cost               # node scripts/cost-of-living-index.mjs
node scripts/cost-of-living-index.mjs --years 5 --table
npm run az                 # node scripts/arizona-economy.mjs
npm run az-vs-us           # node scripts/az-vs-us.mjs --topic income
node scripts/rent-vs-income-watch.mjs
node scripts/rent-vs-income-watch.mjs --top 15 --exclude-dc
node scripts/az-vs-us.mjs --topic housing
node scripts/az-vs-us.mjs --topic housing --view extremes --metric rent
node scripts/az-vs-us.mjs --topic income --view extremes --metric income
node scripts/az-vs-us.mjs --topic education
node scripts/az-vs-us.mjs --topic family
node scripts/az-vs-us.mjs --topic commute
node scripts/az-vs-us.mjs --topic demographics
node scripts/az-vs-us.mjs --topic health-social
npm run budget-household   # node scripts/budget-vs-household.mjs
node scripts/budget-vs-household.mjs --income 75000
```

These write `.png`, `.html`, `.txt`, and `.csv` files under `social/` so they can be posted directly or reused as data sources.

## Visual story pack

```bash
npm run visuals       # 3 state maps, GDP bar, 2 donut charts, and 3 historical timelines
npm run cost          # inflation/cost-category bar chart
npm run electricity   # state electricity-price bar chart
```

The visual pack creates state tile maps for population, household income, and home value; a state GDP ranking; federal-spending and energy-mix donuts; and timelines for U.S. population, national debt, and inflation. It uses Census, BEA, EIA, USAspending, Treasury Fiscal Data, and FRED/BLS sources.

## Macro snapshots

```bash
npm run fiscal      # node scripts/fiscal-snapshot.mjs      â€” federal debt/revenue/spending snapshot
npm run dashboard    # node scripts/dashboard.mjs             â€” govt finances + trade + money supply + banking, one command
npm run money        # node scripts/money-supply.mjs          â€” M2 + cash in circulation, 2020-21 "money printing"
npm run money-debt   # node scripts/money-debt-cash.mjs       - graph + Facebook post: M2, cash, debt, bank deposits
node scripts/labor-market.mjs                                 â€” labor market snapshot
node scripts/yield-curve.mjs                                   â€” Treasury yield curve + recession spreads
node scripts/housing.mjs                                       â€” home prices, mortgage rates, supply, homeownership
node scripts/inflation.mjs                                     â€” CPI/PCE by category
node scripts/bls-jobs.mjs                                      â€” employment by industry sector
```

## Debt & household finance

```bash
npm run household   # node scripts/household-debt.mjs        â€” household/nonprofit debt vs. federal debt
npm run holders      # node scripts/household-debt-holders.mjs â€” which banks hold credit-card/auto/consumer/real-estate loans
npm run banks         # node scripts/banking-snapshot.mjs       â€” FDIC-insured banking sector snapshot
```

## Federal spending & budget

```bash
npm run spending    # node scripts/spending-by-category.mjs   (latest complete FY)
npm run tax-detail  # node scripts/tax-dollar-detail.mjs       - detailed federal spending dollar graph + Facebook post
node scripts/tax-dollar-detail.mjs --fy 2025
node scripts/spending-by-category.mjs 2024

node scripts/federal-spending.mjs             # by budget function + by state (defaults to latest FY)
node scripts/federal-spending.mjs 2024
node scripts/federal-spending.mjs --contractors   # top companies by parent

node scripts/federal-awards.mjs                            # top 30 biggest awards this FY
node scripts/federal-awards.mjs --medicare                 # Medicare/CMS recipients
node scripts/federal-awards.mjs --state AZ                 # top recipients in a state
node scripts/federal-awards.mjs --agency "Dept of Defense" # awards from one agency
node scripts/federal-awards.mjs 2024                       # different fiscal year

node scripts/healthcare-spending.mjs
node scripts/healthcare-spending.mjs 2024
```

## Trade & regional economy

```bash
npm run trade        # node scripts/trade-balance.mjs   â€” deficit/surplus, goods vs services, top partners (needs CENSUS_API_KEY for partners section)

node scripts/bea-industry.mjs    # GDP by industry â€” needs BEA_API_KEY
node scripts/bea-regional.mjs    # state GDP/income/cost-of-living rankings â€” needs BEA_API_KEY
npm run world                    # node scripts/world-country-snapshot.mjs
node scripts/world-country-snapshot.mjs --countries US,CN,MX,CA --indicator gdp-per-capita
node scripts/world-country-snapshot.mjs --countries US,CN,MX,CA --indicator inflation

npm run gdp-gap                  # node scripts/gdp-per-capita-gap-watch.mjs — US-China GDP/capita gap, nominal + PPP + exports/capita

npm run life-expectancy-ranked   # node scripts/world-life-expectancy-ranked.mjs — full best-vs-worst ranked infographic, all ~217 countries
node scripts/world-life-expectancy-ranked.mjs --top 25

npm run religion                 # node scripts/religion-adherence-watch.mjs — formal religious congregation adherence by state, 2020 U.S. Religion Census
```

`religion-adherence-watch.mjs` is a special case: there is no federal religion dataset (the Census Bureau is barred from asking), so this fetches the 2020 U.S. Religion Census workbook directly from usreligioncensus.org (ASARB/ARDA, keyless, no login) and parses it with `lib/xlsx-lite.mjs`. It's a decadal study, not annual — don't expect a new vintage until the next Religion Census.

## Weather & local conditions

```bash
npm run weather       # node scripts/weather-check.mjs
node scripts/weather-check.mjs --location "Phoenix, Arizona"
node scripts/weather-check.mjs --location "Tucson, Arizona"
node scripts/weather-check.mjs --location "Washington, DC"
npm run weather-extremes
node scripts/weather-extremes.mjs --mode hot
node scripts/weather-extremes.mjs --mode cold
```

Weather uses Open-Meteo forecast and air-quality APIs, no key required. Outputs `.png`, `.html`, `.txt`, and `.csv` under `social`.
Weather extremes uses Open-Meteo current weather for a curated watchlist of known hot/cold places; it is not an all-station global ranking.

## Food, SNAP, agriculture, and IRS ZIP income

```bash
npm run food-prices
node scripts/usda-food-prices.mjs --years 10
node scripts/usda-food-prices.mjs --years 5 --table

npm run snap
node scripts/usda-snap-watch.mjs --view rate
node scripts/usda-snap-watch.mjs --view rate --top 5 --include AZ
node scripts/usda-snap-watch.mjs --metric households
node scripts/usda-snap-watch.mjs --metric benefits

npm run irs-zip
node scripts/irs-soi-income-zip.mjs --state AZ --metric wages
node scripts/irs-soi-income-zip.mjs --state AZ --metric capgains
node scripts/irs-soi-income-zip.mjs --state AZ --metric charitable

npm run az-ag
node scripts/usda-arizona-ag.mjs --year 2024
```

Food prices use FRED/BLS average retail food price series. SNAP uses USDA Food and Nutrition Service state Excel tables; `--view rate` joins SNAP persons and benefits to Census ACS population to show state population share and spending. IRS ZIP income uses IRS SOI tax year 2022 CSV data. Arizona ag uses USDA NASS QuickStats and requires `USDA_NASS_API_KEY` in `.env`.
`usda-food-prices.mjs` writes two post sets: `usda-food-prices-5yr-YYYY-MM-DD.*` for the current summary bar chart and `usda-food-prices-history-5yr-YYYY-MM-DD.*` for the multi-year small-multiple trend chart. Change `--years` to make matching 10-year assets. Add `--table` to print the year-by-year history table in the terminal.

## API watch scripts

```bash
npm run earthquakes
node scripts/earthquake-watch.mjs --min-mag 4.5 --days 7

npm run crypto
node scripts/crypto-market-watch.mjs --count 10

npm run space
node scripts/nasa-space-watch.mjs

npm run osm
node scripts/osm-place-profile.mjs --place "Phoenix, Arizona" --radius 2000
node scripts/osm-place-profile.mjs --place "Tempe, Arizona" --radius 1500
```

Earthquakes uses USGS. Crypto uses CoinGecko. Space uses NASA APOD + NeoWs; set `NASA_API_KEY` to avoid public `DEMO_KEY` limits. OSM uses Nominatim + Overpass and should be run lightly.

## Demographics and family

```bash
npm run marriage     # node scripts/marriage-rates.mjs
node scripts/marriage-rates.mjs --no-image
npm run census:housing
node scripts/census-population-housing.mjs --state AZ --base 2020
node scripts/census-population-housing.mjs --state CA --base 2020
npm run census
node scripts/census-topic-snapshot.mjs --topic migration --base 2020
node scripts/census-topic-snapshot.mjs --topic migration --base 2020 --direction loss
node scripts/census-topic-snapshot.mjs --topic housing --state AZ
node scripts/census-topic-snapshot.mjs --topic income --state AZ
node scripts/census-topic-snapshot.mjs --topic education --state AZ
node scripts/census-topic-snapshot.mjs --topic family --state AZ
node scripts/census-topic-snapshot.mjs --topic commute --state AZ
node scripts/census-topic-snapshot.mjs --topic business --state AZ
node scripts/census-topic-snapshot.mjs --topic demographics --state AZ
node scripts/census-topic-snapshot.mjs --topic health-social --state AZ
```

Marriage rates uses U.S. Census Bureau 2021 SIPP cohort data and writes `.png`, `.html`, `.txt`, and `.csv` under `social`.
Census housing uses ACS 5-year profile data and requires `CENSUS_API_KEY`.
Census topic snapshots use ACS 5-year profile data and County Business Patterns; topics are `migration`, `housing`, `income`, `education`, `family`, `commute`, `business`, `demographics`, and `health-social`.

## Household opportunity and life-stage posts

```bash
npm run salary-power
node scripts/salary-buying-power-by-state.mjs --salary 50000
node scripts/salary-buying-power-by-state.mjs --salary 100000

npm run public-pay
node scripts/public-service-pay-watch.mjs --job teacher
node scripts/public-service-pay-watch.mjs --job police
node scripts/public-service-pay-watch.mjs --job firefighter

npm run federal-pay
node scripts/federal-workforce-pay.mjs --view occupation
node scripts/federal-workforce-pay.mjs --view agency
node scripts/federal-workforce-pay.mjs --view state
node scripts/federal-workforce-pay.mjs --view city
node scripts/federal-workforce-pay.mjs --view range

npm run az-payroll
# After filling a CSV with official public-record data using the generated template:
node scripts/arizona-public-payroll.mjs --file social\your-payroll-file.csv --metric base
node scripts/arizona-public-payroll.mjs --file social\your-payroll-file.csv --metric gross

npm run young-migration
node scripts/young-adult-migration-watch.mjs

npm run family-cost
node scripts/family-cost-watch.mjs
node scripts/family-cost-watch.mjs --view burden
node scripts/family-cost-watch.mjs --view cost

npm run household-cost
node scripts/household-cost-basket.mjs --view cost
node scripts/household-cost-basket.mjs --view burden

npm run homeowner-cost
npm run income-after-rent
npm run job-openings
npm run property-tax
npm run health-insurance-cost

npm run retirement
node scripts/retirement-readiness-watch.mjs
node scripts/retirement-readiness-watch.mjs --metric under150
node scripts/retirement-readiness-watch.mjs --metric poverty

npm run housing-owners
node scripts/housing-ownership-watch.mjs
```

Salary buying power uses BEA Regional Price Parities and requires `BEA_API_KEY`.
Public-service pay uses BLS OEWS state estimates; unavailable or suppressed states are omitted.
Federal workforce pay downloads OPM's latest official monthly Employment Parquet file, caches it in `.cache/opm`, and reports occupations, agencies, locations, and salary ranges. Python with `pandas` and `pyarrow` is required. OPM redacts many salary records, so the report prints its published-record coverage and calculates averages only from published salaries.
Arizona public payroll shows official elected-office salary rates by default. Arizona OpenBooks aggregates central payroll before publication, so named state-agency, university, and public-safety rankings require an official public-record CSV passed with `--file`. Start with `social/arizona-public-payroll-import-template.csv`; supported columns include employee name, title, agency, base salary, gross pay, category, source, and note.
Young-adult migration measures interstate in-movers ages 18-34, not net migration.
Family cost combines Census median rent with DOL center-based childcare prices for an infant and preschooler.
Household cost combines Census median contract rent, EIA electricity, estimated natural gas, and NAIC auto insurance for one vehicle. It also writes three standalone breakdown post sets: `household-cost-rent-*`, `household-cost-utilities-*`, and `household-cost-auto-insurance-*`. It excludes groceries because no comparable official state-level grocery-price series exists; the output also identifies the mixed source vintages and other omitted expenses.
Retirement readiness reports Census security indicators for residents age 60+, not retirement-account balances.
Housing ownership reports national rental-property legal entities from Census/HUD RHFS, not all U.S. homes or ultimate beneficial owners.

## Jobs & wages

```bash
npm run wages        # node scripts/occupation-wages.mjs           â€” top pay + fastest growing
node scripts/occupation-wages.mjs --top-pay
node scripts/occupation-wages.mjs --growth
node scripts/occupation-wages.mjs --tech
node scripts/occupation-wages.mjs --jobs
node scripts/occupation-wages.mjs --search "nurse"
node scripts/occupation-wages.mjs --offline        # skip live BLS API call

node scripts/jobs.mjs                                â€” open-role counts across 16 tech companies
node scripts/jobs.mjs --search "machine learning"
node scripts/jobs.mjs --company anthropic
node scripts/jobs.mjs --remote
node scripts/jobs.mjs --search "engineer" --company stripe --remote
```

## Company/stock research

```bash
npm run stock -- AMD   # node scripts/stock-fundamentals.mjs AMD   â€” SEC 10-K financials
npm run stock -- MU

npm run screen         # node scripts/revenue-growth.mjs           â€” default watchlist, growth+margin+valuation screen
node scripts/revenue-growth.mjs AMD MU NVDA RBLX

npm run markets        # node scripts/market-watch.mjs             â€” stocks/indexes + gold/silver return snapshot
node scripts/market-watch.mjs --tickers SPY,QQQ,NVDA,AMD,MSFT,AAPL,META,JPM
node scripts/market-watch.mjs SPY QQQ GLD SLV
npm run market-structure
node scripts/market-structure-watch.mjs
```

## Data videos / YouTube Shorts

```powershell
# Automatic text-to-video from a post's Facebook caption
node scripts\make-video.mjs salary-buying-power-youtube --date 2026-07-13

# Structured data video with number cards, comparisons, charts, and source scenes
node scripts\make-video.mjs salary-buying-power-youtube --date 2026-07-13 --script social\_video-scripts\salary-buying-power-youtube-2026-07-13.storyboard.json

# Illustrated explainer with animated characters, a state journey, and household icons
node scripts\make-video.mjs salary-buying-power-explainer --date 2026-07-20 --script social\_video-scripts\salary-buying-power-explainer-2026-07-20.storyboard.json --accent "#e9ad32" --brand "AMERICA BY THE NUMBERS"
```

Structured storyboard beats accept `visual.type` values of `number`, `comparison`, `chart`, `line-chart`, `source`, `character`, `journey`, `household`, and `meme`. A `chart` scene embeds a generated PNG through `visual.src`. A `line-chart` scene can set `dataSrc`, `xKey`, and series entries with `yKey` values to animate directly from a CSV. The illustrated types use original reusable vector scenes: `character` supports `state`, `value`, and `tone`; `journey` animates through up to three labeled `items`; and `household` displays up to four expense categories around a home.

A `meme` scene is a Fireship-style comedic cutaway — narration keeps playing while the screen cuts to an intentionally funny (not literally related) reaction clip:

```json
{ "text": "...narration continues here...", "visual": { "type": "meme", "query": "this is fine fire" } }
```

`query` is a Giphy search term; omit it and `lib/meme-kit.mjs` auto-picks a reaction by scanning the beat's own text against a keyword→mood table (crash/decline → "this is fine fire", record/surge → "success kid", etc.), falling back to a deterministic generic rotation. Requires `GIPHY_API_KEY` — real GIF/video content is fetched from Giphy's Search API (licensed for this kind of embedding) rather than scraped from arbitrary sites, and cached locally in `.cache/memes/` so repeat renders don't re-hit the API. If resolution fails (missing key, no results), that beat silently renders without a cutaway rather than failing the whole video. Requires the sibling `inventor-video` project to have `meme` render support in `FacelessShort.tsx` (adds a small on-screen "GIPHY" attribution badge, per Giphy's API terms).

Videos include Edge TTS narration, synchronized captions, quiet background music, persistent `AMERICA BY THE NUMBERS` branding, and an automatically generated `-thumbnail.png`. Use `--no-music`, `--voice <name>`, or `--brand <name>` to override those defaults. When music has a required attribution, `make-video.mjs` writes a `-video-credit.txt` sidecar and Facebook publishing appends it to video captions automatically.

## Web UI

```bash
npm run web    # node server.mjs
```

## Facebook web approvals

Approval is manual and image-first. Generator jobs only create and stage drafts; the password-protected Approvals page can publish immediately or create a native Facebook scheduled post. Telegram is confirmation-only.

```powershell
# 1. Configure the web approval password (entered without echoing)
powershell -ExecutionPolicy Bypass -File scripts\setup-approval-auth.ps1

# 2. Start the dashboard and open http://127.0.0.1:3000/#approvals
npm.cmd run web

# 3. Stage, list, or remove a generated post
npm.cmd run fb-stage -- stage salary-buying-power-70000 --date 2026-07-13
npm.cmd run fb-stage -- list
npm.cmd run fb-stage -- remove salary-buying-power-70000 --date 2026-07-13

# Verify generated assets and assign multiple posts to the next open automatic slots
npm.cmd run schedule-ready -- homeowner-monthly-cost income-after-rent --date 2026-07-15

# One-time recovery: migrate any older local-only queue entries into Facebook
npm.cmd run schedule-sync

# 4. Test the six-topic rotation without generating anything
npm.cmd run social:auto -- --dry-run

# Compare large named rental owners without treating every LLC as institutional
npm.cmd run rental-owners
```

On the Approvals page, choose an attachment and either:

- **Approve next slot** to place the post in the next open automatic slot. The queue first checks whether today already has two published or scheduled posts. If not, it uses an available remaining slot today; otherwise it fills tomorrow at 8:00 AM, tomorrow at 12:00 PM, then the following day in Arizona time.
- **Publish now** to send it immediately.
- Choose a local date/time and select **Schedule** to move it into **Upcoming schedule** and Meta Business Suite's **Planned content**.
- Use **Reschedule** or **Cancel** from the upcoming list before publishing starts.

The automatic slots can be changed in the gitignored `.env` file:

```dotenv
SOCIAL_SCHEDULE_TIMEZONE=America/Phoenix
SOCIAL_SCHEDULE_SLOTS=08:00,12:00
```

The dashboard stores Facebook's scheduled-post ID so rescheduling and cancellation update Meta and the local queue together. Facebook performs the timed publish, so scheduled posts still publish while this computer is off. Keep the dashboard running only when you want remote access to approvals, or install the login startup task below.

Connect a new Facebook Page with a temporary Meta User Access Token. Request Page-list/read/publish permissions in Graph API Explorer. The token is only used to retrieve the Page Access Token and is removed from the terminal afterward.

```powershell
# Recommended: hidden token prompt, automatic save, and verification
powershell -ExecutionPolicy Bypass -File scripts\connect-facebook-page.ps1

# If your terminal blocks pasting into the hidden prompt, copy the token first:
powershell -ExecutionPolicy Bypass -File scripts\connect-facebook-page.ps1 -FromClipboard

# Equivalent manual commands
$env:FB_USER_ACCESS_TOKEN = Read-Host "Paste the temporary Meta User Access Token"
npm.cmd run fb-connect -- list
npm.cmd run fb-connect -- connect --page "America by the Numbers"
Remove-Item Env:FB_USER_ACCESS_TOKEN
npm.cmd run fb-connect -- verify
```

The connect command writes `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`, and `FB_EXPECTED_PAGE_NAME` to the gitignored `.env`. A live publish is blocked if Meta returns a different Page name.

Install local scheduling after the queue and dashboard look correct:

```powershell
# Generate and stage one rotating post Monday, Wednesday, and Friday at 8:00 AM.
# This task never publishes.
powershell -ExecutionPolicy Bypass -File scripts\install-social-schedule.ps1

# Keep the approval dashboard running after Windows login.
powershell -ExecutionPolicy Bypass -File scripts\install-dashboard-startup.ps1
```

Configure one-way Telegram confirmations through OpenClaw. Save the BotFather token in a text file outside this repository, then run:

```powershell
# First send /start to your new bot, then find your numeric chat ID.
npm.cmd run telegram:chats -- "$HOME\telegram-bot-token.txt"

powershell -ExecutionPolicy Bypass -File scripts\setup-openclaw-telegram.ps1 `
  -TokenFile "$HOME\telegram-bot-token.txt" `
  -ChatId "YOUR_NUMERIC_CHAT_ID"
```

Inbound Telegram DMs and groups are disabled by that setup script. Approval remains web-only.

For temporary remote testing, Cloudflare Tunnel can expose the local dashboard over HTTPS:

```powershell
cloudflared tunnel --url http://127.0.0.1:3000
```

Use a named Cloudflare Tunnel and your own hostname for a stable URL. Keep the dashboard bound to `127.0.0.1`; `cloudflared` connects to it locally.

### Improve scheduled Facebook captions

Preview reaction-first hooks and shorter state rankings without changing Facebook:

```powershell
npm.cmd run captions:improve-scheduled
```

Review `.cache\scheduled-caption-preview.md`, then update both the local caption files and the existing Facebook schedule:

```powershell
npm.cmd run captions:improve-scheduled -- --apply
```

The apply command preserves post times and media, verifies that source URLs remain in every caption, and writes a rollback copy under `.cache\scheduled-caption-backups\`.

## Resume / cover letter PDFs

Edit the HTML source first, then print it to PDF with Edge. Close the target PDF before overwriting it, or Windows may keep the file locked.

```powershell
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$html = "C:\Users\jmacy\projects\job-search-materials\resume.html"
$pdf = "C:\Users\jmacy\projects\job-search-materials\Jeffrey Macy - Resume.pdf"

& $edge `
  --headless=new `
  --disable-gpu `
  --no-pdf-header-footer `
  --print-to-pdf="$pdf" `
  "file:///$($html.Replace('\','/'))"
```

Safer review copy:

```powershell
$pdf = "C:\Users\jmacy\projects\job-search-materials\Jeffrey Macy - Resume - updated.pdf"
```

Use the safer filename first when you want to inspect changes before replacing the main PDF.

## Needs a free API key (set in `.env`, already gitignored)

| Key | Used by | Sign up |
|---|---|---|
| `CENSUS_API_KEY` | Census, migration, family-cost, retirement, and rental-ownership scripts | https://api.census.gov/data/key_signup.html |
| `BEA_API_KEY` | `bea-industry.mjs`, `bea-regional.mjs`, `salary-buying-power-by-state.mjs` | https://apps.bea.gov/API/signup/ |
| `GIPHY_API_KEY` | `make-video.mjs`'s meme-cutaway beats (`lib/meme-kit.mjs`) | https://developers.giphy.com/ (free, instant) |
