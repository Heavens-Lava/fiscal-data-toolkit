#!/usr/bin/env node
// business-formation-watch.mjs - are Americans actually starting new
// businesses? Census Bureau Business Formation Statistics (weekly-collected,
// published monthly), seasonally adjusted total business applications. Uses
// the same CENSUS_API_KEY as census-topic-snapshot.mjs.
//
// Run:  node scripts/business-formation-watch.mjs
//       node scripts/business-formation-watch.mjs --no-image

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, lineChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

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

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function mLabel(ym) {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

const key = getCensusKey();
if (!key) {
  console.error("Missing CENSUS_API_KEY. Add CENSUS_API_KEY=your_key to .env.");
  process.exit(1);
}

const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `business-formation-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

console.log("  Fetching Business Formation Statistics from Census...");
const startYear = new Date().getUTCFullYear() - 5;
const qs = new URLSearchParams({
  get: "cell_value", for: "us:*", time: `from ${startYear}-01`,
  seasonally_adj: "yes", category_code: "TOTAL", data_type_code: "BA_BA", time_slot_id: "0", key,
});
const res = await fetch(`https://api.census.gov/data/timeseries/eits/bfs?${qs}`);
const text = await res.text();
if (!res.ok) throw new Error(`Census BFS API HTTP ${res.status}: ${text.slice(0, 300)}`);
const json = JSON.parse(text);
const [header, ...data] = json;
const iVal = header.indexOf("cell_value");
const iTime = header.indexOf("time");

const rows = data
  .map((r) => ({ ym: r[iTime], value: Number(r[iVal]) }))
  .filter((r) => Number.isFinite(r.value))
  .sort((a, b) => a.ym.localeCompare(b.ym));

if (!rows.length) throw new Error("No Business Formation Statistics rows returned");

const latest = rows[rows.length - 1];
const yearAgoYm = `${Number(latest.ym.slice(0, 4)) - 1}${latest.ym.slice(4)}`;
const yearAgo = rows.find((r) => r.ym === yearAgoYm);
const yoyChange = yearAgo ? ((latest.value - yearAgo.value) / yearAgo.value) * 100 : null;
const peak = rows.reduce((a, b) => (b.value > a.value ? b : a));

const pts = rows.slice(-36).map((r) => ({ label: mLabel(r.ym), v: r.value / 1000 }));
const step = Math.max(3, Math.round(pts.length / 8));
const chartSVG = lineChart(
  [{ color: C.s1, points: pts, endLabel: (v) => v }],
  { fmtTick: (v) => `${v.toFixed(0)}k`, fmtVal: (v) => `${v.toFixed(0)}k`, labelStep: step, yLabel: "New Business Applications (thousands)" }
);

const html = cardHTML({
  kicker: "Business formation check",
  title: "New business applications, seasonally adjusted",
  hero: Math.round(latest.value).toLocaleString("en-US"),
  heroLabel: `applications · ${mLabel(latest.ym)}`,
  chartSVG,
  source: "US Census Bureau, Business Formation Statistics",
  vintage: mLabel(latest.ym),
});

const facebook = [
  "Business formation check:",
  "",
  `Americans filed ${Math.round(latest.value).toLocaleString("en-US")} new business applications in ${mLabel(latest.ym)} (seasonally adjusted) — the Census Bureau's real-time signal for new business creation, built from actual IRS Employer Identification Number filings, not a survey.`,
  ...(yoyChange != null ? [`That's ${yoyChange >= 0 ? "up" : "down"} ${Math.abs(yoyChange).toFixed(1)}% from ${mLabel(yearAgoYm)} (${Math.round(yearAgo.value).toLocaleString("en-US")}).`] : []),
  `5-year high in this window: ${Math.round(peak.value).toLocaleString("en-US")} in ${mLabel(peak.ym)}.`,
  "",
  "Note: this counts applications, not businesses that actually launched or hired anyone — Census separately tracks \"high-propensity\" applications (the subset statistically likely to become real employer businesses), which is a stricter number than the total shown here.",
  "",
  "Real numbers, real source — US Census Bureau Business Formation Statistics:",
  "https://www.census.gov/econ/bfs/index.html",
];

const lines = [
  `Business formation check (${stamp})`,
  "",
  `Latest: ${Math.round(latest.value).toLocaleString("en-US")} applications (${mLabel(latest.ym)}, seasonally adjusted)`,
  ...(yoyChange != null ? [`YoY change: ${yoyChange >= 0 ? "+" : ""}${yoyChange.toFixed(1)}%`] : []),
  "",
  "Month | Applications (SA)",
  "---|---:",
  ...rows.slice(-36).map((r) => `${mLabel(r.ym)} | ${Math.round(r.value).toLocaleString("en-US")}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["month", "applications_sa"], rows.map((r) => [r.ym, r.value])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
