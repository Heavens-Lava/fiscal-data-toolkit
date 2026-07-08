#!/usr/bin/env node
// census-population-housing.mjs - ACS population, housing, rent, and value check.
// Source: Census ACS 5-year Data Profile API. Requires free CENSUS_API_KEY.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  C,
  cardHTML,
  horizontalBarChart,
  screenshot,
  toCSV,
} from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

const STATES = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11",
  FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21",
  LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30",
  NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39",
  OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48", UT: "49",
  VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
};

const VARS = [
  "NAME",
  "DP05_0001E",  // total population
  "DP04_0001E",  // total housing units
  "DP04_0134E",  // median gross rent
  "DP04_0089E",  // median owner-occupied home value
  "DP04_0046PE", // owner-occupied share
];

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

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > -100000 ? n : null;
}

function fmtInt(n) {
  return Math.round(n).toLocaleString("en-US");
}

function money(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function pct(n) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function pp(n) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)} pp`;
}

function change(now, then) {
  return ((now - then) / then) * 100;
}

function stateCode(input) {
  const s = String(input || "AZ").trim().toUpperCase();
  if (STATES[s]) return { abbr: s, code: STATES[s] };
  if (/^\d{2}$/.test(s)) {
    const abbr = Object.entries(STATES).find(([, code]) => code === s)?.[0] || s;
    return { abbr, code: s };
  }
  throw new Error(`Unknown --state "${input}". Use a postal abbreviation like AZ, CA, TX.`);
}

function localDateStamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function acsProfile(year, state, key) {
  const qs = new URLSearchParams({
    get: VARS.join(","),
    for: `state:${state.code}`,
    key,
  });
  const url = `https://api.census.gov/data/${year}/acs/acs5/profile?${qs}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  let text;
  try {
    res = await fetch(url, { signal: controller.signal });
    text = await res.text();
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Census ACS ${year} timed out after 15 seconds`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (text.includes("Missing Key")) {
    throw new Error("Census API requires CENSUS_API_KEY. Add it to .env or your shell environment.");
  }
  if (!res.ok) throw new Error(`Census ACS ${year} HTTP ${res.status}: ${text.slice(0, 120)}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Census ACS ${year} returned non-JSON: ${text.slice(0, 120)}`);
  }
  const [header, row] = json;
  if (!row) throw new Error(`No ACS profile row for ${state.abbr} in ${year}`);
  const value = (name) => row[header.indexOf(name)];
  return {
    year,
    name: value("NAME"),
    population: num(value("DP05_0001E")),
    housingUnits: num(value("DP04_0001E")),
    medianRent: num(value("DP04_0134E")),
    medianHomeValue: num(value("DP04_0089E")),
    ownerOccupiedPct: num(value("DP04_0046PE")),
  };
}

async function latestAcs(state, key) {
  const years = [2025, 2024, 2023, 2022, 2021, 2020];
  let lastErr = null;
  for (const year of years) {
    try {
      return await acsProfile(year, state, key);
    } catch (err) {
      lastErr = err;
      if (/CENSUS_API_KEY|Missing Key/.test(err.message)) throw err;
    }
  }
  throw lastErr || new Error("No ACS profile vintage available");
}

const key = getCensusKey();
if (!key) {
  console.error("Missing CENSUS_API_KEY.");
  console.error("Get a free key: https://api.census.gov/data/key_signup.html");
  console.error("Then add CENSUS_API_KEY=your_key to .env in the repo root.");
  process.exit(1);
}

const state = stateCode(argValue("--state", "AZ"));
const baseYear = Number(argValue("--base", "2020"));
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `census-population-housing-${state.abbr.toLowerCase()}-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const [base, latest] = await Promise.all([
  acsProfile(baseYear, state, key),
  latestAcs(state, key),
]);

if (latest.year === base.year) throw new Error(`Latest ACS year equals base year (${base.year}); choose an older --base year.`);

const metrics = [
  { label: "Population", latest: latest.population, base: base.population, fmt: fmtInt, chg: change(latest.population, base.population) },
  { label: "Housing units", latest: latest.housingUnits, base: base.housingUnits, fmt: fmtInt, chg: change(latest.housingUnits, base.housingUnits) },
  { label: "Median gross rent", latest: latest.medianRent, base: base.medianRent, fmt: money, chg: change(latest.medianRent, base.medianRent) },
  { label: "Median home value", latest: latest.medianHomeValue, base: base.medianHomeValue, fmt: money, chg: change(latest.medianHomeValue, base.medianHomeValue) },
];

const peopleAdded = latest.population - base.population;
const homesAdded = latest.housingUnits - base.housingUnits;
const peoplePerUnit = homesAdded ? peopleAdded / homesAdded : null;
const ownerChange = latest.ownerOccupiedPct - base.ownerOccupiedPct;

const chartSVG = horizontalBarChart(
  metrics.map((m, i) => ({
    label: m.label,
    v: m.chg,
    color: i < 2 ? C.s2 : C.s1,
  })),
  { fmtTick: (v) => `${Math.round(v)}%`, fmtVal: pct }
);

const html = cardHTML({
  kicker: "Census housing check",
  title: `${latest.name}: population, housing, rent, and value`,
  hero: peoplePerUnit == null ? "n/a" : peoplePerUnit.toFixed(1),
  heroLabel: `people added per housing unit added, ${base.year}-${latest.year}`,
  chartSVG,
  source: "U.S. Census Bureau ACS 5-year profile",
  vintage: `${base.year}-${latest.year}`,
});

const facebook = [
  `${latest.name} Census housing check (${base.year}-${latest.year})`,
  "",
  "Metric | Base | Latest | Change",
  "---|---:|---:|---:",
  ...metrics.map((m) => `${m.label} | ${m.fmt(m.base)} | ${m.fmt(m.latest)} | ${pct(m.chg)}`),
  `Homeownership rate | ${base.ownerOccupiedPct.toFixed(1)}% | ${latest.ownerOccupiedPct.toFixed(1)}% | ${pp(ownerChange)}`,
  "",
  `People added: ${fmtInt(peopleAdded)}`,
  `Housing units added: ${fmtInt(homesAdded)}`,
  `People added per housing unit added: ${peoplePerUnit == null ? "n/a" : peoplePerUnit.toFixed(1)}`,
  "",
  "Source: U.S. Census Bureau ACS 5-year Data Profile.",
];

const lines = [
  `Census population + housing check (${stamp})`,
  "",
  facebook.join("\n"),
  "",
  "Data table",
  "----------",
  "Metric | Base year | Base | Latest year | Latest | Change",
  "---|---:|---:|---:|---:|---:",
  ...metrics.map((m) => `${m.label} | ${base.year} | ${m.fmt(m.base)} | ${latest.year} | ${m.fmt(m.latest)} | ${pct(m.chg)}`),
  `Homeownership rate | ${base.year} | ${base.ownerOccupiedPct.toFixed(1)}% | ${latest.year} | ${latest.ownerOccupiedPct.toFixed(1)}% | ${pp(ownerChange)}`,
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["metric", "base_year", "base_value", "latest_year", "latest_value", "change"],
  [
    ...metrics.map((m) => [m.label, base.year, m.base, latest.year, m.latest, m.chg.toFixed(4)]),
    ["Homeownership rate", base.year, base.ownerOccupiedPct, latest.year, latest.ownerOccupiedPct, ownerChange.toFixed(4)],
    ["People added", base.year, "", latest.year, peopleAdded, ""],
    ["Housing units added", base.year, "", latest.year, homesAdded, ""],
    ["People per housing unit added", base.year, "", latest.year, peoplePerUnit?.toFixed(4) ?? "", ""],
  ]
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
