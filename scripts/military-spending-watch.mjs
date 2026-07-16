#!/usr/bin/env node
// military-spending-watch.mjs - what war actually costs, in the numbers that
// are actually verifiable: military spending as a share of GDP. Casualty and
// territory claims from an active conflict are contested and hard to source
// independently; military-budget data reported to the World Bank (sourced
// from SIPRI) is not. Default view: Ukraine vs. Russia since 2010, showing
// the 2014 Crimea/Donbas uptick and the much larger 2022 full-scale-invasion
// spike. Also reports US context (global rank, "next N countries combined").
// No API key required.
//
// Run:  node scripts/military-spending-watch.mjs
//       node scripts/military-spending-watch.mjs --countries UKR,RUS --years 15
//       node scripts/military-spending-watch.mjs --countries USA,CHN --years 20
//       node scripts/military-spending-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, legend, lineChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const WB = "https://api.worldbank.org/v2";
const PCT_GDP = "MS.MIL.XPND.GD.ZS";
const USD = "MS.MIL.XPND.CD";

const COUNTRY_NAMES = {
  USA: "United States", UKR: "Ukraine", RUS: "Russia", CHN: "China",
  IND: "India", GBR: "United Kingdom", DEU: "Germany", FRA: "France",
  SAU: "Saudi Arabia", JPN: "Japan", KOR: "South Korea", ISR: "Israel",
};

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
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
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function name(iso3) {
  return COUNTRY_NAMES[iso3] || iso3;
}

async function worldBank(indicator, countries, dateRange) {
  // per_page must comfortably exceed countries × years or the API silently
  // truncates to page 1 with no error — the multi-year "all countries" query
  // below returns 200+ countries x several years and needs real headroom.
  const url = `${WB}/country/${countries.join(";")}/indicator/${indicator}?format=json&per_page=2000&date=${dateRange}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`World Bank HTTP ${res.status} for ${indicator}`);
    const json = await res.json();
    if (!Array.isArray(json) || !Array.isArray(json[1])) return [];
    return json[1];
  } finally {
    clearTimeout(timer);
  }
}

function seriesFor(rows, iso3) {
  return rows
    .filter((r) => r.countryiso3code === iso3 && r.value != null)
    .map((r) => ({ year: Number(r.date), value: Number(r.value) }))
    .sort((a, b) => a.year - b.year);
}

function latestByCountry(rows) {
  const best = new Map();
  for (const r of rows) {
    if (r.value == null) continue;
    const cur = best.get(r.countryiso3code);
    if (!cur || Number(r.date) > cur.year) best.set(r.countryiso3code, { code: r.countryiso3code, name: r.country?.value || r.countryiso3code, year: Number(r.date), value: Number(r.value) });
  }
  return [...best.values()];
}

const countryArg = argValue("--countries", "UKR,RUS");
const countries = countryArg.split(",").map((s) => s.trim().toUpperCase());
const years = Number(argValue("--years", "15"));
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `military-spending-watch-${stamp}`);
const currentYear = new Date().getUTCFullYear();
const startYear = currentYear - years;

mkdirSync(SOCIAL, { recursive: true });

console.log(`  Fetching World Bank military expenditure data for ${countries.join(", ")}...`);
const [pctRows, countryList, usdAllRows] = await Promise.all([
  worldBank(PCT_GDP, countries, `${startYear}:${currentYear}`),
  fetch(`${WB}/country?format=json&per_page=400`).then((r) => r.json()),
  worldBank(USD, ["all"], `${currentYear - 4}:${currentYear}`),
]);

const validIso3 = new Set((countryList[1] || []).filter((c) => c.region && c.region.value !== "Aggregates").map((c) => c.id));

const series = countries.map((iso3) => ({ iso3, pts: seriesFor(pctRows, iso3) })).filter((s) => s.pts.length);
if (!series.length) throw new Error("No World Bank military-expenditure data returned for the requested countries");

// Global ranking (latest year each country has data), real countries only —
// World Bank's country=all response also returns regional/income aggregates
// ("World", "OECD members", etc.), which would silently inflate a naive
// top-N ranking if not filtered out here.
const usdLatest = latestByCountry(usdAllRows).filter((r) => validIso3.has(r.code)).sort((a, b) => b.value - a.value);
const us = usdLatest.find((r) => r.code === "USA");
let rankNote = null;
if (us) {
  // Walk the rest of the ranking accumulating a running sum; stop at the
  // first N whose combined total reaches the US figure. That N is the
  // break-even point, NOT the count the US exceeds — the US exceeds the
  // PRIOR count (N-1), so track both and report the exceeded one.
  let sum = 0, n = 0, prevSum = 0, prevN = 0;
  for (const r of usdLatest) {
    if (r.code === "USA") continue;
    prevSum = sum;
    prevN = n;
    sum += r.value;
    n++;
    if (sum >= us.value) break;
  }
  rankNote = { rank: usdLatest.findIndex((r) => r.code === "USA") + 1, exceedsN: prevN, exceedsNSum: prevSum, year: us.year };
}

const colors = [C.s1, C.s2, C.neg];
const chartSeries = series.map((s, i) => ({
  color: colors[i % colors.length],
  points: s.pts.map((p) => ({ label: String(p.year), v: p.value })),
  endLabel: (v) => v,
}));
const chartSVG = lineChart(chartSeries, { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => `${v.toFixed(1)}%`, labelStep: 2, yLabel: "Military spending (% of GDP)" });
const legendHTML = legend(series.map((s, i) => ({ name: name(s.iso3), color: colors[i % colors.length] })));

const lead = series[0];
const leadLatest = lead.pts[lead.pts.length - 1];
const leadFirst = lead.pts[0];
const leadPeak = lead.pts.reduce((a, b) => (b.value > a.value ? b : a));

const html = cardHTML({
  kicker: "Military spending check",
  title: `Military spending, % of GDP (${leadFirst.year}-${leadLatest.year})`,
  hero: `${leadLatest.value.toFixed(1)}%`,
  heroLabel: `${name(lead.iso3)} · ${leadLatest.year}, share of GDP`,
  chartSVG,
  legendHTML,
  source: "World Bank (SIPRI military expenditure data)",
  vintage: `${leadLatest.year}`,
});

const facebook = [
  "How much of a country's economy can war consume?",
  "",
  `${name(lead.iso3)} spent ${leadLatest.value.toFixed(1)}% of its entire GDP on its military in ${leadLatest.year}${series.length > 1 ? `, vs. ${series[1].pts[series[1].pts.length - 1].value.toFixed(1)}% for ${name(series[1].iso3)}` : ""}.`,
  "",
  ...(lead.iso3 === "UKR" ? [
    `${leadFirst.year}: ${leadFirst.value.toFixed(1)}%`,
    `2022: ${lead.pts.find((p) => p.year === 2022)?.value.toFixed(1)}%`,
    `${leadPeak.year} peak: ${leadPeak.value.toFixed(1)}%`,
    `${leadLatest.year}: ${leadLatest.value.toFixed(1)}%`,
    "",
  ] : []),
  ...(rankNote ? [
    `For scale, the U.S. ranked #${rankNote.rank} in total dollars at ${money(us.value)} in ${rankNote.year}, exceeding the next ${rankNote.exceedsN} countries combined (${money(rankNote.exceedsNSum)}).`,
    "",
  ] : []),
  "These figures measure military spending, not casualties or territory. World Bank data are compiled from SIPRI.",
  "",
  "Which comparison should I run next: U.S. vs. China, NATO countries, or the largest spenders per person?",
  "",
  "Follow for more source-linked public-data comparisons, and share this for someone who wants the numbers behind the headlines.",
  "",
  "Source: World Bank military expenditure data:",
  "https://data.worldbank.org/indicator/MS.MIL.XPND.GD.ZS",
];

const lines = [
  `Military spending check (${stamp})`,
  "",
  ...series.map((s) => `${name(s.iso3)} latest: ${s.pts[s.pts.length - 1].value.toFixed(1)}% of GDP (${s.pts[s.pts.length - 1].year})`),
  ...(rankNote ? ["", `US global rank: #${rankNote.rank} by dollar spending (${money(us.value)}, ${rankNote.year}) — exceeds the next ${rankNote.exceedsN} countries combined (${money(rankNote.exceedsNSum)})`] : []),
  "",
  ...series.flatMap((s) => [
    `${name(s.iso3)} — Year | % of GDP`,
    "---:|---:",
    ...s.pts.map((p) => `${p.year} | ${p.value.toFixed(1)}%`),
    "",
  ]),
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["country", "year", "pct_gdp"],
  series.flatMap((s) => s.pts.map((p) => [name(s.iso3), p.year, p.value]))
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
