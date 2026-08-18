#!/usr/bin/env node
// cost-comparison-table.mjs — "what things cost: [year1] vs. [year2]" table
// card. Every figure comes from a live FRED series with January-of-that-year
// coverage back to 1976 — no hardcoded/recalled numbers. Deliberately keeps
// the item list to what's verifiably sourced from official data (median
// family income, federal minimum wage, gasoline, median home price) rather
// than padding it with retail-price items (new car, appliances) that don't
// have a clean government time series back this far.
//
// Run:
//   node scripts/cost-comparison-table.mjs
//   node scripts/cost-comparison-table.mjs --year1 1976 --year2 2026
//   node scripts/cost-comparison-table.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, engagementCTA, fred, screenshot, tableCard, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function money(n, digits = 0) { return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`; }

const year1 = Number(argValue("--year1", "1976"));
const year2Arg = argValue("--year2", null);
const noImage = process.argv.includes("--no-image");

// value closest to Jan 1 of the given year, falling back to the nearest
// available point (a series' actual latest print may lag "now" by months).
function valueNear(series, year) {
  const target = Date.parse(`${year}-01-01`);
  return series.reduce((best, pt) =>
    Math.abs(Date.parse(pt.d) - target) < Math.abs(Date.parse(best.d) - target) ? pt : best
  );
}

const ITEMS = [
  { label: "Median family income (annual)", seriesId: "MAFAINUSA646N", fmt: (v) => money(v) },
  { label: "Federal minimum wage (hourly)", seriesId: "FEDMINNFRWG", fmt: (v) => `${money(v, 2)}/hr` },
  { label: "Gasoline (avg. price/gallon)", seriesId: "APU000074714", fmt: (v) => money(v, 2) },
  { label: "Median home sale price", seriesId: "MSPUS", fmt: (v) => money(v) },
];

console.log(`Fetching ${ITEMS.length} FRED series...`);
const [seriesData, cpiSeries] = await Promise.all([
  Promise.all(ITEMS.map((item) => fred(item.seriesId))),
  fred("CPIAUCNS"), // headline CPI, not seasonally adjusted — the inflation benchmark for these multiples
]);

const rows = ITEMS.map((item, i) => {
  const series = seriesData[i];
  const p1 = valueNear(series, year1);
  const latest = series[series.length - 1];
  const year2 = year2Arg ? valueNear(series, Number(year2Arg)) : latest;
  return { ...item, p1, p2: year2 };
});

const actualYear2 = new Date(rows[0].p2.d).getUTCFullYear();
const changeMultiples = rows.map((r) => r.p2.v / r.p1.v);
const biggestMover = rows[changeMultiples.indexOf(Math.max(...changeMultiples))];

// Inflation benchmark: without this, a raw "8.6x since 1976" multiple is
// close to meaningless — the dollar itself is worth far less than it was in
// 1976, so every nominal multiple needs to be read against how much of it
// is just general inflation vs. an actual real-terms change.
const cpi1 = valueNear(cpiSeries, year1);
const cpi2 = valueNear(cpiSeries, actualYear2);
const inflationMultiple = cpi2.v / cpi1.v;
const realMultiples = rows.map((r, i) => changeMultiples[i] / inflationMultiple);

const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `cost-comparison-table-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

const html = tableCard({
  kicker: "Cost of living check",
  title: "What things cost",
  subtitle: `${year1} vs. ${actualYear2} — nominal and inflation-adjusted`,
  columnLabels: [String(year1), String(actualYear2), "Real change"],
  columnColors: [C.s1, C.s1, C.s2],
  rows: rows.map((r, i) => ({ label: r.label, values: [r.fmt(r.p1.v), r.fmt(r.p2.v), `${realMultiples[i].toFixed(2)}x`] })),
  footnote: `All figures: official government data (FRED / BLS / DOL), nearest available observation to January of each year. "Real change" divides out ${inflationMultiple.toFixed(1)}x general inflation (CPI) over the period — above 1.0x got more expensive in real terms, below 1.0x got cheaper.`,
  source: "FRED (Federal Reserve Economic Data)",
  vintage: String(actualYear2),
});

const biggestMoverMultiple = changeMultiples[rows.indexOf(biggestMover)];
const incomeRow = rows.find((r) => /income/i.test(r.label));
const incomeMultiple = incomeRow ? changeMultiples[rows.indexOf(incomeRow)] : null;
const incomeRealMultiple = incomeRow ? realMultiples[rows.indexOf(incomeRow)] : null;
const facebook = [
  incomeRow && biggestMover !== incomeRow
    ? `${biggestMover.label} is up ${biggestMoverMultiple.toFixed(1)}x since ${year1} — but pay only rose ${incomeMultiple.toFixed(1)}x in that time. What things actually cost, ${year1} vs. ${actualYear2}:`
    : `The biggest mover since ${year1}: ${biggestMover.label}, up ${biggestMoverMultiple.toFixed(1)}x. What things actually cost, ${year1} vs. ${actualYear2}:`,
  "",
  ...rows.map((r, i) => `${r.label}: ${r.fmt(r.p1.v)} → ${r.fmt(r.p2.v)} (${changeMultiples[i].toFixed(1)}x nominal, ${realMultiples[i].toFixed(2)}x after inflation)`),
  "",
  `For reference: general inflation (CPI) alone was ${inflationMultiple.toFixed(1)}x over this period — a dollar in ${year1} buys about what $${inflationMultiple.toFixed(2)} buys in ${actualYear2}. Anything above 1.0x "after inflation" got more expensive in real terms; anything below 1.0x actually got cheaper once inflation is accounted for.`,
  incomeRow ? `By that measure, real (inflation-adjusted) income is ${incomeRealMultiple >= 1 ? "up" : "down"} about ${(Math.abs(incomeRealMultiple - 1) * 100).toFixed(0)}% since ${year1} — a very different picture than the raw ${incomeMultiple.toFixed(1)}x nominal number suggests.` : "",
  "",
  "Every number here is pulled live from FRED (Federal Reserve Economic Data) — official BLS, DOL, and Census series, not a recalled or estimated figure.",
  "",
  engagementCTA("cost", "cost-comparison-table"),
  "",
  "Source website: https://fred.stlouisfed.org/",
  "Information retrieved programmatically via API.",
  "Graph made by Jeffrey Macy.",
].filter(Boolean);

const lines = [
  `Cost comparison table (${stamp}) — ${year1} vs. ${actualYear2}`, "",
  `Inflation (CPI) benchmark over this period: ${inflationMultiple.toFixed(2)}x`, "",
  "Item | " + year1 + " | " + actualYear2 + " | Nominal change | Real (inflation-adj.) change",
  "---|---:|---:|---:|---:",
  ...rows.map((r, i) => `${r.label} | ${r.fmt(r.p1.v)} | ${r.fmt(r.p2.v)} | ${changeMultiples[i].toFixed(2)}x | ${realMultiples[i].toFixed(2)}x`),
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: FRED (Federal Reserve Economic Data) — series MAFAINUSA646N, FEDMINNFRWG, APU000074714, MSPUS, CPIAUCNS.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["item", "fred_series", String(year1), String(actualYear2), "change_multiple"],
  rows.map((r, i) => [r.label, r.seriesId, r.p1.v, r.p2.v, changeMultiples[i].toFixed(2)])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
