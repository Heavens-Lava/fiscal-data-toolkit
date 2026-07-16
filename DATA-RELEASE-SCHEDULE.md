# Data Release Schedule

When each source we rely on actually publishes new data — separate from
`data-freshness-dashboard.mjs`, which only checks how old our *local*
generated files are. This tells you when a *new* upstream vintage is likely
to exist at all, so a repost is genuinely fresh rather than the same
numbers regenerated.

Our scripts already auto-detect the latest available vintage each run (most
loop through candidate years/periods and use whichever responds first), so
there's nothing to change there — this doc is purely about *when it's worth
checking back*.

**Legend**: Annual sources are the main driver of the ~365-day repost
cadence — a topic built on one of these genuinely has new data once a year,
right around the month listed.

| Source | Used by | Cadence | Typical release window |
|---|---|---|---|
| Census ACS 1-year estimates | `state-income-watch`, `retirement-readiness-watch`, `family-cost-watch`, `housing-supply-watch`, most `census-*` scripts | Annual | **Mid-September** for prior calendar year's data |
| Census Population Estimates (PEP) | `state-population-watch` | Annual | **Late December** (vintage covering July 1 of that year) |
| Census SAIPE (poverty) | future poverty-rate scripts | Annual | **December** |
| BEA Regional (state GDP, personal income) | `state-gdp-watch`, `bea-regional`, `bea-industry` | Quarterly | ~**4 months** after quarter end (e.g., Q4 data lands ~late March); the *annual* full-year GDP revision lands **late March** |
| BEA Regional Price Parities | `salary-buying-power-by-state` | Annual | **December** (covers prior year) |
| BLS state unemployment (LAUS) | `state-unemployment-watch` | Monthly | ~**3 weeks** after month end |
| BLS OEWS (occupational wages) | `occupation-wages`, `state-top-jobs`, `public-service-pay-watch` | Annual | **Late March/early April** |
| BLS CPI | `cost-of-living-index`, `inflation` | Monthly | ~**2 weeks** after month end |
| BLS American Time Use Survey | `american-time-use` | Annual | **Late June** |
| EIA electricity (retail sales, generation) | `electricity-price-watch`, `state-electricity-generation-watch`, `electricity-fuel-mix-watch`, `electric-bill-watch` | Monthly | ~**2 months** lag (e.g., data through April lands in June) |
| EIA natural gas price/production | `family-cost-watch` (gas), `natural-gas-production-watch` | Monthly (US) / Annual (international) | Domestic: ~2 month lag. International comparison: **full prior year** lands around **June** |
| EIA Total Energy (historical mix) | `energy-mix-history-watch` | Annual (with monthly updates) | Prior full year finalized by **~March** |
| DOL National Database of Childcare Prices | `family-cost-watch` | Irregular (roughly every 1-2 years) | No fixed calendar — check `dol.gov/agencies/wb/topics/childcare/price-by-age-care-setting` before assuming a new vintage exists |
| NAIC Auto Insurance Database | `auto-insurance-watch` | Every 1-2 years | No fixed calendar — manually check `content.naic.org` (see `lib/naic-auto-insurance-2023.mjs` refresh notes) |
| USDA NASS QuickStats | agriculture scripts (once unblocked) | Varies by commodity/report | Many annual reports land **February** (prior year); some are monthly/quarterly — check per-commodity |
| SSA baby names | `baby-name-trends` | Annual | **Mid-May** |
| FBI Crime Data Explorer | `crime-trend-watch` | Annual (with monthly partial updates) | Full-year data finalized **~September/October** the following year |
| Census/HUD Rental Housing Finance Survey | `housing-ownership-watch` (largest rental owners) | Triennial | No fixed month — check before assuming a new wave exists |
| FRED-hosted series (most macro indicators) | many scripts | Varies (matches the underlying agency above) | FRED mirrors the source agency's own schedule |

## How this pairs with the 365-day rotation

Most of the state-ranking content in this toolkit (income, GDP, population,
poverty, childcare, life expectancy, education, etc.) is built on **annual**
sources. That naturally supports a ~1-year repost cadence: by the time a
topic comes back up in `repost-candidates.mjs`, the relevant agency has
almost always published a new vintage — so "same topic, new year's data" is
usually already true without extra tracking.

The exceptions are the irregular ones (DOL childcare, NAIC insurance, USDA
per-report, HUD rental survey) — those need a quick manual check against the
source before regenerating, since there's no fixed calendar to rely on.

**Before assuming a full year of unique content is available**: cross-check
this table against `CONTENT-ROADMAP.md`'s ✅/🟢 items — as of this writing
there are **32 already built + 57 easy-to-build** (89 total) topics across
cost-of-living, income, energy, population, and government categories.
At 2 posts/day, that's comfortably more than a full year's worth before any
topic needs to repeat — and by the time it does, the annual sources above
will have published a new vintage anyway.
