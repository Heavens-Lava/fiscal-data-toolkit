# Content Roadmap — "America by the Numbers"

Living plan for future posts, organized by category. Cross-referenced against
what's already built. Update this file as posts get built or ideas get added.

**Legend**
- ✅ **Built** — script exists in `scripts/`
- 🟢 **Easy** — solid official/live data source, straightforward to build
- 🟡 **Needs research** — a source exists but is awkward (periodic PDF, needs a
  new API key, coarse granularity, or requires a quick feasibility check
  before committing)
- 🔴 **Not feasible (official-only)** — no clean official/audited source found;
  would require a private/commercial data provider, which breaks this
  project's "official sources only" standard

---

## 🏠 Cost of Living

| Idea | Status | Notes |
|---|---|---|
| Median home price by state | 🟢 | Census ACS median home value (already pulled in `housing-affordability-ownership.mjs`) |
| Median rent by state | ✅ | `rent-vs-income-watch.mjs`, `family-cost-watch.mjs`, `income-after-rent.mjs` |
| Income needed to buy the median home | ✅ | `homeowner-monthly-cost.mjs`, `housing-affordability-ownership.mjs` |
| Property tax by state | ✅ | `property-tax-by-state.mjs` |
| Home insurance by state | 🟡 | Same problem as auto insurance — no live official state API; would need a periodic-report approach (NAIC/III publish some data) |
| Average electric bill | ✅ | `electric-bill-watch.mjs` |
| Average water bill | 🔴 | No official multi-state water-utility billing dataset found |
| Average internet bill | 🔴 | FCC tracks broadband *availability/speed*, not consumer pricing |
| Average grocery costs | 🟡 | Only national-level official data exists (`usda-food-prices.mjs`); no state breakdown |
| Average childcare costs | ✅ | `family-cost-watch.mjs`, `household-cost-basket.mjs` |
| Gasoline prices | ✅ | Covered via EIA (see `energy-value-watch.mjs`, AZ-specific gas scripts) |
| Commute times | 🟢 | Census ACS commute-time variable, easy |
| Vehicle ownership costs | 🟡 | Auto insurance ✅ built; full cost (loan + fuel + maintenance) needs more sources |
| Household spending by category | 🟡 | `spending-by-category.mjs` exists but covers *federal* spending, not household budgets — would need BLS Consumer Expenditure Survey for a household version |
| State inflation over time | 🟡 | CPI is national/regional (4 Census regions), not state-level — same limitation as groceries |

## 💰 Income & Economy

| Idea | Status | Notes |
|---|---|---|
| Median household income | ✅ | `state-income-watch.mjs` |
| Median individual income | 🟢 | Census ACS per-capita/personal income variable |
| Median wage | ✅ | `bls-jobs.mjs`, `occupation-wages.mjs`, `state-top-jobs.mjs` |
| Poverty rate | 🟢 | Census SAIPE; `retirement-readiness-watch.mjs` covers the 60+ angle already |
| Unemployment | ✅ | `state-unemployment-watch.mjs` |
| Labor force participation | ✅ | `labor-market.mjs` |
| GDP by state | ✅ | `state-gdp-watch.mjs`, `bea-regional.mjs` |
| GDP per capita | 🟢 | `bea-regional.mjs` already computes this internally — easy extraction |
| State economies growing over time | ✅ | `state-gdp-growth-watch.mjs` (real/inflation-adjusted GDP growth by state) |
| Global economic growth comparison | ✅ | `world-gdp-growth-watch.mjs` |
| Global population comparison | ✅ | `world-population-watch.mjs` |
| Population vs. landmass (density), global | ✅ | `world-population-density-watch.mjs` |
| Fortune 500 headquarters | 🔴 | Fortune's ranking is proprietary; a from-scratch version via SEC EDGAR HQ addresses is possible but a big lift |
| Billionaires by state | 🔴 | No official source (Forbes list is private/commercial) |
| Millionaires by state | 🟡 | No direct official metric; IRS SOI $1M+ *income* tax returns by state is a workable proxy (income, not net worth — needs a clear caveat) |
| Fastest growing jobs | ✅ | `occupation-wages.mjs`, `state-top-jobs.mjs` |
| Largest employers | 🔴 | No official ranking; Fortune/Forbes-style lists are compiled from private sources |
| Union membership | 🟢 | BLS Current Population Survey union tables by state |
| Small business creation | ✅ | `business-formation-watch.mjs`, `business-formation-by-state.mjs` |

## ⚡ Energy — established specialty

| Idea | Status | Notes |
|---|---|---|
| Which states produce the most electricity? | ✅ | `state-electricity-generation-watch.mjs` |
| Electricity sources by state | ✅ | `electricity-fuel-mix-watch.mjs` (national mix) |
| Nuclear generation | ✅ | `state-fuel-generation-watch.mjs --fuel nuclear` |
| Wind generation | ✅ | `state-fuel-generation-watch.mjs --fuel wind` — confirmed Texas #1 |
| Solar generation | ✅ | `state-fuel-generation-watch.mjs --fuel solar` — confirmed California #1 |
| Coal generation | ✅ | `state-fuel-generation-watch.mjs --fuel coal` |
| Hydroelectric generation | ✅ | `state-fuel-generation-watch.mjs --fuel hydro` — confirmed Washington #1 |
| Oil production | ✅ | `state-oil-production-watch.mjs` — confirmed Texas/New Mexico/North Dakota top 3 |
| Natural gas production | ✅ | `natural-gas-production-watch.mjs` (international, US #1); state-level version still open |
| Oil reserves | 🟢 | EIA proved reserves data |
| LNG exports | 🟢 | EIA LNG export data |
| Electricity prices | ✅ | `electricity-price-watch.mjs`, `electric-bill-watch.mjs` |
| Residential/commercial/industrial electricity use | 🟢 | Same EIA sector facet (RES/COM/IND) already used elsewhere |
| Carbon emissions | ✅ | `state-carbon-emissions-watch.mjs` — confirmed Texas #1 by a wide margin |
| Energy imports/exports | 🟢 | EIA international/petroleum trade data |

**Ready-made hooks confirmed by our own data this session:** US #1 in natural gas production by a wide margin; natural gas is ~41% of US electricity generation; coal down from 46%→17% since 1976; Texas #1 in wind AND oil AND emissions; California #1 solar; Washington #1 hydro (63% of its own generation); Illinois #1 nuclear; West Virginia 87% coal-dependent.

## 🗺 Geography

| Idea | Status | Notes |
|---|---|---|
| Largest/smallest states (land area) | 🟢 | Census/USGS land area — trivial, mostly a one-time reference card |
| Highest mountains / longest rivers | 🟢 | USGS static reference data |
| National parks | 🟢 | NPS API has visitor stats (recurring "watch" angle: visitation trends) |
| Forest coverage | 🟢 | USDA Forest Service FIA data |
| Public land / federal land ownership | 🟡 | CRS periodic report, same "manual dataset" treatment as auto insurance |
| Coastline length | 🟢 | NOAA static reference |
| Population density | ✅ | `world-population-density-watch.mjs` (global); state-level version still open |
| Urbanization | 🟢 | Census urban/rural population share |
| Time zones | 🔴 | Not really data-driven content — static trivia |
| Elevation | 🟢 | NOAA/USGS static reference |
| Rainfall / snowfall | ✅ | `weather-extremes.mjs`, `weather-check.mjs` |
| Tornadoes | 🟢 | NOAA Storm Events Database, state counts |
| Hurricanes | 🟢 | NOAA/NHC data |

## 🌎 Population

| Idea | Status | Notes |
|---|---|---|
| Population growth | ✅ | `state-population-watch.mjs --view growth` |
| Birth rates / death rates | 🟢 | CDC NCHS vital statistics by state |
| Median age | 🟢 | Census ACS, trivial extension |
| Immigration | 🟡 | DHS/Census foreign-born data exists, needs a look |
| Veterans | 🟢 | Census/VA veteran population by state (`veteran-homelessness-watch.mjs` covers one angle already) |
| College graduates | 🟢 | Census ACS educational attainment |
| Languages spoken | 🟢 | Census ACS language data |
| Household size | 🟢 | Census ACS |
| Marriage rate | ✅ | `marriage-rates.mjs` |
| Life expectancy | ✅ | `state-life-expectancy.mjs` |

## 🚗 Transportation

| Idea | Status | Notes |
|---|---|---|
| Vehicle ownership | 🟢 | Census ACS vehicles-available data |
| EV registrations | 🟢 | DOE Alternative Fuels Data Center, state EV registration counts |
| Public transit | 🟡 | FTA National Transit Database — exists, more complex to parse |
| Airport traffic | 🟡 | BTS/FAA enplanement data — needs an API feasibility check |
| Highway miles | 🟢 | FHWA Highway Statistics, state mileage tables |
| Traffic congestion | 🔴 | Standard sources (INRIX, TomTom) are private/commercial |
| Bridges | 🟢 | FHWA National Bridge Inventory |
| Railroads | 🟢 | FRA/BTS rail mileage |
| Freight movement | 🟡 | BTS Freight Analysis Framework — exists, complex |
| Shipping ports | 🟡 | Army Corps Waterborne Commerce data — periodic-report style, like auto insurance |

## 🌽 Agriculture — unlocked

`USDA_NASS_API_KEY` added and all 10 core commodities built as
`state-agriculture-watch.mjs --commodity <key>`, each verified against known
facts:

| Idea | Status | Notes |
|---|---|---|
| Corn | ✅ | Iowa #1, confirmed |
| Wheat | ✅ | North Dakota #1, confirmed |
| Soybeans | ✅ | Illinois #1, confirmed |
| Cotton | ✅ | Texas #1, confirmed |
| Cattle (incl. beef angle) | ✅ | Texas #1 (12M head), confirmed |
| Hogs (incl. pork angle) | ✅ | Iowa #1, confirmed |
| Dairy / milk | ✅ | California #1, confirmed |
| Chickens (broilers) | ✅ | Georgia #1, confirmed |
| Almonds | ✅ | California #1 (near-monopoly), confirmed |
| Grapes (wine proxy) | ✅ | California #1, confirmed |
| Fruit (general) / Vegetables (general) | 🟡 | No single clean NASS aggregate found yet for the broad category — would need a specific representative crop (e.g. potatoes, tomatoes) instead |
| Eggs | ✅ | Iowa #1, confirmed |
| Sheep | ✅ | Texas #1, confirmed |
| Goats | ✅ | Texas #1 (Census of Ag year, 2022), confirmed |
| Bison | ✅ | South Dakota #1 (Census of Ag year, 2022), confirmed |
| Turkeys | ✅ | Minnesota #1, confirmed |
| Honey | ✅ | North Dakota #1 — a genuinely surprising fact, confirmed |
| Dairy cows (vs. milk volume) | ✅ | California #1 in cows too — sets up the "Wisconsin is 'America's Dairyland' but California produces more milk" surprise angle |
| Horses | 🟡 | No usable state-level NASS data found under "HORSES" — needs more digging (may be tracked as "EQUINE" or not by NASS at all) |
| Cheese / Ice cream | 🟡 | These are processed dairy products, not raw commodities — likely need NASS's separate "Dairy Products" survey, not yet investigated |
| Food map (Corn Belt, Cotton Belt, Wine Country, etc.) | 🟡 | Geographic/cartographic concept, not a state ranking — would need actual map-rendering (not just our bar-chart tool), a bigger lift |
| Farm income / farm exports / farm employment / ag GDP / crop value / farm debt / farm sizes / family farms | 🟢 | Likely USDA ERS (Economic Research Service) or NASS Census of Agriculture data — feasible, not yet verified |
| Countries buying U.S. corn/soybeans/beef/wheat/cotton (ag exports) | 🟡 | USDA FAS (Foreign Agricultural Service) trade data or Census international trade data — feasible, needs API investigation |
| Drought Monitor | 🟢 | drought.gov has an API; ties in well with the existing `arizona-water-watch.mjs` pattern |
| Crop yields / growing seasons / Plant Hardiness Zones | 🟡 | Yields are implicit in production ÷ acreage (NASS has acreage data too); hardiness zones are a static USDA map, not an annual "watch" |

Found and fixed a real bug along the way: NASS returns multiple in-season
forecast rows per year (Aug/Sep/Oct/Nov) plus livestock inventory snapshots
on non-calendar-year schedules — naive querying produced duplicate/wrong
rankings until pinned to the correct `reference_period_desc` per commodity
type (see comments in `state-agriculture-watch.mjs`).

## 🏛 Government

| Idea | Status | Notes |
|---|---|---|
| Federal spending | ✅ | `federal-spending.mjs`, `spending-by-category.mjs`, `tax-dollar-detail.mjs` |
| Tax revenue | ✅ | `tax-dollar-detail.mjs` |
| Federal debt | ✅ | `money-debt-cash.mjs`, `debt-foreign-holders-watch.mjs`, etc. |
| Congress explained | 🟡 | congress.gov API has member/composition data — more "explainer," less "watch" |
| Electoral votes | 🟢 | Static reference by state (Census apportionment-based) |
| Federal employees | ✅ | `federal-workforce-pay.mjs` |
| Military spending | ✅ | `military-spending-watch.mjs` |
| Social Security | ✅ | `ssa-trust-fund-watch.mjs` |
| Medicare / Medicaid | 🟢 | CMS spending/enrollment by state (`healthcare-spending.mjs` touches federal health spending already) |

## 📈 History

Mostly static/reference "explainer" content rather than the toolkit's usual
live-data "watch" format — lower priority, but a few have real recurring data:

| Idea | Status | Notes |
|---|---|---|
| Every Census (population milestones) | 🟢 | Real historical Census data, good timeline content |
| Every recession | 🟢 | NBER dates + FRED data — same style as `yield-curve.mjs` |
| Interstate construction | 🟡 | Historical FHWA data, niche |
| National parks timeline | 🟡 | NPS establishment dates, mostly static |
| Every President / Amendment / War / Moon landing | 🔴 | Pure trivia/reference, not really "data" — skip or treat as occasional one-offs, not a series |

## 🛰 Science & Technology

| Idea | Status | Notes |
|---|---|---|
| NASA missions | ✅ | `nasa-space-watch.mjs` |
| Internet usage | 🟢 | Census ACS broadband/internet subscription by state |
| Broadband access | 🟢 | FCC Broadband Data Collection |
| AI adoption | 🔴 | No comprehensive official state-level dataset yet |
| Semiconductor manufacturing | 🟡 | Possible via Census/BEA industry data, niche |
| Data centers | 🔴 | No official state-level dataset found |
| Patents | 🟢 | USPTO PatentsView API has state-level patent counts |
| Supercomputers | 🔴 | TOP500 is a private list |
| Satellites / space launches | 🟢 | NASA/FAA/CelesTrak data, niche but feasible |

## 🎓 Education

| Idea | Status | Notes |
|---|---|---|
| Graduation rates | 🟢 | NCES state graduation rates |
| College tuition | ✅ | `college-cost-watch.mjs` |
| Student debt | 🟢 | Dept. of Education / Fed data by state |
| Literacy | 🟡 | NCES adult literacy data, infrequent updates |
| School spending | 🟢 | NCES/Census per-pupil spending by state |
| Teacher salaries | ✅ | `public-service-pay-watch.mjs` |
| SAT scores | 🟡 | College Board has no free API; state data comes as periodic reports — same "manual dataset" treatment as auto insurance |
| Degrees by state | 🟢 | Census ACS educational attainment (same source as "college graduates" above) |

## 🏥 Health

| Idea | Status | Notes |
|---|---|---|
| Obesity / smoking / exercise | 🟢 | CDC BRFSS state-level rates |
| Life expectancy | ✅ | `state-life-expectancy.mjs` |
| Cancer rates | 🟢 | CDC/NCI state cancer statistics |
| Hospital beds / physicians | 🟢 | CMS/HRSA workforce and facility data by state |
| Mental health | 🟡 | SAMHSA state data, more complex |
| Health insurance | ✅ | `health-insurance-cost-by-state.mjs` |

## 🏆 "America's Biggest" (superlatives)

| Idea | Status | Notes |
|---|---|---|
| Largest city / county | 🟢 | Derivable from Census population data already pulled |
| Largest solar/wind/nuclear plant | 🟢 | EIA-860 has individual power-plant capacity by state — real ranking, not trivia |
| Largest dam / bridge / reservoir | 🟢 | Army Corps National Inventory of Dams, FHWA bridge inventory |
| Largest employer | 🔴 | Same issue as "largest employers" above — no official ranking |
| Largest airport / military base | 🟡 | Needs the same BTS/DoD feasibility check as transportation section |
| Largest stadium / shopping mall / library / museum | 🔴 | No official size-ranking dataset; these are trivia/commercial-list territory |

---

## Suggested build order (next batches)

1. ~~**Energy deep-dive**~~ ✅ **Done** — wind/solar/nuclear/coal/hydro generation by state, oil production by state, carbon emissions by state, state GDP growth, and the global GDP-growth/population/density trio all built and verified.
2. **Unlock agriculture**: get the free `USDA_NASS_API_KEY`, then the whole agriculture category opens up in one session.
3. **Population/health rollout**: birth/death rates, median age, veterans, educational attainment — all Census ACS, same pattern as `state-income-watch.mjs`.
4. **Geography reference set**: land area, density, coastline, elevation — mostly one-time "info card" style rather than recurring watches.
5. **Periodic/manual-dataset batch** (same treatment as NAIC auto insurance): home insurance, federal land ownership, SAT scores, shipping ports — batch these together since they share the "render-and-verify a periodic report" workflow.
6. **Skip / revisit only if a new source turns up**: largest employers, billionaires, water/internet bills, traffic congestion, AI adoption, data centers, supercomputers, stadiums/malls/museums.

## Progress log

- **2026-07-16**: Energy deep-dive batch (7 posts) + state GDP growth + world GDP growth/population/density (4 posts) = 11 posts built, verified against known facts, staged, and scheduled.
