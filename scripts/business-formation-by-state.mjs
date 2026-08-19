#!/usr/bin/env node
// State ranking for new business applications from Census BFS weekly state CSV.
// Uses latest 52 weeks of not-seasonally-adjusted business applications and
// joins ACS state population so rankings are comparable by population size.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const BFS_URL = "https://www.census.gov/econ/bfs/csv/bfs_state_apps_weekly_nsa.csv";
const STATE_CODES = new Set([
  "01", "02", "04", "05", "06", "08", "09", "10", "11", "12", "13", "15", "16",
  "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29",
  "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42",
  "44", "45", "46", "47", "48", "49", "50", "51", "53", "54", "55", "56",
]);
const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

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

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function num(n) {
  return Math.round(n).toLocaleString("en-US");
}

function rate(n) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function pct(n) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift().split(",");
  return lines.map((line) => {
    const cols = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cols[i] ?? ""]));
  });
}

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

async function getJSON(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Census HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function latestAcsPop(key) {
  for (const year of [2025, 2024, 2023, 2022, 2021]) {
    try {
      const qs = new URLSearchParams({ get: "NAME,B01003_001E", for: "state:*", key });
      const json = await getJSON(`https://api.census.gov/data/${year}/acs/acs1?${qs}`);
      const [header, ...rows] = json;
      const iName = header.indexOf("NAME");
      const iPop = header.indexOf("B01003_001E");
      const iState = header.indexOf("state");
      return {
        year,
        byName: new Map(rows
          .filter((r) => STATE_CODES.has(r[iState]))
          .map((r) => [r[iName], Number(r[iPop])])),
      };
    } catch (err) {
      if (/key/i.test(err.message)) throw err;
    }
  }
  throw new Error("Could not fetch ACS state population.");
}

const key = getCensusKey();
if (!key) {
  console.error("Missing CENSUS_API_KEY. Add CENSUS_API_KEY=your_key to .env.");
  process.exit(1);
}

const noImage = process.argv.includes("--no-image");
const includeDc = !process.argv.includes("--exclude-dc");
const topN = Math.max(5, Math.min(20, Number(argValue("--top", "10")) || 10));
const today = stamp();
const outBase = path.join(SOCIAL, `business-formation-by-state-${today}`);
mkdirSync(SOCIAL, { recursive: true });

const [csvText, pop] = await Promise.all([getText(BFS_URL), latestAcsPop(key)]);
const all = parseCSV(csvText)
  .map((r) => ({
    year: Number(r.Year),
    week: Number(r.Week),
    abbr: r.State,
    applications: Number(r.BA_NSA),
    highPropensity: Number(r.HBA_NSA),
  }))
  .filter((r) => STATE_NAMES[r.abbr] && Number.isFinite(r.applications));

const allWeeks = [...new Set(all.map((r) => `${r.year}-${String(r.week).padStart(2, "0")}`))].sort();
const latest = allWeeks[allWeeks.length - 1];
const [latestYear, latestWeek] = latest.split("-").map(Number);
const latestWeeks = allWeeks.slice(-52);
const prevWeeks = allWeeks.slice(-104, -52);

function sumByState(weeks) {
  const wanted = new Set(weeks);
  const by = new Map();
  for (const r of all) {
    const weekKey = `${r.year}-${String(r.week).padStart(2, "0")}`;
    if (!wanted.has(weekKey)) continue;
    const state = STATE_NAMES[r.abbr];
    const cur = by.get(state) || { state, abbr: r.abbr, applications: 0, highPropensity: 0 };
    cur.applications += r.applications;
    cur.highPropensity += Number.isFinite(r.highPropensity) ? r.highPropensity : 0;
    by.set(state, cur);
  }
  return by;
}

const prevByState = sumByState(prevWeeks);
const rows = [...sumByState(latestWeeks).values()]
  .filter((r) => includeDc || r.state !== "District of Columbia")
  .map((r) => {
    const population = pop.byName.get(r.state);
    const prev = prevByState.get(r.state)?.applications ?? null;
    return {
      ...r,
      population,
      rate: population ? r.applications / population * 100000 : null,
      yoy: prev ? (r.applications - prev) / prev * 100 : null,
    };
  })
  .filter((r) => Number.isFinite(r.rate))
  .sort((a, b) => b.rate - a.rate)
  .map((r, i) => ({ ...r, rank: i + 1 }));

const highest = rows.slice(0, topN);
const lowest = rows.slice(-5).reverse();
const az = rows.find((r) => r.state === "Arizona");
const chartRows = [...highest.slice(0, 5), ...lowest.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({
    label: `#${r.rank} ${r.state}`,
    v: r.rate,
    color: r.rank <= 5 ? C.s1 : C.s2,
  })),
  { fmtTick: (v) => `${Math.round(v)}`, fmtVal: (v) => `${rate(v)} / 100k` }
);

const hero = highest[0];
const html = cardHTML({
  kicker: "Business formation check",
  title: "New business applications by state",
  hero: `${rate(hero.rate)} / 100k`,
  heroLabel: `${hero.state}; latest 52 weeks`,
  chartSVG,
  source: "U.S. Census Bureau BFS; ACS population",
  vintage: `Week ${latestWeek}, ${latestYear}`,
});

const facebook = [
  `Wyoming recorded ${rate(hero.rate)} new business applications per 100,000 residents over the latest 52 weeks — far above every other state. Every state, ranked:`,
  "",
  `#1 ${hero.state}: ${rate(hero.rate)} per 100k (${num(hero.applications)} applications)` ,
  ...(az ? [`Arizona: #${az.rank} (${rate(az.rate)} per 100k; ${num(az.applications)} applications).`] : []),
  `#${lowest[0].rank} ${lowest[0].state}: ${rate(lowest[0].rate)} per 100k (${num(lowest[0].applications)} applications)`,
  "",
  "Important context: these are EIN applications, not confirmed businesses, jobs, or storefronts. A state's legal and tax environment can also attract registrations from companies operating elsewhere.",
  "",
  "What matters most when deciding where to start a business: taxes, customers, workers, or cost of living?",
  "",
  "Follow for more state-by-state data, and share this with someone who owns a business.",
];

const lines = [
  `Business formation by state (${today})`,
  "",
  `Metric: new business applications per 100,000 residents, latest 52 weeks through week ${latestWeek}, ${latestYear}.`,
  `Population denominator: ACS ${pop.year}.`,
  "",
  "Rank | State | Applications | Per 100k residents | High-propensity apps | YoY",
  "---:|---|---:|---:|---:|---:",
  ...highest.map((r) => `${r.rank} | ${r.state} | ${num(r.applications)} | ${rate(r.rate)} | ${num(r.highPropensity)} | ${r.yoy == null ? "n/a" : pct(r.yoy)}`),
  "",
  "Lowest states",
  "",
  "Rank | State | Applications | Per 100k residents | High-propensity apps | YoY",
  "---:|---|---:|---:|---:|---:",
  ...lowest.map((r) => `${r.rank} | ${r.state} | ${num(r.applications)} | ${rate(r.rate)} | ${num(r.highPropensity)} | ${r.yoy == null ? "n/a" : pct(r.yoy)}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
  "",
  "Source: U.S. Census Bureau Business Formation Statistics weekly state CSV; U.S. Census Bureau ACS population.",
  "Note: weekly state BFS data are not seasonally adjusted.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "state", "applications_latest_52_weeks", "applications_per_100k", "high_propensity_applications", "yoy_pct", "population", "latest_year", "latest_week", "population_vintage"],
  rows.map((r) => [r.rank, r.state, r.applications, r.rate.toFixed(3), r.highPropensity, r.yoy == null ? "" : r.yoy.toFixed(3), r.population, latestYear, latestWeek, pop.year])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
