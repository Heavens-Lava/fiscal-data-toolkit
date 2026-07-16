#!/usr/bin/env node
// State housing-stock growth compared with population growth using Census ACS.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const STATE_CODES = new Set(["01","02","04","05","06","08","09","10","11","12","13","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30","31","32","33","34","35","36","37","38","39","40","41","42","44","45","46","47","48","49","50","51","53","54","55","56"]);
const stamp = new Date().toISOString().slice(0, 10);
const noImage = process.argv.includes("--no-image");
const baseYear = Number(process.argv[process.argv.indexOf("--base") + 1]) || 2019;
const outBase = path.join(SOCIAL, `housing-supply-watch-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function num(n) { return Math.round(n).toLocaleString("en-US"); }
function pct(n) { return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; }
function censusKey() {
  if (process.env.CENSUS_API_KEY) return process.env.CENSUS_API_KEY;
  const env = path.join(ROOT, ".env");
  if (!existsSync(env)) return null;
  return readFileSync(env, "utf8").match(/^CENSUS_API_KEY=(.+)$/m)?.[1]?.trim() || null;
}

async function acs(year) {
  const qs = new URLSearchParams({ get: "NAME,DP05_0001E,DP04_0001E", for: "state:*" });
  const key = censusKey();
  if (key) qs.set("key", key);
  const res = await fetch(`https://api.census.gov/data/${year}/acs/acs1/profile?${qs}`, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Census ACS ${year} HTTP ${res.status}: ${text.slice(0, 120)}`);
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`Census ACS ${year} returned non-JSON: ${text.slice(0, 120)}`); }
  const [header, ...data] = parsed;
  const idx = (x) => header.indexOf(x);
  return new Map(data.filter((r) => STATE_CODES.has(r[idx("state")])).map((r) => [r[idx("state")], {
    state: r[idx("NAME")], population: Number(r[idx("DP05_0001E")]), housing: Number(r[idx("DP04_0001E")]),
  }]));
}

async function latestAcs() {
  for (const year of [2025, 2024, 2023]) {
    try { return { year, data: await acs(year) }; } catch { /* try prior vintage */ }
  }
  throw new Error("No recent ACS 1-year profile available.");
}

const [base, latest] = await Promise.all([acs(baseYear), latestAcs()]);
const rows = [...latest.data.entries()].map(([code, now]) => {
  const then = base.get(code);
  const populationGrowth = (now.population / then.population - 1) * 100;
  const housingGrowth = (now.housing / then.housing - 1) * 100;
  const pressure = populationGrowth - housingGrowth;
  const popAdded = now.population - then.population;
  const unitsAdded = now.housing - then.housing;
  return { code, state: now.state, populationGrowth, housingGrowth, pressure, popAdded, unitsAdded, population: now.population, housing: now.housing };
}).sort((a, b) => b.pressure - a.pressure).map((r, i) => ({ ...r, rank: i + 1 }));

const highest = rows.slice(0, 10);
const lowest = rows.slice(-5).reverse();
const az = rows.find((r) => r.state === "Arizona");
const chartRows = [...highest.slice(0, 7), ...(az && !highest.includes(az) ? [az] : [])];
const min = Math.min(...chartRows.map((r) => r.pressure));
const shifted = min < 0 ? -min : 0;
const chartSVG = horizontalBarChart(chartRows.map((r) => ({
  label: `#${r.rank} ${r.state}`,
  v: r.pressure + shifted,
  color: r.state === "Arizona" ? C.s2 : C.neg,
})), { fmtTick: (v) => `${(v - shifted).toFixed(0)} pp`, fmtVal: (v) => `${(v - shifted).toFixed(1)} pp` });

const hero = highest[0];
const html = cardHTML({
  kicker: "Housing supply check",
  title: "Where did population outgrow housing stock?",
  hero: `${hero.pressure.toFixed(1)} pp`,
  heroLabel: `${hero.state}; population growth minus housing growth`,
  chartSVG,
  source: "U.S. Census Bureau ACS 1-year profiles",
  vintage: `${baseYear}-${latest.year}`,
});

const facebook = [
  `Did housing supply keep up with population growth from ${baseYear} to ${latest.year}?`,
  "",
  `Largest gap: ${hero.state} - population ${pct(hero.populationGrowth)}, housing stock ${pct(hero.housingGrowth)} (${hero.pressure.toFixed(1)} percentage-point gap).`,
  ...(az ? [`Arizona: #${az.rank} - population ${pct(az.populationGrowth)}, housing stock ${pct(az.housingGrowth)} (${az.pressure.toFixed(1)}-point gap).`] : []),
  `State where housing most outpaced population: ${lowest[0].state} (${lowest[0].pressure.toFixed(1)} points).`,
  "",
  "This compares total housing units with total population. It does not measure affordability, vacancies, household size, or whether new homes are located where demand is strongest.",
  "",
  "Does the housing shortage feel better or worse where you live? Comment with your state.",
  "",
  "Follow for monthly housing-data comparisons and share this with someone watching the housing market.",
];

const lines = [
  `Housing supply watch (${stamp})`, "",
  `ACS ${baseYear} to ${latest.year}. Ranked by population growth minus housing-stock growth.`, "",
  "Rank | State | Population growth | Housing growth | Growth gap | Population added | Housing units added",
  "---:|---|---:|---:|---:|---:|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${pct(r.populationGrowth)} | ${pct(r.housingGrowth)} | ${r.pressure.toFixed(1)} pp | ${num(r.popAdded)} | ${num(r.unitsAdded)}`),
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: U.S. Census Bureau American Community Survey 1-year Data Profiles.",
  "Note: a positive gap means population grew faster than the number of housing units; it is a pressure indicator, not a complete housing-shortage estimate.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "population_growth_pct", "housing_growth_pct", "population_minus_housing_pp", "population_added", "housing_units_added", "base_year", "latest_year"], rows.map((r) => [r.rank, r.state, r.populationGrowth.toFixed(3), r.housingGrowth.toFixed(3), r.pressure.toFixed(3), r.popAdded, r.unitsAdded, baseYear, latest.year])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
