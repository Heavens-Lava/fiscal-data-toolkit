#!/usr/bin/env node
// Arizona agriculture output from USDA NASS QuickStats. Requires USDA_NASS_API_KEY.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const COMMODITIES = ["CATTLE", "LETTUCE", "COTTON", "HAY", "MILK", "WHEAT", "CORN", "SORGHUM", "PECANS", "WATERMELONS"];

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function key() {
  if (process.env.USDA_NASS_API_KEY) return process.env.USDA_NASS_API_KEY;
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^USDA_NASS_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function parseVal(v) {
  const n = Number(String(v || "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function fmt(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return Math.round(n).toLocaleString("en-US");
}

async function quickStats(params) {
  const qs = new URLSearchParams({ key: key(), format: "JSON", ...params });
  const res = await fetch(`https://quickstats.nass.usda.gov/api/api_GET/?${qs}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`USDA NASS HTTP ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  return json.data || [];
}

const apiKey = key();
if (!apiKey) {
  console.error("Missing USDA_NASS_API_KEY. Get a free key at https://quickstats.nass.usda.gov/api and add USDA_NASS_API_KEY=your_key to .env.");
  process.exit(1);
}

const noImage = process.argv.includes("--no-image");
const year = argValue("--year", String(new Date().getFullYear() - 1));
const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, `usda-arizona-ag-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

const rows = [];
for (const commodity of COMMODITIES) {
  const data = await quickStats({
    state_alpha: "AZ",
    agg_level_desc: "STATE",
    freq_desc: "ANNUAL",
    commodity_desc: commodity,
    statisticcat_desc: "PRODUCTION",
    year__LE: year,
  });
  const latest = data
    .map((r) => ({ ...r, value: parseVal(r.Value), year: Number(r.year) }))
    .filter((r) => r.value != null && Number.isFinite(r.year))
    .sort((a, b) => b.year - a.year)[0];
  if (latest) rows.push({
    commodity,
    short: latest.short_desc,
    year: latest.year,
    value: latest.value,
    unit: latest.unit_desc,
  });
}

rows.sort((a, b) => b.value - a.value);
if (!rows.length) throw new Error(`No Arizona agriculture production rows found through ${year}`);

const chartRows = rows.slice(0, 10);
const chartSVG = horizontalBarChart(
  chartRows.map((r, i) => ({ label: r.commodity, v: r.value, color: i === 0 ? C.s2 : C.s1 })),
  { fmtTick: fmt, fmtVal: (v) => fmt(v) }
);

const html = cardHTML({
  kicker: "Arizona agriculture check",
  title: "Arizona farm output by commodity",
  hero: fmt(rows[0].value),
  heroLabel: `${rows[0].commodity}; ${rows[0].unit}; ${rows[0].year}`,
  chartSVG,
  source: "USDA NASS QuickStats",
  vintage: String(Math.max(...rows.map((r) => r.year))),
});

const lines = [
  `Arizona agriculture check (${stamp})`,
  "",
  "Commodity | Latest production | Unit | Year | Data item",
  "---|---:|---|---:|---",
  ...rows.map((r) => `${r.commodity} | ${fmt(r.value)} | ${r.unit} | ${r.year} | ${r.short}`),
  "",
  "Source: USDA NASS QuickStats. Requires USDA_NASS_API_KEY.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["commodity", "value", "unit", "year", "short_desc"],
  rows.map((r) => [r.commodity, r.value, r.unit, r.year, r.short])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`)).join(" / ")}`);
