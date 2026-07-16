#!/usr/bin/env node
// veteran-homelessness-watch.mjs - the national point-in-time count of
// homeless veterans, 2011-present, and which states have the most. HUD's
// full point-in-time homelessness dataset is only published as a binary
// .xlsb workbook this parser can't read, but HUD USER also publishes a
// veteran-specific breakdown as a real .xlsx with one sheet per year — that's
// the file this script reads. No API key required, but HUD USER's site
// blocks requests without a browser-like User-Agent header (see UA below).
//
// Run:  node scripts/veteran-homelessness-watch.mjs
//       node scripts/veteran-homelessness-watch.mjs --no-image
//
// Source file updates once a year (each summer, alongside the new AHAR
// report) and is named for its year range — bump FILE_URL's year range if
// this stops resolving after HUD USER republishes for a new year.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, lineChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { readSheetNames, readSheetRowsByName } from "./lib/xlsx-lite.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const FILE_URL = "https://www.huduser.gov/portal/sites/default/files/xls/2011-2025-PIT-Veteran-Counts-by-State.xlsx";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function f0(n) {
  return Math.round(n).toLocaleString("en-US");
}

function pct(n) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `veteran-homelessness-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

console.log("  Fetching HUD veteran point-in-time counts by state...");
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 20000);
let buf;
try {
  const res = await fetch(FILE_URL, { signal: controller.signal, headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HUD USER HTTP ${res.status} for ${FILE_URL}`);
  buf = Buffer.from(await res.arrayBuffer());
} finally {
  clearTimeout(timer);
}

const years = readSheetNames(buf)
  .filter((name) => /^\d{4}$/.test(name))
  .map(Number)
  .sort((a, b) => a - b);
if (!years.length) throw new Error("No year sheets found in HUD veteran homelessness workbook");

function yearTotals(year) {
  const rows = readSheetRowsByName(buf, String(year));
  const header = rows[0];
  const iTotal = header.findIndex((h) => String(h).startsWith("Homeless Veterans"));
  const iUnsheltered = header.findIndex((h) => String(h).startsWith("Unsheltered Homeless Veterans"));
  const totalRow = rows.find((r) => String(r[0]).trim() === "Total");
  if (!totalRow || iTotal < 0) throw new Error(`Could not find total row for ${year}`);
  const states = rows
    .filter((r) => r[0] && r[0] !== "Total" && /^[A-Z]{2}$/.test(String(r[0]).trim()) && Number.isFinite(Number(r[iTotal])))
    .map((r) => ({ state: String(r[0]).trim(), total: Number(r[iTotal]) }));
  return { total: Number(totalRow[iTotal]), unsheltered: iUnsheltered >= 0 ? Number(totalRow[iUnsheltered]) : null, states };
}

const trend = years.map((y) => ({ year: y, ...yearTotals(y) }));
const latest = trend[trend.length - 1];
const first = trend[0];
const prior = trend[trend.length - 2];
const yoyChange = prior ? ((latest.total - prior.total) / prior.total) * 100 : null;
const changeSinceStart = ((latest.total - first.total) / first.total) * 100;

const topStates = [...latest.states].sort((a, b) => b.total - a.total).slice(0, 10);

// 2021's count is a known outlier, not a real dip: ~40% of CoCs (including
// almost all of California) skipped the unsheltered count that year citing
// COVID-19 transmission risk, so 2021's total undercounts unsheltered
// veterans relative to every other year. Flag it rather than let it read as
// a real one-year improvement.
const pts = trend.map((t) => ({ label: t.year === 2021 ? "2021*" : String(t.year), v: t.total / 1000 }));
const trendChartSVG = lineChart(
  [{ color: C.s1, points: pts, endLabel: (v) => v }],
  { fmtTick: (v) => `${v.toFixed(0)}k`, fmtVal: (v) => `${v.toFixed(1)}k`, labelStep: 2, yLabel: "Homeless veterans, PIT count (thousands)" }
);

const html = cardHTML({
  kicker: "Veteran homelessness check",
  title: `Homeless veteran count, ${first.year}-${latest.year}`,
  hero: f0(latest.total),
  heroLabel: `veterans counted · January ${latest.year} point-in-time count`,
  chartSVG: trendChartSVG,
  source: "HUD, Point-in-Time Count",
  vintage: `${latest.year}`,
});

const facebook = [
  "Veteran homelessness check:",
  "",
  `HUD's January ${latest.year} point-in-time count found ${f0(latest.total)} homeless veterans nationwide${latest.unsheltered != null ? ` (${f0(latest.unsheltered)} of them unsheltered — living outside rather than in a shelter)` : ""}.`,
  "",
  `That's down ${Math.abs(changeSinceStart).toFixed(0)}% from ${f0(first.total)} in ${first.year} — one of the more consistent improvement stories in federal homelessness data, driven largely by the HUD-VA Supportive Housing (HUD-VASH) voucher program.`,
  ...(yoyChange != null ? [`Year over year: ${pct(yoyChange)} from ${f0(prior.total)} in ${prior.year}.`] : []),
  "",
  `States with the most homeless veterans in ${latest.year}: ${topStates.slice(0, 5).map((s) => `${s.state} ${f0(s.total)}`).join(", ")}.`,
  "",
  "Chart-reading note: 2021* is a known data-quality outlier, not a real dip — about 40% of communities (including nearly all of California) skipped the unsheltered count that year citing COVID-19 transmission risk, so 2021 undercounts unsheltered veterans relative to every other year on the chart.",
  "",
  "Note: this is a single-night January street-and-shelter count, not a full-year total — it undercounts veterans who are homeless only briefly or who avoid being counted. It also doesn't include veterans who are housed via HUD-VASH or other subsidized programs (those are counted separately as successfully housed, not as currently homeless).",
  "",
  "Real numbers, real source — HUD Point-in-Time Count, veteran breakdown:",
  "https://www.huduser.gov/portal/datasets/ahar.html",
];

const lines = [
  `Veteran homelessness check (${stamp})`,
  "",
  `Latest: ${f0(latest.total)} homeless veterans (January ${latest.year} PIT count)`,
  ...(yoyChange != null ? [`YoY change: ${pct(yoyChange)}`] : []),
  `Change since ${first.year}: ${pct(changeSinceStart)} (from ${f0(first.total)})`,
  "",
  "Year | Homeless Veterans (PIT)",
  "---:|---:",
  ...trend.map((t) => `${t.year === 2021 ? "2021*" : t.year} | ${f0(t.total)}`),
  "* 2021: ~40% of communities skipped the unsheltered count that year due to COVID-19 — not a real one-year dip.",
  "",
  `Top 10 states, ${latest.year} | Homeless Veterans`,
  "---|---:",
  ...topStates.map((s) => `${s.state} | ${f0(s.total)}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["year", "homeless_veterans", "unsheltered_veterans"], trend.map((t) => [t.year, t.total, t.unsheltered ?? ""])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
