#!/usr/bin/env node
// business-formation-by-industry.mjs — which industries are booming? New
// business applications by NAICS sector, seasonally adjusted, year-over-year
// change. Census Bureau Business Formation Statistics timeseries API (same
// CENSUS_API_KEY as business-formation-watch.mjs / business-formation-by-state.mjs,
// which track the national trend and state ranking respectively — this is
// the industry-sector cut neither of those covers).
//
// Run:
//   node scripts/business-formation-by-industry.mjs
//   node scripts/business-formation-by-industry.mjs --month 2026-06
//   node scripts/business-formation-by-industry.mjs --no-image

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, engagementCTA, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

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
function num(n) { return Math.round(n).toLocaleString("en-US"); }

const SECTOR_NAMES = {
  NAICS11: "Agriculture, Forestry, Fishing & Hunting",
  NAICS21: "Mining, Quarrying, Oil & Gas",
  NAICS22: "Utilities",
  NAICS23: "Construction",
  NAICSMNF: "Manufacturing",
  NAICS42: "Wholesale Trade",
  NAICSRET: "Retail Trade",
  NAICSTW: "Transportation & Warehousing",
  NAICS51: "Information",
  NAICS52: "Finance & Insurance",
  NAICS53: "Real Estate",
  NAICS54: "Professional, Scientific & Technical Services",
  NAICS55: "Management of Companies",
  NAICS56: "Administrative & Waste Management Services",
  NAICS61: "Educational Services",
  NAICS62: "Health Care & Social Assistance",
  NAICS71: "Arts, Entertainment & Recreation",
  NAICS72: "Accommodation & Food Services",
  NAICS81: "Other Services (except Public Admin)",
};

const key = getCensusKey();
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();

async function bfsMonth(month) {
  const qs = new URLSearchParams({
    get: "cell_value,category_code",
    for: "us:*",
    time: month,
    data_type_code: "BA_BA",
    seasonally_adj: "yes",
    time_slot_id: "0",
    key,
  });
  const res = await fetch(`https://api.census.gov/data/timeseries/eits/bfs?${qs}`);
  const text = await res.text();
  if (!res.ok || !text.trim()) return new Map(); // no data published yet for this month
  let rows;
  try { rows = JSON.parse(text).slice(1); } catch { return new Map(); }
  return new Map(rows.map(([value, code]) => [code, Number(value)]));
}

// Default to the latest month with data — probe backward from this month
// since BFS publishes with a short lag and the exact cutoff shifts monthly.
async function latestMonth() {
  const override = argValue("--month");
  if (override) return override;
  const d = new Date();
  for (let back = 0; back < 4; back++) {
    const probe = new Date(d.getFullYear(), d.getMonth() - back, 1);
    const label = `${probe.getFullYear()}-${String(probe.getMonth() + 1).padStart(2, "0")}`;
    const data = await bfsMonth(label);
    if (data.has("TOTAL")) return label;
  }
  throw new Error("No recent Business Formation Statistics month found.");
}

const month = await latestMonth();
const [y, m] = month.split("-").map(Number);
const priorYear = `${y - 1}-${String(m).padStart(2, "0")}`;

const [current, prior] = await Promise.all([bfsMonth(month), bfsMonth(priorYear)]);

const sectors = Object.keys(SECTOR_NAMES)
  .map((code) => {
    const now = current.get(code);
    const then = prior.get(code);
    if (!Number.isFinite(now) || !Number.isFinite(then) || then === 0) return null;
    return { code, name: SECTOR_NAMES[code], applications: now, priorApplications: then, yoyPct: ((now - then) / then) * 100 };
  })
  .filter(Boolean)
  .sort((a, b) => b.yoyPct - a.yoyPct);

const totalNow = current.get("TOTAL");
const totalPrior = prior.get("TOTAL");
const totalYoy = ((totalNow - totalPrior) / totalPrior) * 100;
const booming = sectors.slice(0, 8);
const outBase = path.join(SOCIAL, `business-formation-by-industry-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

const SHORT_SECTOR_NAME = {
  NAICS54: "Professional & Technical Services",
  NAICS56: "Admin & Waste Management",
  NAICS81: "Other Services",
  NAICS62: "Health Care & Social Assistance",
  NAICS72: "Accommodation & Food Services",
  NAICS11: "Agriculture & Fishing",
  NAICS21: "Mining & Oil/Gas",
};
const chartSVG = horizontalBarChart(
  booming.map((s) => ({ label: SHORT_SECTOR_NAME[s.code] || s.name, v: s.yoyPct, color: s.yoyPct >= 0 ? C.s1 : C.neg })),
  { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%` }
);

const html = cardHTML({
  kicker: "Booming industries",
  title: `New business applications in ${booming[0].name} are up ${booming[0].yoyPct.toFixed(0)}% this year`,
  hero: `${booming[0].yoyPct >= 0 ? "+" : ""}${booming[0].yoyPct.toFixed(0)}%`,
  heroLabel: `${booming[0].name} — year-over-year growth in new business applications`,
  chartSVG,
  source: "Census Bureau Business Formation Statistics",
  vintage: month,
});

const facebook = [
  `New business applications in ${booming[0].name} are up ${booming[0].yoyPct.toFixed(0)}% year-over-year — the fastest-growing industry in the country right now, ${month} vs. ${priorYear} (seasonally adjusted). Here's the full ranking:`,
  "",
  ...booming.map((s, i) => `${i + 1}. ${s.name}: ${s.yoyPct >= 0 ? "+" : ""}${s.yoyPct.toFixed(0)}% (${num(s.applications)} applications, up from ${num(s.priorApplications)})`),
  "",
  `All industries combined: ${num(totalNow)} new business applications, ${totalYoy >= 0 ? "+" : ""}${totalYoy.toFixed(1)}% year-over-year.`,
  "",
  "\"Business applications\" are new EIN filings with the IRS that Census classifies by industry — filing an application isn't the same as a business actually launching and hiring, but it's the earliest real-time signal of where entrepreneurs are placing bets.",
  "",
  engagementCTA("trend", "business-formation-by-industry"),
  "",
  "Source website: https://www.census.gov/econ/bfs/",
  "Information retrieved programmatically via API.",
  "Graph made by Jeffrey Macy.",
];

const lines = [
  `Business formation by industry (${stamp}) — ${month} vs. ${priorYear}`, "",
  "Rank | Industry | New applications | YoY change",
  "---:|---|---:|---:",
  ...sectors.map((s, i) => `${i + 1} | ${s.name} | ${num(s.applications)} | ${s.yoyPct >= 0 ? "+" : ""}${s.yoyPct.toFixed(1)}%`),
  "", `All industries | ${num(totalNow)} | ${totalYoy >= 0 ? "+" : ""}${totalYoy.toFixed(1)}%`,
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: U.S. Census Bureau Business Formation Statistics timeseries API (data_type_code=BA_BA, seasonally adjusted business applications by NAICS sector).",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "sector_code", "industry", "applications", "prior_year_applications", "yoy_pct"],
  sectors.map((s, i) => [i + 1, s.code, s.name, s.applications, s.priorApplications, s.yoyPct.toFixed(2)])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
