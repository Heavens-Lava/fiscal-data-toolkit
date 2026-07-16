#!/usr/bin/env node
// electricity-price-watch.mjs - residential electricity price by state,
// direct from EIA (Form EIA-861M). Needs a free EIA API key — sign up at
// https://www.eia.gov/opendata/register.php (key emailed instantly) and set
// EIA_API_KEY in .env.
//
// Run:  node scripts/electricity-price-watch.mjs
//       node scripts/electricity-price-watch.mjs --sector COM   (COM=commercial, IND=industrial, RES=residential)
//       node scripts/electricity-price-watch.mjs --no-image

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

// EIA's retail-sales dataset mixes real states in with Census-region and
// national aggregates in the same "stateid" field — filter to the 50 states + DC.
const NON_STATE_CODES = new Set(["US", "PACN", "PACC", "NEW", "MAT", "ENC", "WNC", "SAT", "ESC", "WSC", "MTN"]);
const SECTORS = { RES: "residential", COM: "commercial", IND: "industrial", ALL: "all sectors" };

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

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

const key = getKey();
if (!key) {
  console.error("Missing EIA_API_KEY. Get a free key (emailed instantly) at https://www.eia.gov/opendata/register.php and set EIA_API_KEY in .env.");
  process.exit(1);
}

const sector = (argValue("--sector", "RES") || "RES").toUpperCase();
if (!SECTORS[sector]) {
  console.error(`Unknown --sector "${sector}". Options: ${Object.keys(SECTORS).join(", ")}`);
  process.exit(1);
}
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `electricity-price-watch-${sector.toLowerCase()}-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

// Find the latest month with data by asking for the most recent single period.
const latestQs = new URLSearchParams({
  api_key: key, frequency: "monthly", "data[0]": "price",
  "facets[sectorid][]": sector, "facets[stateid][]": "US",
  "sort[0][column]": "period", "sort[0][direction]": "desc", length: "1",
});
const latestRes = await fetch(`https://api.eia.gov/v2/electricity/retail-sales/data/?${latestQs}`);
if (!latestRes.ok) throw new Error(`EIA API HTTP ${latestRes.status}: ${(await latestRes.text()).slice(0, 300)}`);
const latestJson = await latestRes.json();
const period = latestJson.response?.data?.[0]?.period;
if (!period) throw new Error("Could not determine the latest EIA reporting period");

const qs = new URLSearchParams({
  api_key: key, frequency: "monthly", "data[0]": "price",
  "facets[sectorid][]": sector, start: period, end: period,
  "sort[0][column]": "price", "sort[0][direction]": "desc", length: "5000",
});
const res = await fetch(`https://api.eia.gov/v2/electricity/retail-sales/data/?${qs}`);
if (!res.ok) throw new Error(`EIA API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
const json = await res.json();

const rows = (json.response?.data || [])
  .filter((d) => !NON_STATE_CODES.has(d.stateid) && Number.isFinite(Number(d.price)))
  .map((d) => ({ state: d.stateDescription, abbr: d.stateid, price: Number(d.price) }))
  .sort((a, b) => b.price - a.price);

if (!rows.length) throw new Error(`No state-level EIA data for period ${period}, sector ${sector}`);

const highest = rows.slice(0, 5);
const lowest = rows.slice(-5).reverse();
const avg = rows.reduce((s, r) => s + r.price, 0) / rows.length;

const chartRows = [...highest, ...lowest.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r, i) => ({ label: `${r.state} (${r.abbr})`, v: r.price, color: i < 5 ? C.neg : C.s2 })),
  { fmtTick: (v) => `${v.toFixed(0)}¢`, fmtVal: (v) => `${v.toFixed(1)}¢/kWh` }
);

const html = cardHTML({
  kicker: "Electricity price check",
  title: `Highest and lowest ${SECTORS[sector]} electricity prices by state`,
  hero: `${highest[0].price.toFixed(1)}¢`,
  heroLabel: `${highest[0].state} · per kWh · ${period}`,
  chartSVG,
  source: "EIA (Form EIA-861M)",
  vintage: period,
});

const facebook = [
  "Electricity price check:",
  "",
  `Highest ${SECTORS[sector]} electricity price in the country (${period}): ${highest[0].state} at ${highest[0].price.toFixed(1)} cents/kWh — ${(highest[0].price / lowest[0].price).toFixed(1)}x the lowest, ${lowest[0].state} at ${lowest[0].price.toFixed(1)} cents/kWh.`,
  "",
  `Top 5 highest: ${highest.map((r) => `${r.state} ${r.price.toFixed(1)}¢`).join(", ")}.`,
  `Top 5 lowest: ${lowest.map((r) => `${r.state} ${r.price.toFixed(1)}¢`).join(", ")}.`,
  "",
  `Simple average across all 50 states + DC: ${avg.toFixed(1)} cents/kWh. (Unweighted average of state prices, not a consumption-weighted national average.)`,
  "",
  "Real numbers, real source — US Energy Information Administration:",
  "https://www.eia.gov/electricity/",
];

const lines = [
  `Electricity price check (${stamp})`,
  "",
  `Sector: ${SECTORS[sector]} | Period: ${period}`,
  "",
  "Rank | State | Price (cents/kWh)",
  "---:|---|---:",
  ...rows.map((r, i) => `${i + 1} | ${r.state} (${r.abbr}) | ${r.price.toFixed(2)}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "abbr", "price_cents_per_kwh"], rows.map((r, i) => [i + 1, r.state, r.abbr, r.price])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
