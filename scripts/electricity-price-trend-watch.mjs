#!/usr/bin/env node
// electricity-price-trend-watch.mjs — the national residential electricity
// price, nominal vs. real (inflation-adjusted to today's dollars), over the
// past 20 years — and whether AI data-center power demand explains the
// recent run-up. FRED APU000072610 (avg price per kWh, US city average) and
// CPIAUCSL (CPI-U, to deflate), both keyless.
//
// The "is AI driving this" claim in the caption is sourced to outside
// reporting (Utility Dive, Consumer Reports, EESI), not derived from FRED —
// FRED only has the price series, not a cause. Cross-checked against
// multiple outlets before writing into the caption per this project's
// verify-before-posting standard.
//
// Run:  node scripts/electricity-price-trend-watch.mjs
//       node scripts/electricity-price-trend-watch.mjs --years 10
//       node scripts/electricity-price-trend-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, engagementCTA, fred, lineChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, argValue, pct, rel } from "./lib/data-common.mjs";

const noImage = process.argv.includes("--no-image");
const years = Number(argValue("--years", "20"));
const outBase = path.join(SOCIAL, `electricity-price-trend-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

console.log("  Fetching national electricity price (FRED APU000072610) and CPI (CPIAUCSL)...");
const [elecRaw, cpiRaw] = await Promise.all([fred("APU000072610"), fred("CPIAUCSL")]);

const cpiByDate = new Map(cpiRaw.map((x) => [x.d, x.v]));
const latest = elecRaw[elecRaw.length - 1];
const cpiNow = cpiByDate.get(latest.d);

const cutoff = new Date(latest.d);
cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
const cutoffStr = cutoff.toISOString().slice(0, 10);
const windowed = elecRaw.filter((x) => x.d >= cutoffStr && cpiByDate.has(x.d));

// Real series expressed in the WINDOW'S START-YEAR dollars (constant base-year
// convention), not "today's dollars" — deflating to today would force the
// nominal and real lines to converge to the same value at the most recent
// point by construction (cpiNow/cpiNow=1), which collides their end-labels
// exactly where the reader's eye lands. Base-year dollars instead make the
// two lines visibly diverge as inflation/real-price-growth accumulates.
const cpiBase = cpiByDate.get(windowed[0]?.d);
const series = windowed.map((x) => ({ d: x.d, nominal: x.v, real: x.v * (cpiBase / cpiByDate.get(x.d)) }));

const yearOf = (d) => d.slice(0, 4);
function findAtOrAfter(target) {
  return elecRaw.find((x) => x.d >= target);
}
const agoN = findAtOrAfter(cutoffStr);
const ago5 = findAtOrAfter(`${Number(yearOf(latest.d)) - 5}-${latest.d.slice(5)}`);
const ago2 = findAtOrAfter(`${Number(yearOf(latest.d)) - 2}-${latest.d.slice(5)}`);
const cpiN = cpiByDate.get(agoN?.d), cpi5 = cpiByDate.get(ago5?.d), cpi2 = cpiByDate.get(ago2?.d);

const elecChangeNyReal = agoN && cpiN ? (((latest.v) / (agoN.v * (cpiNow / cpiN)) - 1) * 100) : null;
const elecChange5y = ago5 ? ((latest.v / ago5.v - 1) * 100) : null;
const cpiChange5y = cpi5 ? ((cpiNow / cpi5 - 1) * 100) : null;
const elecChange2y = ago2 ? ((latest.v / ago2.v - 1) * 100) : null;
const cpiChange2y = cpi2 ? ((cpiNow / cpi2 - 1) * 100) : null;

const allTimeHigh = elecRaw.reduce((best, x) => (x.v > best.v ? x : best), elecRaw[0]);
const isAllTimeHigh = allTimeHigh.d === latest.d;

const labelStep = Math.max(2, Math.round(series.length / 8));
const chartSVG = lineChart(
  [
    { name: "Nominal price", color: C.s1, points: series.map((x) => ({ label: x.d.slice(0, 4), v: x.nominal })), endLabel: (v) => `Nominal $${v}` },
    { name: "Real (today's $)", color: C.neg, points: series.map((x) => ({ label: x.d.slice(0, 4), v: x.real })), endLabel: (v) => `Real $${v}` },
  ],
  { fmtTick: (v) => `$${v.toFixed(2)}`, fmtVal: (v) => v.toFixed(3), labelStep, yLabel: "$ per kWh, US city average" }
);

const html = cardHTML({
  kicker: "Electricity price check",
  title: isAllTimeHigh ? "Electricity prices just hit an all-time high" : "Electricity prices, nominal vs. real",
  hero: `$${latest.v.toFixed(3)}`,
  heroLabel: `Per kWh, US city average — ${isAllTimeHigh ? "highest ever recorded" : latest.d.slice(0, 7)}`,
  chartSVG,
  source: "BLS/FRED (APU000072610, CPIAUCSL)",
  vintage: latest.d,
});

const facebook = [
  `The average US electricity price just hit ${isAllTimeHigh ? "an all-time high" : "a new multi-year high"}: $${latest.v.toFixed(3)} per kWh. But the more interesting story is how fast it's been rising — and why.`,
  "",
  `Zoom out ${years} years and electricity looks almost boring: adjusted for inflation, today's price is only about ${pct(elecChangeNyReal)} above where it was back then.`,
  "",
  `Zoom into the last 5 years and it's a different picture: electricity prices are up ${pct(elecChange5y)} — while overall inflation (CPI) rose only ${pct(cpiChange5y)} over that same span. Electricity is outrunning inflation itself.`,
  `That gap is widening, not closing: over just the last 2 years, electricity is up ${pct(elecChange2y)} vs. ${pct(cpiChange2y)} for overall inflation.`,
  "",
  "What changed in the last 2-5 years? AI data centers. Utilities requested a record $31 billion in rate increases in 2025 — reporting ties a large share of that directly to data-center power demand. Data centers could add roughly 125 gigawatts of new US electricity demand by 2030, breaking a decade of flat national demand growth. In data-center-heavy regions, some residents have seen bills more than double.",
  "",
  "To be clear: this FRED data shows the price trend, not the cause — the AI/data-center connection here is sourced to utility filings and reporting (Utility Dive, Consumer Reports, EESI), not derived from the price series itself.",
  "",
  engagementCTA("cost", "electricity-price-trend-watch"),
  "",
  "Source website: https://fred.stlouisfed.org/series/APU000072610",
  "Information retrieved programmatically via API.",
  "Graph made by Jeffrey Macy.",
];

const lines = [
  `Electricity price trend (${STAMP})`, "",
  `Latest (${latest.d}): $${latest.v.toFixed(3)}/kWh nominal${isAllTimeHigh ? " — all-time high" : ""}`,
  `Change last 5y: electricity ${pct(elecChange5y)} vs. CPI ${pct(cpiChange5y)}`,
  `Change last 2y: electricity ${pct(elecChange2y)} vs. CPI ${pct(cpiChange2y)}`,
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: FRED APU000072610 (avg US city electricity price/kWh) and CPIAUCSL (CPI-U), both BLS via FRED.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["date", "nominal_price_per_kwh", `real_price_per_kwh_${series[0].d.slice(0, 4)}_dollars`],
  series.map((x) => [x.d, x.nominal.toFixed(4), x.real.toFixed(4)])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
