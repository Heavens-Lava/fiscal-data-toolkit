#!/usr/bin/env node
// reservoir-watch.mjs — how full are the West's major Bureau of Reclamation
// reservoirs right now? Current storage (RISE API, keyless) as a share of
// each reservoir's official maximum capacity (Reclamation project data /
// USGS-cited engineering figures — a physical fact that doesn't change, so
// it's hardcoded here rather than fetched, same as arizona-water-watch.mjs
// does for its own two reservoirs).
//
// Broader than arizona-water-watch.mjs (which tracks only Lake Mead/Powell
// year-over-year): this is a snapshot across 9 major reservoirs spanning
// California, the Colorado River Basin, and New Mexico.
//
// Run:
//   node scripts/reservoir-watch.mjs
//   node scripts/reservoir-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, engagementCTA, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

// capacityAF: official maximum storage capacity in acre-feet, per Reclamation
// project engineering data (cross-checked against published figures). These
// are fixed physical facts, not time-series data RISE exposes directly.
const RESERVOIRS = [
  { name: "Lake Mead", state: "NV/AZ", locationId: 3514, capacityAF: 26134000 },
  { name: "Lake Powell", state: "UT/AZ", locationId: 393, capacityAF: 24322000 },
  { name: "Shasta Lake", state: "CA", locationId: 471, capacityAF: 4552000 },
  { name: "Flaming Gorge Reservoir", state: "WY/UT", locationId: 1535, capacityAF: 3788900 },
  { name: "Trinity Lake", state: "CA", locationId: 3203, capacityAF: 2447650 },
  { name: "Elephant Butte Reservoir", state: "NM", locationId: 323, capacityAF: 2065010 },
  { name: "Navajo Reservoir", state: "NM/CO", locationId: 423, capacityAF: 1708600 },
  { name: "Folsom Lake", state: "CA", locationId: 334, capacityAF: 976000 },
  { name: "Blue Mesa Reservoir", state: "CO", locationId: 1533, capacityAF: 940800 },
];

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function maf(af) { return `${(af / 1e6).toFixed(2)} MAF`; }

async function currentStorage(reservoir) {
  const end = new Date();
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 30);
  const qs = new URLSearchParams({
    locationId: String(reservoir.locationId),
    parameterId: "3",
    "dateTime[after]": start.toISOString().slice(0, 10),
    "dateTime[before]": end.toISOString().slice(0, 10),
  });
  const res = await fetch(`https://data.usbr.gov/rise/api/result?${qs}`, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`RISE API ${res.status} for ${reservoir.name}: ${text.slice(0, 160)}`);
  const rows = (JSON.parse(text).data || [])
    .map((x) => ({ date: x.attributes.dateTime.slice(0, 10), storage: Number(x.attributes.result) }))
    .filter((x) => Number.isFinite(x.storage))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) throw new Error(`No recent storage data for ${reservoir.name}`);
  return rows[rows.length - 1];
}

const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `reservoir-watch-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

const rows = await Promise.all(RESERVOIRS.map(async (r) => {
  const latest = await currentStorage(r);
  return { ...r, storageAF: latest.storage, date: latest.date, pctFull: (latest.storage / r.capacityAF) * 100 };
}));
rows.sort((a, b) => a.pctFull - b.pctFull);

const lowest = rows[0];
const avgPct = rows.reduce((s, r) => s + r.pctFull, 0) / rows.length;

const chartSVG = horizontalBarChart(
  rows.map((r) => ({ label: `${r.name} (${r.state})`, v: r.pctFull, color: r.pctFull < 40 ? C.neg : C.s1 })),
  { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => `${v.toFixed(0)}% full` }
);

const html = cardHTML({
  kicker: "Reservoir watch",
  title: `${lowest.name} is down to ${lowest.pctFull.toFixed(0)}% capacity`,
  hero: `${lowest.pctFull.toFixed(0)}%`,
  heroLabel: `${lowest.name} — lowest of ${rows.length} major reservoirs tracked`,
  chartSVG,
  source: "U.S. Bureau of Reclamation RISE",
  vintage: rows[rows.length - 1].date,
});

const facebook = [
  `${lowest.name} is sitting at just ${lowest.pctFull.toFixed(0)}% of capacity right now — ${maf(lowest.storageAF)} of a possible ${maf(lowest.capacityAF)}. Here's how full every major Western reservoir actually is:`,
  "",
  ...rows.map((r) => `${r.name} (${r.state}): ${r.pctFull.toFixed(0)}% full — ${maf(r.storageAF)} of ${maf(r.capacityAF)} capacity`),
  "",
  `Average across these ${rows.length} reservoirs: ${avgPct.toFixed(0)}% of capacity.`,
  "",
  "\"Capacity\" is each reservoir's official maximum storage at full pool. These are Bureau of Reclamation reservoirs across California, the Colorado River Basin, and New Mexico — not every major U.S. reservoir (some, like Lake Oroville, are state-run, not federal).",
  "",
  engagementCTA("generic", "reservoir-watch"),
  "",
  "Source website: https://data.usbr.gov/rise/",
  "Information retrieved programmatically via API.",
  "Graph made by Jeffrey Macy.",
];

const lines = [
  `Reservoir watch (${stamp})`, "",
  "Reservoir | State | % Full | Storage | Capacity | As of",
  "---|---|---:|---:|---:|---:",
  ...rows.map((r) => `${r.name} | ${r.state} | ${r.pctFull.toFixed(0)}% | ${maf(r.storageAF)} | ${maf(r.capacityAF)} | ${r.date}`),
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: U.S. Bureau of Reclamation RISE API (https://data.usbr.gov/rise/). Capacity figures are official Reclamation project maximums.",
  "Note: RISE observations are provisional and may be revised.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["reservoir", "state", "pct_full", "storage_af", "capacity_af", "as_of"],
  rows.map((r) => [r.name, r.state, r.pctFull.toFixed(1), r.storageAF, r.capacityAF, r.date])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
