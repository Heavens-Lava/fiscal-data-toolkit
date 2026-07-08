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
node scripts/monthly-content-calendar.mjs --month 2026-07 --per-week 1
node scripts/monthly-content-calendar.mjs --topics jobs,inflation,mortgage,household-debt
```

`social-index.mjs` writes `social/index.md` and `social/index.json`.
`monthly-content-calendar.mjs` writes `social/content-calendar-YYYY-MM.md/.json`.

## Post idea snapshots

```bash
npm run cost               # node scripts/cost-of-living-index.mjs
node scripts/cost-of-living-index.mjs --years 5 --table
npm run az                 # node scripts/arizona-economy.mjs
npm run budget-household   # node scripts/budget-vs-household.mjs
node scripts/budget-vs-household.mjs --income 75000
```

These write `.png`, `.html`, `.txt`, and `.csv` files under `social/` so they can be posted directly or reused as data sources.

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
```

## Weather & local conditions

```bash
npm run weather       # node scripts/weather-check.mjs
node scripts/weather-check.mjs --location "Phoenix, Arizona"
node scripts/weather-check.mjs --location "Tucson, Arizona"
node scripts/weather-check.mjs --location "Washington, DC"
```

Weather uses Open-Meteo forecast and air-quality APIs, no key required. Outputs `.png`, `.html`, `.txt`, and `.csv` under `social`.

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

## Web UI

```bash
npm run web    # node server.mjs
```

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
| `CENSUS_API_KEY` | `trade-balance.mjs`, `weekly-digest.mjs --topic trade` | https://api.census.gov/data/key_signup.html |
| `BEA_API_KEY` | `bea-industry.mjs`, `bea-regional.mjs` | https://apps.bea.gov/API/signup/ |
