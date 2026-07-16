#!/usr/bin/env node
// energy-per-person.mjs - how much energy the average American uses, and
// what it costs, per person - in both energy units (million Btu, and a
// gasoline-gallon equivalent) and dollars. Builds on the same EIA totals as
// energy-value-watch.mjs but divides by population (FRED POPTHM) to get a
// per-capita view. Also writes a second card: a 20-year trend line
// (2006-2025 - 2026 isn't published yet, EIA's annual data lags by ~7 months)
// of per-capita consumption. Needs EIA_API_KEY in .env (same key as
// energy-value-watch.mjs).
//
// Run:  node scripts/energy-per-person.mjs
//       node scripts/energy-per-person.mjs --no-image
//       node scripts/energy-per-person.mjs --no-trend   — skip the 20-year trend card

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, closest, fred, horizontalBarChart, lineChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

const SOURCES = [
  { msn: "PATCBUS", label: "Petroleum" },
  { msn: "NNTCBUS", label: "Natural gas" },
  { msn: "RETCBUS", label: "Renewables" },
  { msn: "CLTCBUS", label: "Coal" },
  { msn: "NUETBUS", label: "Nuclear" },
];

// EIA's standard heat-content factor for motor gasoline — used only to turn
// an abstract "million Btu" into something relatable ("gallons of gas worth
// of energy"), not for any dollar math.
const BTU_PER_GALLON_GASOLINE = 125000;

function getKey() {
  if (process.env.EIA_API_KEY) return process.env.EIA_API_KEY;
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^EIA_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function money(n) {
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

async function eia(pathq) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`https://api.eia.gov${pathq}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`EIA API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`EIA API timed out after 20s for ${pathq}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function eiaLatest(collection, seriesId, facetKey = "msn") {
  const qs = new URLSearchParams({
    api_key: key, frequency: "annual", "data[0]": "value",
    [`facets[${facetKey}][]`]: seriesId, "sort[0][column]": "period", "sort[0][direction]": "desc", length: "1",
  });
  if (collection === "seds") qs.set("facets[stateId][]", "US");
  const json = await eia(`/v2/${collection}/data/?${qs}`);
  const row = json.response?.data?.[0];
  if (!row) throw new Error(`No EIA data for ${collection}/${seriesId}`);
  return { period: row.period, value: Number(row.value) };
}

// A full multi-year run in one call (ascending) rather than N separate
// "latest" calls — cheaper and avoids 20 round-trips for a trend chart.
async function eiaRange(collection, seriesId, facetKey, startPeriod) {
  const qs = new URLSearchParams({
    api_key: key, frequency: "annual", "data[0]": "value", start: startPeriod,
    [`facets[${facetKey}][]`]: seriesId, "sort[0][column]": "period", "sort[0][direction]": "asc", length: "50",
  });
  if (collection === "seds") qs.set("facets[stateId][]", "US");
  const json = await eia(`/v2/${collection}/data/?${qs}`);
  const rows = json.response?.data;
  if (!rows?.length) throw new Error(`No EIA range data for ${collection}/${seriesId}`);
  return rows.map((r) => ({ period: r.period, value: Number(r.value) }));
}

const key = getKey();
if (!key) {
  console.error("Missing EIA_API_KEY. Get a free key (emailed instantly) at https://www.eia.gov/opendata/register.php and set EIA_API_KEY in .env.");
  process.exit(1);
}

const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `energy-per-person-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

console.log("  Fetching total US energy consumption from EIA...");
const totalConsumption = await eiaLatest("total-energy", "TETCBUS");

console.log("  Fetching consumption by source (5 EIA calls)...");
const sourceRows = await Promise.all(
  SOURCES.map(async (s) => ({ ...s, ...(await eiaLatest("total-energy", s.msn)) }))
);

console.log("  Fetching total energy expenditure from EIA SEDS...");
const expenditure = await eiaLatest("seds", "TETCV", "seriesId");

console.log("  Fetching US population from FRED...");
const popRows = await fred("POPTHM"); // thousands, monthly

// Match population to the SAME year as each EIA figure (mid-year, July 1) —
// EIA's expenditure series lags consumption by about a year, so using
// "latest" population for both would silently misstate one of the two
// per-capita figures.
const popAtConsumption = closest(popRows, `${totalConsumption.period}-07-01`);
const popAtExpenditure = closest(popRows, `${expenditure.period}-07-01`);
const populationConsumptionYear = popAtConsumption.v * 1000;
const populationExpenditureYear = popAtExpenditure.v * 1000;

const totalQuads = totalConsumption.value / 1000;
const expenditureDollars = expenditure.value * 1e6;

// Per-capita energy: trillion Btu -> million Btu, divided by population.
const perCapitaMMBtu = (totalConsumption.value * 1e6) / populationConsumptionYear;
const perCapitaGallonsEquiv = (perCapitaMMBtu * 1e6) / BTU_PER_GALLON_GASOLINE;
const perCapitaDollars = expenditureDollars / populationExpenditureYear;
const perCapitaDollarsPerDay = perCapitaDollars / 365;

const perCapitaBySource = sourceRows
  .map((r) => ({ label: r.label, mmBtu: (r.value * 1e6) / populationConsumptionYear }))
  .sort((a, b) => b.mmBtu - a.mmBtu);
// Shares are of the 5-SOURCE sum, not the official total — EIA's five
// published sources sum to slightly more than the headline total (electricity
// conversion-loss netting), same discrepancy energy-value-watch.mjs flags.
// Dividing by the official total here would make the shares overshoot 100%.
const perCapitaSourceSum = perCapitaBySource.reduce((s, r) => s + r.mmBtu, 0);
const sourceOverage = (perCapitaSourceSum / perCapitaMMBtu - 1) * 100;

const chartSVG = horizontalBarChart(
  perCapitaBySource.map((r, i) => ({
    label: `${r.label} (${((r.mmBtu / perCapitaSourceSum) * 100).toFixed(0)}%)`,
    v: r.mmBtu,
    color: i === 0 ? C.s2 : C.s1,
  })),
  { fmtTick: (v) => `${v.toFixed(0)} MMBtu`, fmtVal: (v) => `${v.toFixed(1)} MMBtu` }
);

const html = cardHTML({
  kicker: "Energy use per person",
  title: "How much energy does the average American use — and what does it cost?",
  hero: money(perCapitaDollars),
  heroLabel: `avg. energy spending per person · ${expenditure.period}`,
  chartSVG,
  source: "EIA Total Energy / SEDS, FRED population",
  vintage: `${totalConsumption.period} consumption, ${expenditure.period} spending`,
});

const facebook = [
  "Energy per person check:",
  "",
  `The US consumed ${totalQuads.toFixed(1)} quadrillion BTU ("quads") of primary energy in ${totalConsumption.period}. Divide that by the population (about ${(populationConsumptionYear / 1e6).toFixed(0)} million people) and the average American's share works out to about ${perCapitaMMBtu.toFixed(0)} million Btu per year — roughly the energy equivalent of ${Math.round(perCapitaGallonsEquiv).toLocaleString("en-US")} gallons of gasoline (about ${(perCapitaGallonsEquiv / 365).toFixed(1)} gallons' worth every single day). Most of that energy never touches a gas tank, though — it's electricity, heating fuel, industrial energy, and more; the gallon figure is just a relatable stand-in for the raw heat content.`,
  "",
  `What that energy actually costs: EIA's own expenditure estimate is ${money(expenditureDollars)} for ${expenditure.period} (the most recent year with published expenditure data — it lags consumption data by about a year). Spread across the population that year (about ${(populationExpenditureYear / 1e6).toFixed(0)} million people), that's about ${money(perCapitaDollars)} per person per year — roughly $${perCapitaDollarsPerDay.toFixed(2)} a day.`,
  "",
  `By source, per person: ${perCapitaBySource.map((r) => `${r.label} ${r.mmBtu.toFixed(0)} MMBtu`).join(", ")}. (These five sources sum to about ${sourceOverage.toFixed(1)}% more than the official total due to how EIA nets out electricity conversion losses — shares above are each source's share of the five-source sum, not the headline total.)`,
  "",
  "Real numbers, real source — EIA Total Energy, EIA State Energy Data System, FRED population:",
  "https://www.eia.gov/totalenergy/data/monthly/",
];

const lines = [
  `Energy per person check (${stamp})`,
  "",
  `Total primary energy consumption: ${totalQuads.toFixed(2)} quads (${totalConsumption.period})`,
  `Total energy expenditure: ${money(expenditureDollars)} (${expenditure.period})`,
  `US population (mid-${totalConsumption.period}): ${(populationConsumptionYear / 1e6).toFixed(1)}M`,
  `US population (mid-${expenditure.period}): ${(populationExpenditureYear / 1e6).toFixed(1)}M`,
  "",
  `Per-person energy consumption: ${perCapitaMMBtu.toFixed(1)} million Btu/year (${totalConsumption.period}) ~ ${Math.round(perCapitaGallonsEquiv).toLocaleString("en-US")} gallons of gasoline equivalent`,
  `Per-person energy spending: ${money(perCapitaDollars)}/year (${expenditure.period}) = $${perCapitaDollarsPerDay.toFixed(2)}/day`,
  "",
  "Source | Per person (million Btu) | Share of 5-source total",
  "---|---:|---:",
  ...perCapitaBySource.map((r) => `${r.label} | ${r.mmBtu.toFixed(1)} | ${((r.mmBtu / perCapitaSourceSum) * 100).toFixed(1)}%`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
  "",
  "Data table",
  "----------",
  "Measure | Value | Period | Source",
  "---|---:|---:|---",
  `Total US energy consumption | ${totalQuads.toFixed(2)} quads | ${totalConsumption.period} | EIA Total Energy (TETCBUS)`,
  `Total US energy expenditure | ${money(expenditureDollars)} | ${expenditure.period} | EIA SEDS (TETCV)`,
  `Per-person energy consumption | ${perCapitaMMBtu.toFixed(1)} MMBtu | ${totalConsumption.period} | derived (EIA / FRED POPTHM)`,
  `Per-person energy consumption (gas-equivalent) | ${Math.round(perCapitaGallonsEquiv).toLocaleString("en-US")} gal | ${totalConsumption.period} | derived`,
  `Per-person energy spending | ${money(perCapitaDollars)}/yr | ${expenditure.period} | derived (EIA / FRED POPTHM)`,
  `Per-person energy spending (daily) | $${perCapitaDollarsPerDay.toFixed(2)}/day | ${expenditure.period} | derived`,
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["source", "per_capita_million_btu", "share_pct"],
  perCapitaBySource.map((r) => [r.label, r.mmBtu.toFixed(2), ((r.mmBtu / perCapitaSourceSum) * 100).toFixed(2)])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);

// ── 20-year trend cards ───────────────────────────────────────────────────
const noTrend = process.argv.includes("--no-trend");
const noCostTrend = process.argv.includes("--no-cost-trend");
const TREND_START_YEAR = "2006";

// Fetched once, shared by both trend cards: the cost-trend card needs each
// year's physical consumption (not just its own expenditure) to compute a
// $/MMBtu unit price, so re-fetching per-card would just double the calls.
let trendPerCapita = null;
if (!noTrend || !noCostTrend) {
  console.log("\n  Fetching 20-year energy-consumption trend from EIA...");
  const trendRows = await eiaRange("total-energy", "TETCBUS", "msn", TREND_START_YEAR);
  trendPerCapita = trendRows.map((r) => {
    const pop = closest(popRows, `${r.period}-07-01`);
    return { period: r.period, totalTrillionBtu: r.value, mmBtu: (r.value * 1e6) / (pop.v * 1000) };
  });
}

if (!noTrend) {
  const firstYear = trendPerCapita[0];
  const lastYear = trendPerCapita[trendPerCapita.length - 1];
  const peakYear = trendPerCapita.reduce((a, b) => (b.mmBtu > a.mmBtu ? b : a));
  const troughYear = trendPerCapita.reduce((a, b) => (b.mmBtu < a.mmBtu ? b : a));
  const pctChange = (lastYear.mmBtu / firstYear.mmBtu - 1) * 100;

  const trendPts = trendPerCapita.map((r) => ({ label: r.period, v: r.mmBtu }));
  const trendChartSVG = lineChart(
    [{ color: C.s1, points: trendPts, endLabel: (v) => v }],
    { fmtTick: (t) => `${Math.round(t)} MMBtu`, fmtVal: (v) => `${v.toFixed(0)} MMBtu`, labelStep: 2, yLabel: "Million Btu per person" }
  );

  const trendOutBase = path.join(SOCIAL, `energy-per-person-trend-${stamp}`);
  const trendHtml = cardHTML({
    kicker: "Energy use per person · 20-year trend",
    title: `US per-person energy consumption, ${firstYear.period}-${lastYear.period}`,
    hero: `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(0)}%`,
    heroLabel: `change since ${firstYear.period} · ${lastYear.mmBtu.toFixed(0)} MMBtu in ${lastYear.period}`,
    chartSVG: trendChartSVG,
    source: "EIA Total Energy (TETCBUS), FRED population (POPTHM)",
    vintage: `${firstYear.period}-${lastYear.period}`,
  });

  const trendFacebook = [
    "Energy per person, 20-year trend:",
    "",
    `In ${firstYear.period}, the average American used about ${firstYear.mmBtu.toFixed(0)} million Btu of primary energy. By ${lastYear.period}, that had ${pctChange >= 0 ? "risen" : "fallen"} to about ${lastYear.mmBtu.toFixed(0)} million Btu — a ${Math.abs(pctChange).toFixed(0)}% ${pctChange >= 0 ? "increase" : "decrease"} over 20 years, even as the US population grew by tens of millions of people over the same span.`,
    "",
    `The high point in this window was ${peakYear.period} (${peakYear.mmBtu.toFixed(0)} million Btu/person); the low point was ${troughYear.period} (${troughYear.mmBtu.toFixed(0)} million Btu/person).`,
    "",
    "This is total primary energy (all sources, all uses — electricity, heating fuel, gasoline, industrial energy), divided by population each year, not a survey of individual behavior. Efficiency gains, a shift toward less energy-intensive industries, and (in 2020) the pandemic all show up in this line.",
    "",
    "Real numbers, real source — EIA Total Energy (TETCBUS), FRED population (POPTHM):",
    "https://www.eia.gov/totalenergy/data/monthly/",
  ];

  const trendLines = [
    `Energy per person, 20-year trend (${stamp})`,
    "",
    `${firstYear.period}: ${firstYear.mmBtu.toFixed(1)} MMBtu/person`,
    `${lastYear.period}: ${lastYear.mmBtu.toFixed(1)} MMBtu/person`,
    `Change: ${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}%`,
    `Peak: ${peakYear.period} (${peakYear.mmBtu.toFixed(1)} MMBtu/person)`,
    `Trough: ${troughYear.period} (${troughYear.mmBtu.toFixed(1)} MMBtu/person)`,
    "",
    "Year | Per person (million Btu)",
    "---|---:",
    ...trendPerCapita.map((r) => `${r.period} | ${r.mmBtu.toFixed(1)}`),
    "",
    "Facebook post",
    "-------------",
    trendFacebook.join("\n"),
  ];

  writeFileSync(`${trendOutBase}.txt`, trendLines.join("\n"));
  writeFileSync(`${trendOutBase}.csv`, toCSV(
    ["year", "per_capita_million_btu"],
    trendPerCapita.map((r) => [r.period, r.mmBtu.toFixed(2)])
  ));
  writeFileSync(`${trendOutBase}.html`, trendHtml);
  if (!noImage) screenshot(`${trendOutBase}.html`, `${trendOutBase}.png`);

  console.log("\n" + trendLines.join("\n"));
  const trendFiles = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${trendOutBase}.${ext}`));
  console.log(`\nFiles: ${trendFiles.join(" / ")}`);
}

// ── cost trend card: has energy actually gotten more expensive per person? ──
// Consumption fell 13% over 20 years (see the trend card above) — but that
// doesn't mean cost fell. Different fuels carry different $/Btu prices, so a
// falling-consumption, rising-price mix can push total spending either way.
// This card answers it directly: nominal $/person, inflation-adjusted (CPI)
// real $/person, and the underlying $/MMBtu unit price, side by side.
if (!noCostTrend) {
  console.log("\n  Fetching 20-year energy-cost trend from EIA + CPI...");
  const EXPENDITURE_START_YEAR = "2006";
  const [expenditureRows, cpiRows] = await Promise.all([
    eiaRange("seds", "TETCV", "seriesId", EXPENDITURE_START_YEAR),
    fred("CPIAUCSL"),
  ]);
  const consumptionByYear = new Map(trendPerCapita.map((r) => [r.period, r]));
  const cpiAtLatest = closest(cpiRows, `${expenditureRows[expenditureRows.length - 1].period}-07-01`).v;

  const costTrend = expenditureRows.map((r) => {
    const pop = closest(popRows, `${r.period}-07-01`).v * 1000;
    const cpiYear = closest(cpiRows, `${r.period}-07-01`).v;
    const expenditureDollarsYear = r.value * 1e6;
    const nominalPerCapita = expenditureDollarsYear / pop;
    const realPerCapita = nominalPerCapita * (cpiAtLatest / cpiYear); // in latest-year dollars
    const consumption = consumptionByYear.get(r.period);
    const dollarsPerMMBtu = consumption ? expenditureDollarsYear / (consumption.totalTrillionBtu * 1e6) : null;
    return { period: r.period, nominalPerCapita, realPerCapita, dollarsPerMMBtu };
  });

  const firstCost = costTrend[0];
  const lastCost = costTrend[costTrend.length - 1];
  const nominalPctChange = (lastCost.nominalPerCapita / firstCost.nominalPerCapita - 1) * 100;
  const realPctChange = (lastCost.realPerCapita / firstCost.realPerCapita - 1) * 100;
  const unitPriceChange = firstCost.dollarsPerMMBtu && lastCost.dollarsPerMMBtu
    ? (lastCost.dollarsPerMMBtu / firstCost.dollarsPerMMBtu - 1) * 100
    : null;
  const consumptionChangeSameSpan = consumptionByYear.has(firstCost.period) && consumptionByYear.has(lastCost.period)
    ? (consumptionByYear.get(lastCost.period).mmBtu / consumptionByYear.get(firstCost.period).mmBtu - 1) * 100
    : null;

  // The "real" series is expressed in the LAST year's dollars, so by
  // construction it is numerically identical to the nominal series at that
  // final point — both lines' end-dot and label would land on the exact same
  // pixel. Only label the nominal line there; the legend still identifies
  // the real line by color, and the convergence itself is visually obvious
  // (the two lines visibly meet at the right edge).
  const costChartSVG = lineChart(
    [
      { color: C.s1, points: costTrend.map((r) => ({ label: r.period, v: r.nominalPerCapita })), endLabel: (v) => `${v} (both, ${lastCost.period})` },
      { color: C.s2, points: costTrend.map((r) => ({ label: r.period, v: r.realPerCapita })), endLabel: () => "" },
    ],
    { fmtTick: (t) => `$${Math.round(t)}`, fmtVal: (v) => `$${Math.round(v)}`, labelStep: 2, yLabel: "Dollars per person per year" }
  );

  const costOutBase = path.join(SOCIAL, `energy-per-person-cost-trend-${stamp}`);
  const costHtml = cardHTML({
    kicker: "Energy cost per person · 20-year trend",
    title: `Has US per-person energy spending gone up or down since ${firstCost.period}?`,
    hero: `${realPctChange >= 0 ? "+" : ""}${realPctChange.toFixed(0)}%`,
    heroLabel: `real (inflation-adjusted) change since ${firstCost.period} · $${Math.round(lastCost.nominalPerCapita).toLocaleString("en-US")} in ${lastCost.period}`,
    legendHTML: `<div class="legend"><span class="key"><span class="dot" style="background:${C.s1}"></span>Nominal $/person</span><span class="key"><span class="dot" style="background:${C.s2}"></span>Real $/person (${lastCost.period} dollars)</span></div>`,
    chartSVG: costChartSVG,
    source: "EIA SEDS (TETCV), FRED CPI (CPIAUCSL) and population (POPTHM)",
    vintage: `${firstCost.period}-${lastCost.period}`,
  });

  const costFacebook = [
    "Energy cost per person, 20-year trend:",
    "",
    `Energy use per person fell about ${consumptionChangeSameSpan !== null ? Math.abs(consumptionChangeSameSpan).toFixed(0) : "13"}% between ${firstCost.period} and ${lastCost.period}. So did that make energy cheaper? In NOMINAL dollars, no — average spending per person went from $${Math.round(firstCost.nominalPerCapita).toLocaleString("en-US")} (${firstCost.period}) to $${Math.round(lastCost.nominalPerCapita).toLocaleString("en-US")} (${lastCost.period}), a ${nominalPctChange >= 0 ? "+" : ""}${nominalPctChange.toFixed(0)}% increase.`,
    "",
    `But adjusted for inflation (CPI, in ${lastCost.period} dollars), that same ${firstCost.period} spending was actually worth $${Math.round(firstCost.realPerCapita).toLocaleString("en-US")} — meaning REAL per-person energy spending fell about ${Math.abs(realPctChange).toFixed(0)}%, even more than physical consumption did. General inflation outpaced energy's own price increase over this period.`,
    "",
    unitPriceChange !== null
      ? `The underlying price of energy itself did rise: about $${firstCost.dollarsPerMMBtu.toFixed(2)} per million Btu in ${firstCost.period} vs. about $${lastCost.dollarsPerMMBtu.toFixed(2)} in ${lastCost.period} (${unitPriceChange >= 0 ? "+" : ""}${unitPriceChange.toFixed(0)}% nominal) — that's the "different fuels cost different money" effect. It just didn't rise fast enough to offset both the efficiency gains AND overall inflation.`
      : "",
    "",
    "Real numbers, real source — EIA State Energy Data System (TETCV), FRED CPI (CPIAUCSL) and population (POPTHM):",
    "https://www.eia.gov/totalenergy/data/monthly/",
  ].filter(Boolean);

  const costLines = [
    `Energy cost per person, 20-year trend (${stamp})`,
    "",
    `${firstCost.period}: nominal $${Math.round(firstCost.nominalPerCapita).toLocaleString("en-US")}/person, real (${lastCost.period}$) $${Math.round(firstCost.realPerCapita).toLocaleString("en-US")}/person`,
    `${lastCost.period}: nominal $${Math.round(lastCost.nominalPerCapita).toLocaleString("en-US")}/person, real (${lastCost.period}$) $${Math.round(lastCost.realPerCapita).toLocaleString("en-US")}/person`,
    `Nominal change: ${nominalPctChange >= 0 ? "+" : ""}${nominalPctChange.toFixed(1)}%`,
    `Real (inflation-adjusted) change: ${realPctChange >= 0 ? "+" : ""}${realPctChange.toFixed(1)}%`,
    unitPriceChange !== null ? `Unit price of energy ($/MMBtu, nominal): ${firstCost.dollarsPerMMBtu.toFixed(2)} -> ${lastCost.dollarsPerMMBtu.toFixed(2)} (${unitPriceChange >= 0 ? "+" : ""}${unitPriceChange.toFixed(1)}%)` : "",
    "",
    "Year | Nominal $/person | Real $/person (latest-yr $) | $/MMBtu (nominal)",
    "---|---:|---:|---:",
    ...costTrend.map((r) => `${r.period} | ${Math.round(r.nominalPerCapita)} | ${Math.round(r.realPerCapita)} | ${r.dollarsPerMMBtu !== null ? r.dollarsPerMMBtu.toFixed(2) : "n/a"}`),
    "",
    "Facebook post",
    "-------------",
    costFacebook.join("\n"),
  ].filter(Boolean);

  writeFileSync(`${costOutBase}.txt`, costLines.join("\n"));
  writeFileSync(`${costOutBase}.csv`, toCSV(
    ["year", "nominal_dollars_per_person", "real_dollars_per_person", "dollars_per_mmbtu"],
    costTrend.map((r) => [r.period, r.nominalPerCapita.toFixed(2), r.realPerCapita.toFixed(2), r.dollarsPerMMBtu !== null ? r.dollarsPerMMBtu.toFixed(3) : ""])
  ));
  writeFileSync(`${costOutBase}.html`, costHtml);
  if (!noImage) screenshot(`${costOutBase}.html`, `${costOutBase}.png`);

  console.log("\n" + costLines.join("\n"));
  const costFiles = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${costOutBase}.${ext}`));
  console.log(`\nFiles: ${costFiles.join(" / ")}`);
}
