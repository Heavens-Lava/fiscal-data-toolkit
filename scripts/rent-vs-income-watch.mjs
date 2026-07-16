#!/usr/bin/env node
// Rent vs income by state from Census ACS 1-year Data Profile.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const STATE_CODES = new Set([
  "01", "02", "04", "05", "06", "08", "09", "10", "11", "12", "13", "15", "16",
  "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29",
  "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42",
  "44", "45", "46", "47", "48", "49", "50", "51", "53", "54", "55", "56",
]);

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

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function money(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function pct(n) {
  return `${n.toFixed(1)}%`;
}

async function getJSON(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Census HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function acs(year, key) {
  const qs = new URLSearchParams({
    get: "NAME,DP04_0134E,DP03_0062E",
    for: "state:*",
    key,
  });
  const json = await getJSON(`https://api.census.gov/data/${year}/acs/acs1/profile?${qs}`);
  const [header, ...rows] = json;
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return rows.map((r) => ({
    state: r[idx.NAME],
    rent: Number(r[idx.DP04_0134E]),
    income: Number(r[idx.DP03_0062E]),
    stateCode: r[idx.state],
  }));
}

async function latestYear(key) {
  for (const year of [2025, 2024, 2023, 2022, 2021]) {
    try {
      const rows = await acs(year, key);
      if (rows.length) return year;
    } catch (err) {
      if (/key/i.test(err.message)) throw err;
    }
  }
  throw new Error("No ACS 1-year profile vintage available.");
}

const key = getCensusKey();
if (!key) {
  console.error("Missing CENSUS_API_KEY. Add CENSUS_API_KEY=your_key to .env.");
  process.exit(1);
}

const noImage = process.argv.includes("--no-image");
const includeDc = !process.argv.includes("--exclude-dc");
const includeTerritories = process.argv.includes("--include-territories");
const topN = Math.max(5, Math.min(20, Number(argValue("--top", "10")) || 10));
const year = Number(argValue("--year", "0")) || await latestYear(key);
const outBase = path.join(SOCIAL, `rent-vs-income-watch-${stamp()}`);
mkdirSync(SOCIAL, { recursive: true });

const rows = (await acs(year, key))
  .filter((r) => includeTerritories || STATE_CODES.has(r.stateCode))
  .filter((r) => includeDc || r.state !== "District of Columbia")
  .filter((r) => Number.isFinite(r.rent) && Number.isFinite(r.income) && r.rent > 0 && r.income > 0)
  .map((r) => ({
    ...r,
    monthlyIncome: r.income / 12,
    rentShare: r.rent / (r.income / 12) * 100,
  }))
  .sort((a, b) => b.rentShare - a.rentShare)
  .map((r, i) => ({ ...r, rank: i + 1 }));

const highest = rows.slice(0, topN);
const lowest = rows.slice(-5).reverse();
const usRows = await getJSON(`https://api.census.gov/data/${year}/acs/acs1/profile?${new URLSearchParams({ get: "NAME,DP04_0134E,DP03_0062E", for: "us:1", key })}`);
const us = {
  rent: Number(usRows[1][1]),
  income: Number(usRows[1][2]),
};
us.rentShare = us.rent / (us.income / 12) * 100;

const chartRows = [...highest.slice(0, 5), { state: "U.S.", rentShare: us.rentShare, us: true }, ...lowest.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({
    label: r.us ? "U.S." : `#${r.rank} ${r.state}`,
    v: r.rentShare,
    color: r.us ? C.s2 : C.s1,
  })),
  { fmtTick: (v) => `${Math.round(v)}%`, fmtVal: (v) => pct(v) }
);

const hero = highest[0];
const html = cardHTML({
  kicker: "Rent vs income check",
  title: "Where rent takes the biggest share of income",
  hero: pct(hero.rentShare),
  heroLabel: `${hero.state}; ${money(hero.rent)} rent / ${money(hero.income)} income`,
  chartSVG,
  source: "U.S. Census Bureau ACS 1-year Data Profile",
  vintage: String(year),
});

const lines = [
  `Rent vs income check (${stamp()})`,
  "",
  `Metric: median gross rent divided by median monthly household income. Vintage: ACS ${year}.`,
  "",
  "Rank | State | Median rent | Median household income | Rent share of monthly income",
  "---:|---|---:|---:|---:",
  ...highest.map((r) => `${r.rank} | ${r.state} | ${money(r.rent)} | ${money(r.income)} | ${pct(r.rentShare)}`),
  "U.S. | U.S. | " + `${money(us.rent)} | ${money(us.income)} | ${pct(us.rentShare)}`,
  "",
  "Lowest rent burden states",
  "",
  "Rank | State | Median rent | Median household income | Rent share of monthly income",
  "---:|---|---:|---:|---:",
  ...lowest.map((r) => `${r.rank} | ${r.state} | ${money(r.rent)} | ${money(r.income)} | ${pct(r.rentShare)}`),
  "",
  "Source: U.S. Census Bureau ACS 1-year Data Profile.",
  "Note: This is a simple state-level affordability ratio, not a household-level rent burden measure.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "state", "median_gross_rent", "median_household_income", "rent_share_monthly_income_pct", "vintage"],
  rows.map((r) => [r.rank, r.state, r.rent, r.income, r.rentShare, year])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`)).join(" / ")}`);
