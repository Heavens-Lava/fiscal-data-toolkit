#!/usr/bin/env node
// state-exports-watch.mjs — which states export the most goods internationally?
// Census Bureau international trade timeseries API (state x NAICS commodity
// exports), same CENSUS_API_KEY as the rest of this toolkit. Sums 2-digit
// NAICS goods-sector export values (world total, all countries) per state
// for the latest available month.
//
// Run:
//   node scripts/state-exports-watch.mjs
//   node scripts/state-exports-watch.mjs --month 2025-12
//   node scripts/state-exports-watch.mjs --no-image

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, engagementCTA, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { STATES } from "./lib/data-common.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function getCensusKey() {
  if (process.env.CENSUS_API_KEY) return process.env.CENSUS_API_KEY;
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^CENSUS_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}
function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function fmtM(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  return `$${(n / 1e6).toFixed(0)}M`;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const key = getCensusKey();
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();

async function stateExports(stateAbbr, month) {
  // get= with a single column silently returns 204 on this endpoint — asking
  // for a second column (NAICS, unused here) works around it.
  const qs = new URLSearchParams({
    get: "ALL_VAL_MO,NAICS", STATE: stateAbbr, COMM_LVL: "NA2", CTY_CODE: "-", time: month, key,
  });
  const res = await fetch(`https://api.census.gov/data/timeseries/intltrade/exports/statenaics?${qs}`);
  if (res.status === 204) return 0;
  const text = await res.text();
  if (!res.ok) throw new Error(`Census intltrade HTTP ${res.status} for ${stateAbbr}: ${text.slice(0, 200)}`);
  const rows = JSON.parse(text).slice(1);
  return rows.reduce((sum, row) => sum + Number(row[0] || 0), 0);
}

async function mapBatched(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
    if (i + size < items.length) await sleep(200);
  }
  return out;
}

async function latestMonth() {
  const override = argValue("--month");
  if (override) return override;
  const d = new Date();
  for (let back = 1; back < 12; back++) {
    const probe = new Date(d.getFullYear(), d.getMonth() - back, 1);
    const label = `${probe.getFullYear()}-${String(probe.getMonth() + 1).padStart(2, "0")}`;
    const total = await stateExports("CA", label); // California always has data when a month is published
    if (total > 0) return label;
  }
  throw new Error("No recent state export data found.");
}

const month = await latestMonth();
console.log(`Fetching goods export totals by state for ${month} (${STATES.length} queries)...`);
const totals = await mapBatched(STATES, 4, (s) => stateExports(s.abbr, month));
const rows = STATES.map((s, i) => ({ ...s, exports: totals[i] })).filter((r) => r.exports > 0);
rows.sort((a, b) => b.exports - a.exports);

const nationalTotal = rows.reduce((s, r) => s + r.exports, 0);
const top10 = rows.slice(0, 10);
const leader = rows[0];
const outBase = path.join(SOCIAL, `state-exports-watch-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

const chartSVG = horizontalBarChart(
  top10.map((r) => ({ label: r.name, v: r.exports / 1e9, color: C.s1 })),
  { fmtTick: (v) => `$${v.toFixed(0)}B`, fmtVal: (v) => `$${v.toFixed(1)}B` }
);

const runnerUp = top10[1];
const secondThird = top10[1] && top10[2] ? top10[1].exports + top10[2].exports : null;
const leadMultiple = runnerUp ? leader.exports / runnerUp.exports : null;
const html = cardHTML({
  kicker: "State exports",
  title: secondThird && leader.exports >= secondThird
    ? `${leader.name} exports more than the next two states combined`
    : leadMultiple
      ? `${leader.name} is America's top exporter, ${leadMultiple.toFixed(1)}x the runner-up`
      : `Which states export the most goods internationally? ${month}`,
  hero: fmtM(leader.exports),
  heroLabel: `${leader.name} — goods exports in ${month}`,
  chartSVG,
  source: "U.S. Census Bureau international trade statistics",
  vintage: month,
});

const facebook = [
  leadMultiple
    ? `${leader.name} exported ${fmtM(leader.exports)} in goods in ${month} alone — ${leadMultiple.toFixed(1)}x more than #2 (${runnerUp.name}, ${fmtM(runnerUp.exports)}). Here's the full ranking:`
    : `Which U.S. states export the most goods internationally? Total export value by state, ${month}:`,
  "",
  ...top10.map((r, i) => `${i + 1}. ${r.name}: ${fmtM(r.exports)}`),
  "",
  `All 50 states + DC combined: ${fmtM(nationalTotal)} in goods exports for the month.`,
  "",
  "This covers physical goods exports only (manufactured products, agriculture, minerals, etc.) attributed to the state where the export shipment originated — not services exports (software, consulting, financial services), which the Census Bureau tracks separately and doesn't break out by state the same way.",
  "",
  engagementCTA("ranking", "state-exports-watch"),
  "",
  "Source website: https://www.census.gov/foreign-trade/statistics/state/",
  "Information retrieved programmatically via API.",
  "Graph made by Jeffrey Macy.",
];

const lines = [
  `State exports watch (${stamp}) — goods exports, ${month}`, "",
  "Rank | State | Exports",
  "---:|---|---:",
  ...rows.map((r, i) => `${i + 1} | ${r.name} | ${fmtM(r.exports)}`),
  "", `All states + DC | ${fmtM(nationalTotal)}`,
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: U.S. Census Bureau international trade timeseries API (exports/statenaics, 2-digit NAICS goods sectors summed, world total).",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "state", "exports_usd", "month"],
  rows.map((r, i) => [i + 1, r.name, r.exports, month])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
