#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  C, cardHTML, donutChart, fiscal, fmtM, fred, lineChart, screenshot, stateTileMap, toCSV,
} from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, censusRows, envValue, money, num, pct, rel } from "./lib/data-common.mjs";
import { writeStateRankingPost } from "./lib/state-ranking-post.mjs";

const noImage = process.argv.includes("--no-image");
const censusKey = envValue("CENSUS_API_KEY");
const beaKey = envValue("BEA_API_KEY");
const eiaKey = envValue("EIA_API_KEY");
if (!censusKey || !beaKey || !eiaKey) throw new Error("CENSUS_API_KEY, BEA_API_KEY, and EIA_API_KEY are required in .env.");
mkdirSync(SOCIAL, { recursive: true });

function writeAsset({ slug, html, columns, rows, caption, source, vintage }) {
  const base = path.join(SOCIAL, `${slug}-${STAMP}`);
  const text = [`${slug} (${STAMP})`, "", `Source: ${source}. Data through ${vintage}.`, "", "Facebook post", "-------------", ...caption];
  writeFileSync(`${base}.txt`, text.join("\n"));
  writeFileSync(`${base}.csv`, toCSV(columns, rows));
  writeFileSync(`${base}.html`, html);
  const wroteImage = !noImage && screenshot(`${base}.html`, `${base}.png`);
  console.log(`${slug}: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((ext) => rel(`${base}.${ext}`)).join(" / ")}`);
}

const stateByFips = new Map(STATES.map((state) => [state.fips, state]));
const acsYear = 2024;
const acs = await censusRows(acsYear, "acs/acs1/profile", ["DP05_0001E", "DP03_0062E", "DP04_0089E"], "state:*", censusKey);
const stateRows = acs.map((row) => {
  const state = stateByFips.get(row.state);
  return state ? {
    ...state, population: Number(row.DP05_0001E), income: Number(row.DP03_0062E), homeValue: Number(row.DP04_0089E),
  } : null;
}).filter(Boolean);

function writeMap({ slug, kicker, title, metric, metricLabel, fmt, tableFmt, question }) {
  const ranked = stateRows.map((row) => ({ ...row, v: row[metric] })).filter((row) => Number.isFinite(row.v))
    .sort((a, b) => b.v - a.v).map((row, index) => ({ ...row, rank: index + 1 }));
  const high = ranked[0], low = ranked.at(-1), az = ranked.find((row) => row.abbr === "AZ");
  const chartSVG = stateTileMap(ranked, { fmtVal: fmt });
  const html = cardHTML({
    kicker, title, hero: tableFmt(high.v), heroLabel: `${high.state || high.name}; highest ${metricLabel}`,
    chartSVG, source: "U.S. Census Bureau ACS", vintage: String(acsYear),
  });
  const caption = [
    `${high.name} ranks highest for ${metricLabel} at ${tableFmt(high.v)} — versus ${tableFmt(low.v)} in ${low.name}. Every state, ranked:`, "",
    `State | ${metricLabel}`,
    ...ranked.map((row) => `#${row.rank} ${row.name} | ${tableFmt(row.v)}`), "",
    `Arizona ranks #${az.rank}: ${tableFmt(az.v)}.`,
    "This is an equal-size state tile map: color shows the value, not each state's physical land area.", "",
    "Which state surprised you most? Comment below and share this map with someone comparing states.", "",
    "Sources:", "• U.S. Census Bureau American Community Survey",
    "Source website: https://api.census.gov/data/2024/acs/acs1/profile.html",
    "Information retrieved programmatically via API.", "Graph made by Jeffrey Macy.",
  ];
  writeAsset({
    slug, html, columns: ["rank", "state", "abbr", metric, "vintage"],
    rows: ranked.map((row) => [row.rank, row.name, row.abbr, row.v, acsYear]), caption,
    source: "U.S. Census Bureau ACS", vintage: String(acsYear),
  });
}

writeMap({
  slug: "state-map-population", kicker: "Population map", title: "Where Americans live, by state",
  metric: "population", metricLabel: "population", fmt: (v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1000)}k`,
  tableFmt: num, question: "Which states have the largest populations?",
});
writeMap({
  slug: "state-map-income", kicker: "Income map", title: "Median household income by state",
  metric: "income", metricLabel: "median household income", fmt: (v) => `$${Math.round(v / 1000)}k`,
  tableFmt: money, question: "Where are median household incomes highest and lowest?",
});
writeMap({
  slug: "state-map-home-value", kicker: "Home-value map", title: "Median owner-occupied home value by state",
  metric: "homeValue", metricLabel: "median owner-occupied home value", fmt: (v) => `$${Math.round(v / 1000)}k`,
  tableFmt: money, question: "Where are typical owner-occupied homes valued highest and lowest?",
});

const beaQs = new URLSearchParams({
  UserID: beaKey, method: "GetData", DataSetName: "Regional", TableName: "SASUMMARY", LineCode: "4",
  GeoFips: "STATE", Year: "LAST5", ResultFormat: "JSON",
});
const beaResponse = await fetch(`https://apps.bea.gov/api/data?${beaQs}`);
if (!beaResponse.ok) throw new Error(`BEA HTTP ${beaResponse.status}`);
const beaBody = (await beaResponse.json()).BEAAPI;
if (beaBody.Results?.Error) throw new Error(beaBody.Results.Error.APIErrorDescription);
const beaData = beaBody.Results?.Data || [];
const gdpYear = Math.max(...beaData.map((row) => Number(row.TimePeriod)).filter(Number.isFinite));
const gdpRows = beaData.filter((row) => Number(row.TimePeriod) === gdpYear && /^\d{5}$/.test(row.GeoFips) && row.GeoFips !== "00000")
  .map((row) => ({ state: row.GeoName.replace(/ \*+$/, ""), value: Number(String(row.DataValue).replace(/,/g, "")) * 1e6 }))
  .filter((row) => Number.isFinite(row.value) && row.value > 0);
writeStateRankingPost({
  topic: "state-gdp-bar", kicker: "State economy check", title: "Largest state economies by nominal GDP",
  question: "How large is each state economy, measured by nominal GDP?", rows: gdpRows,
  metricLabel: "nominal GDP", source: "U.S. Bureau of Economic Analysis", vintage: String(gdpYear),
  sourceWebsite: "https://apps.bea.gov/iTable/?ReqID=70&step=1",
  note: "Nominal GDP measures the current-dollar value of goods and services produced in each state. It is economic output, not state-government revenue or household income.",
  valueFormat: fmtM, tickFormat: fmtM, noImage,
  engagementQuestion: "Does your state's economic size surprise you? Comment below and share this with someone who follows state economies.",
});

const fiscalYear = new Date().getUTCMonth() >= 9 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
const spendingResponse = await fetch("https://api.usaspending.gov/api/v2/spending/", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "budget_function", filters: { fy: String(fiscalYear), quarter: "4" } }),
});
if (!spendingResponse.ok) throw new Error(`USAspending HTTP ${spendingResponse.status}`);
const spendingAll = ((await spendingResponse.json()).results || []).map((row) => ({ label: row.name, v: Number(row.amount) }))
  .filter((row) => row.label !== "Unreported Data" && row.v > 0).sort((a, b) => b.v - a.v);
const spendingTop = spendingAll.slice(0, 7);
const spendingOther = spendingAll.slice(7).reduce((sum, row) => sum + row.v, 0);
const spendingSlices = [...spendingTop, ...(spendingOther ? [{ label: "Other functions", v: spendingOther }] : [])];
const spendingTotal = spendingSlices.reduce((sum, row) => sum + row.v, 0);
writeAsset({
  slug: "federal-spending-donut",
  html: cardHTML({
    kicker: "Federal spending mix", title: `Federal spending by budget function, FY${fiscalYear}`,
    hero: fmtM(spendingTotal), heroLabel: "gross budget-function total",
    chartSVG: donutChart(spendingSlices, { fmtVal: fmtM, centerTop: fmtM(spendingTotal), centerBottom: `FY${fiscalYear} gross` }),
    source: "USAspending.gov", vintage: `FY${fiscalYear}`,
  }),
  columns: ["rank", "budget_function", "amount", "share_pct"],
  rows: spendingAll.map((row, index) => [index + 1, row.label, row.v, row.v / spendingTotal * 100]),
  caption: [
    "Where does federal spending go?", `${spendingTop[0].label} is the largest gross budget-function category at ${fmtM(spendingTop[0].v)}.`, "",
    "Budget function | Amount | Share", ...spendingAll.map((row) => `${row.label} | ${fmtM(row.v)} | ${pct(row.v / spendingTotal * 100)}`), "",
    "Important caveat: USAspending budget-function figures are gross category totals. They are useful for composition and ranking, but they can exceed net federal outlays because of offsets and accounting transfers.", "",
    "Which category should I break down next? Comment below and share this chart.", "",
    "Sources:", "• USAspending.gov Spending Explorer", "Source website: https://www.usaspending.gov/explorer/budget_function",
    "Information retrieved programmatically via API.", "Graph made by Jeffrey Macy.",
  ], source: "USAspending.gov budget functions", vintage: `FY${fiscalYear}`,
});

const energyDefs = [
  ["PATCBUS", "Petroleum"], ["NNTCBUS", "Natural gas"], ["RETCBUS", "Renewables"], ["CLTCBUS", "Coal"], ["NUETBUS", "Nuclear"],
];
const energyQs = new URLSearchParams({ api_key: eiaKey, frequency: "annual", "data[0]": "value", "sort[0][column]": "period", "sort[0][direction]": "desc", length: "20" });
energyDefs.forEach(([id]) => energyQs.append("facets[msn][]", id));
const energyResponse = await fetch(`https://api.eia.gov/v2/total-energy/data/?${energyQs}`);
if (!energyResponse.ok) throw new Error(`EIA HTTP ${energyResponse.status}`);
const energyData = (await energyResponse.json()).response?.data || [];
const energyYear = energyData[0]?.period;
const energySlices = energyDefs.map(([id, label]) => ({
  label, v: Number(energyData.find((row) => row.period === energyYear && row.msn === id)?.value),
})).filter((row) => row.v > 0).sort((a, b) => b.v - a.v);
const energyTotal = energySlices.reduce((sum, row) => sum + row.v, 0);
writeAsset({
  slug: "energy-mix-donut",
  html: cardHTML({
    kicker: "Energy mix", title: "What powers the United States?", hero: `${(energyTotal / 1000).toFixed(1)} quads`,
    heroLabel: "five-source sum", chartSVG: donutChart(energySlices, { fmtVal: (v) => `${(v / 1000).toFixed(1)}Q`, centerTop: `${(energyTotal / 1000).toFixed(1)}`, centerBottom: "quadrillion Btu" }),
    source: "U.S. Energy Information Administration", vintage: energyYear,
  }),
  columns: ["source", "trillion_btu", "share_pct", "year"],
  rows: energySlices.map((row) => [row.label, row.v, row.v / energyTotal * 100, energyYear]),
  caption: [
    "What sources supply U.S. primary energy?", `${energySlices[0].label} is the largest source at ${pct(energySlices[0].v / energyTotal * 100)} of this five-source total.`, "",
    "Energy source | Share", ...energySlices.map((row) => `${row.label} | ${pct(row.v / energyTotal * 100)} (${(row.v / 1000).toFixed(1)} quadrillion Btu)`), "",
    "These shares use the sum of the five published source series. That sum can differ slightly from EIA's headline total because EIA separately accounts for electricity-system conversion losses.", "",
    "Which energy source should I chart historically next? Comment below and share this chart.", "",
    "Sources:", "• U.S. Energy Information Administration Total Energy", "Source website: https://www.eia.gov/totalenergy/data/browser/",
    "Information retrieved programmatically via API.", "Graph made by Jeffrey Macy.",
  ], source: "U.S. Energy Information Administration", vintage: energyYear,
});

function annualLast(series, startYear = 0) {
  const years = new Map();
  for (const point of series) if (Number(point.d.slice(0, 4)) >= startYear) years.set(point.d.slice(0, 4), point);
  return [...years.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, point]) => ({ year, date: point.d, point }));
}

function writeTimeline({ slug, kicker, title, question, hookLine, series, value, fmt, tickFmt, source, sourceWebsite, note }) {
  const first = series[0], last = series.at(-1);
  const chartSVG = lineChart([{ name: title, color: C.s1, points: series.map((row) => ({ label: row.year, v: value(row) })), endLabel: (formatted) => formatted }], {
    fmtTick: tickFmt, fmtVal: fmt, labelStep: Math.max(1, Math.floor(series.length / 7)),
  });
  const html = cardHTML({ kicker, title, hero: fmt(value(last)), heroLabel: `${last.year} latest annual point`, chartSVG, source, vintage: `${first.year}-${last.year}` });
  // Full table stays in the CSV; the caption shows milestone years only
  // (every ~5th year plus first/last) so it doesn't read as a giant data dump.
  const step = Math.max(1, Math.round(series.length / 12));
  const milestones = series.filter((_, i) => i === 0 || i === series.length - 1 || i % step === 0);
  const caption = [
    hookLine || `${question} ${fmt(value(first))} (${first.year}) → ${fmt(value(last))} (${last.year}).`, "",
    "Year | Value", ...milestones.map((row) => `${row.year} | ${fmt(value(row))}`), "", note, "",
    "What stands out to you in this timeline? Comment below and share it with someone who follows long-term trends.", "",
    "Sources:", `• ${source}`, `Source website: ${sourceWebsite}`, "Information retrieved programmatically via API or official data download.", "Graph made by Jeffrey Macy.",
  ];
  writeAsset({ slug, html, columns: ["year", "value"], rows: series.map((row) => [row.year, value(row)]), caption, source, vintage: `${first.year}-${last.year}` });
}

const currentYear = new Date().getUTCFullYear();
const populationAnnual = annualLast(await fred("POPTHM"), 1960).filter(({ year }) => Number(year) < currentYear)
  .map(({ year, date, point }) => ({ year, date, value: point.v * 1000 }));
writeTimeline({
  slug: "us-population-timeline", kicker: "Population timeline", title: "U.S. population since 1960",
  hookLine: `The U.S. added about ${(((populationAnnual.at(-1).value - populationAnnual[0].value)) / 1e6).toFixed(0)} million people between ${populationAnnual[0].year} and ${populationAnnual.at(-1).year}.`,
  series: populationAnnual, value: (row) => row.value, fmt: (v) => `${(v / 1e6).toFixed(1)} million`, tickFmt: (v) => `${Math.round(v / 1e6)}M`,
  source: "FRED population series POPTHM", sourceWebsite: "https://fred.stlouisfed.org/series/POPTHM",
  note: "This uses the annual year-end observation from the monthly population series.",
});

const debtJson = await fiscal("/v2/accounting/od/debt_to_penny?filter=record_date:gte:2000-01-01&sort=record_date&page[size]=10000");
const debtAnnual = annualLast((debtJson.data || []).map((row) => ({ d: row.record_date, v: Number(row.tot_pub_debt_out_amt) })), 2000)
  .map(({ year, date, point }) => ({ year, date, value: point.v }));
const debtLatestDate = debtAnnual.at(-1).date;
writeTimeline({
  slug: "national-debt-timeline", kicker: "Debt timeline", title: "U.S. national debt since 2000",
  hookLine: `U.S. federal debt has gone from ${fmtM(debtAnnual[0].value)} in ${debtAnnual[0].year} to about ${fmtM(debtAnnual.at(-1).value)} today.`,
  series: debtAnnual, value: (row) => row.value, fmt: fmtM, tickFmt: (v) => `$${Math.round(v / 1e12)}T`,
  source: "U.S. Treasury Fiscal Data, Debt to the Penny", sourceWebsite: "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/debt-to-the-penny",
  note: `This uses the last available daily debt observation in each calendar year; ${debtAnnual.at(-1).year} is partial through ${debtLatestDate}. It is nominal debt, not adjusted for inflation or population.`,
});

const cpiAnnualLevels = annualLast(await fred("CPIAUCSL"), 1959).filter(({ year }) => Number(year) < currentYear)
  .map(({ year, date, point }) => ({ year, date, level: point.v }));
const inflationAnnual = cpiAnnualLevels.slice(1).map((row, index) => ({
  year: row.year, value: (row.level / cpiAnnualLevels[index].level - 1) * 100,
}));
writeTimeline({
  slug: "inflation-timeline", kicker: "Inflation timeline", title: "U.S. inflation rate since 1960",
  hookLine: (() => {
    const peak = inflationAnnual.reduce((a, b) => (b.value > a.value ? b : a));
    const recentPeak = inflationAnnual.filter((r) => Number(r.year) >= 2021).reduce((a, b) => (b.value > a.value ? b : a));
    return `The post-COVID inflation spike hit ${recentPeak.value.toFixed(1)}% in ${recentPeak.year} — painful, but nowhere near the ${peak.value.toFixed(1)}% peak America saw in ${peak.year}.`;
  })(),
  series: inflationAnnual, value: (row) => row.value, fmt: (v) => `${v.toFixed(1)}%`, tickFmt: (v) => `${v.toFixed(0)}%`,
  source: "FRED/BLS Consumer Price Index (CPIAUCSL)", sourceWebsite: "https://fred.stlouisfed.org/series/CPIAUCSL",
  note: "Note: This calculates December-to-December CPI inflation from the seasonally adjusted all-items index. It is not the annual-average inflation measure.",
});

console.log("Existing bar-chart companions: npm run cost (inflation/cost categories) and npm run electricity (state electricity prices).");
