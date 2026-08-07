#!/usr/bin/env node
// US electricity demand was essentially flat for nearly two decades — then
// turned back up. EIA total retail electricity sales, annual. This charts
// the actual, already-happened demand trend (not a speculative AI-demand
// forecast); the caption notes data centers/AI, EV adoption, and
// electrification as EIA's own commonly-cited factors for the upturn,
// without asserting an unverified AI-specific number.
//
// Run:  node scripts/electricity-demand-growth-watch.mjs
// Key:  free registration at eia.gov/opendata → store in .env as EIA_API_KEY

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, lineChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, envValue, num, rel } from "./lib/data-common.mjs";

const key = envValue("EIA_API_KEY");
if (!key) throw new Error("Missing EIA_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `electricity-demand-growth-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const qs = new URLSearchParams({
  api_key: key, frequency: "annual", "data[0]": "sales",
  "facets[stateid][]": "US", "facets[sectorid][]": "ALL",
  "sort[0][column]": "period", "sort[0][direction]": "asc", length: "40",
});
const res = await fetch(`https://api.eia.gov/v2/electricity/retail-sales/data/?${qs}`);
if (!res.ok) throw new Error(`EIA API HTTP ${res.status}`);
const json = await res.json();
const rows = (json.response?.data || [])
  .map((d) => ({ year: Number(d.period), millionKwh: Number(d.sales) }))
  .filter((r) => Number.isFinite(r.year) && Number.isFinite(r.millionKwh))
  .sort((a, b) => a.year - b.year);
if (rows.length < 10) throw new Error("Not enough EIA annual retail-sales rows.");

const latest = rows[rows.length - 1];
// Compare against the AVERAGE of the flat/plateau era (2008-2019), not a
// single low year — a single-year comparison risks landing on a
// recession- or pandemic-driven dip (2009, 2020) and overstating the
// recent run-up by conflating a demand-destruction event with genuine
// multi-year stagnation.
const plateauYears = rows.filter((r) => r.year >= 2008 && r.year <= 2019);
const plateauAvg = plateauYears.reduce((s, r) => s + r.millionKwh, 0) / plateauYears.length;
const plateauLabel = `${plateauYears[0].year}-${plateauYears[plateauYears.length - 1].year} average`;
const growthSincePlateau = ((latest.millionKwh - plateauAvg) / plateauAvg) * 100;

const pts = rows.map((r) => ({ label: String(r.year), v: r.millionKwh / 1e6 }));
const chartSVG = lineChart(
  [{ color: C.s1, points: pts, endLabel: (v) => v }],
  { fmtTick: (v) => `${v.toFixed(1)}T`, fmtVal: (v) => `${v.toFixed(2)}T kWh`, labelStep: 3, yLabel: "Retail electricity sales (trillion kWh)" }
);

const html = cardHTML({
  kicker: "Electricity demand check",
  title: "US electricity demand was flat for years — now it's climbing again",
  hero: `+${growthSincePlateau.toFixed(1)}%`,
  heroLabel: `${latest.year} sales vs. the ${plateauLabel}`,
  chartSVG, source: "U.S. Energy Information Administration, Electricity Retail Sales", vintage: String(latest.year),
});

const facebook = [
  "For over a decade, America's electricity use barely grew. That just changed.",
  "",
  `EIA data — total U.S. retail electricity sales, ${rows[0].year}-${latest.year}:`,
  "",
  `${plateauLabel}: ${(plateauAvg / 1e6).toFixed(2)} trillion kWh/year (essentially flat across those 12 years)`,
  `${latest.year}: ${(latest.millionKwh / 1e6).toFixed(2)} trillion kWh — up ${growthSincePlateau.toFixed(1)}% versus that plateau`,
  "",
  "EIA's own outlooks point to a mix of drivers behind the recent upturn: data centers and AI computing, electric vehicle charging, broader electrification of heating and industry, and new manufacturing load. This chart shows the actual sales data, not a projection of how much any single one of those factors contributes.",
  "",
  "Source: U.S. Energy Information Administration, Electricity Retail Sales (annual).",
].filter(Boolean);

const lines = [
  `Electricity demand growth watch (${STAMP})`, "", `EIA annual retail electricity sales, ${rows[0].year}-${latest.year}.`, "",
  "Year | Retail sales (trillion kWh)",
  "---:|---:",
  ...rows.map((r) => `${r.year} | ${(r.millionKwh / 1e6).toFixed(3)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["year", "retail_sales_million_kwh"], rows.map((r) => [r.year, r.millionKwh])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
