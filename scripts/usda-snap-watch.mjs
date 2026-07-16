#!/usr/bin/env node
// SNAP participation and benefit snapshot from USDA FNS state-level Excel tables.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { readFirstSheetRows } from "./lib/xlsx-lite.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const BASE = "https://www.fns.usda.gov/sites/default/files/resource-files";
const FILES = {
  persons: `${BASE}/snap-persons-6.xlsx`,
  households: `${BASE}/snap-households-6.xlsx`,
  benefits: `${BASE}/snap-benefits-6.xlsx`,
};

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function stateName(input) {
  const map = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
    CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
    FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
    IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
    ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
    MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
    NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
    NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
    OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
    RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
    TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
    WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  };
  const s = String(input || "").trim();
  return map[s.toUpperCase()] || s;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v || "").replace(/[$,%\s,]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function f0(n) {
  return Math.round(n).toLocaleString("en-US");
}

function money(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function pct(n) {
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
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

async function table(kind) {
  const res = await fetch(FILES[kind]);
  if (!res.ok) throw new Error(`USDA FNS ${res.status} for ${kind}`);
  const rows = readFirstSheetRows(Buffer.from(await res.arrayBuffer()));
  const header = rows.find((r) => String(r[0]).toLowerCase().includes("state"));
  const latestLabel = String(header?.[3] || "latest").replace(/\s+/g, " ").trim();
  return rows
    .filter((r) => r[0] && Number.isFinite(num(r[3])))
    .map((r) => ({
      state: String(r[0]).trim(),
      value: num(r[3]),
      priorMonth: num(r[2]),
      priorYear: num(r[1]),
      mom: num(r[4]),
      yoy: num(r[5]),
      latestLabel,
    }));
}

async function populationByState() {
  const qs = new URLSearchParams({
    get: "NAME,DP05_0001E",
    for: "state:*",
  });
  const key = getCensusKey();
  if (key) qs.set("key", key);
  const res = await fetch(`https://api.census.gov/data/2024/acs/acs1/profile?${qs}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`Census ACS HTTP ${res.status}: ${text.slice(0, 160)}`);
  const json = JSON.parse(text);
  const [header, ...rows] = json;
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return new Map(rows.map((r) => [r[idx.NAME], Number(r[idx.DP05_0001E])]));
}

const metric = argValue("--metric", "persons");
if (!FILES[metric]) {
  console.error(`Unknown --metric "${metric}". Options: ${Object.keys(FILES).join(", ")}`);
  process.exit(1);
}

const view = argValue("--view", "count");
const topN = Math.max(1, Math.min(25, Number(argValue("--top", "10")) || 10));
const includeState = stateName(argValue("--include", ""));
const noImage = process.argv.includes("--no-image");
const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, view === "rate" ? `usda-snap-watch-rate-${stamp}` : `usda-snap-watch-${metric}-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

if (view === "rate") {
  const [persons, benefits, popMap] = await Promise.all([
    table("persons"),
    table("benefits"),
    populationByState(),
  ]);
  const benefitsByState = new Map(benefits.map((r) => [r.state, r]));
  const rows = persons
    .filter((r) => !["TOTAL", "Total", "United States"].includes(r.state))
    .map((r) => {
      const benefit = benefitsByState.get(r.state);
      const population = popMap.get(r.state);
      return {
        state: r.state,
        participants: r.value,
        benefits: benefit?.value ?? null,
        population,
        share: population ? r.value / population : null,
        monthlyPerParticipant: benefit?.value && r.value ? benefit.value / r.value : null,
        latestLabel: r.latestLabel,
      };
    })
    .filter((r) => r.population && r.share != null)
    .sort((a, b) => b.share - a.share)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const highest = rows.slice(0, topN);
  const az = rows.find((r) => r.state === "Arizona");
  const included = includeState ? rows.find((r) => r.state.toLowerCase() === includeState.toLowerCase()) : null;
  const shown = included && !highest.some((r) => r.state === included.state)
    ? [...highest, included]
    : highest;
  const chartSVG = horizontalBarChart(
    shown.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.share * 100, color: r.state === "Arizona" ? C.s2 : C.s1 })),
    { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => `${v.toFixed(1)}%` }
  );

  const html = cardHTML({
    kicker: "SNAP check",
    title: "SNAP participants as a share of state population",
    hero: `${(shown[0].share * 100).toFixed(1)}%`,
    heroLabel: `${shown[0].state}; ${shown[0].latestLabel}`,
    chartSVG,
    source: "USDA FNS; Census ACS 2024 population",
    vintage: shown[0].latestLabel,
  });

  const lines = [
    `SNAP rate and spending check (${stamp})`,
    "",
    `SNAP data: USDA FNS ${shown[0].latestLabel}. Population denominator: Census ACS 2024 1-year estimate.`,
    az ? `Arizona ranks #${az.rank}: ${f0(az.participants)} participants, ${(az.share * 100).toFixed(1)}% of population, ${money(az.benefits)} monthly benefits, ${money(az.benefits * 12)} annualized.` : "",
    included && !highest.some((r) => r.state === included.state) ? `Table shows top ${topN} states plus ${included.state} for comparison.` : `Table shows top ${topN} states.`,
    "",
    "Rank | State | Participants | Pop. share | Monthly benefits | Annualized benefits | Monthly/participant",
    "---:|---|---:|---:|---:|---:|---:",
    ...shown.map((r) => `${r.rank} | ${r.state} | ${f0(r.participants)} | ${(r.share * 100).toFixed(1)}% | ${money(r.benefits)} | ${money(r.benefits * 12)} | ${money(r.monthlyPerParticipant)}`),
    "",
    "Source: USDA Food and Nutrition Service SNAP state-level data tables; U.S. Census Bureau ACS 2024 population.",
    "Note: This is SNAP participants divided by total population, not USDA's eligible-person participation rate.",
  ];

  writeFileSync(`${outBase}.txt`, lines.join("\n"));
  writeFileSync(`${outBase}.csv`, toCSV(
    ["rank", "state", "participants", "population", "population_share", "monthly_benefits", "annualized_benefits", "monthly_benefits_per_participant", "snap_latest_label", "population_vintage"],
    rows.map((r) => [r.rank, r.state, r.participants, r.population, r.share, r.benefits ?? "", r.benefits ? r.benefits * 12 : "", r.monthlyPerParticipant ?? "", r.latestLabel, "2024 ACS 1-year"])
  ));
  writeFileSync(`${outBase}.html`, html);
  if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

  console.log(lines.join("\n"));
  console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`)).join(" / ")}`);
  process.exit(0);
}

const rows = (await table(metric))
  .filter((r) => !["TOTAL", "Total", "United States"].includes(r.state))
  .sort((a, b) => b.value - a.value);

const highest = rows.slice(0, 10);
const az = rows.find((r) => r.state === "Arizona");
const hero = metric === "benefits" ? money(highest[0].value) : f0(highest[0].value);
const label = metric === "benefits" ? "SNAP benefits" : metric === "households" ? "SNAP households" : "SNAP participants";

const chartSVG = horizontalBarChart(
  highest.map((r) => ({ label: r.state, v: r.value, color: r.state === "Arizona" ? C.s2 : C.s1 })),
  { fmtTick: (v) => metric === "benefits" ? money(v) : `${Math.round(v / 1000)}k`, fmtVal: (v) => metric === "benefits" ? money(v) : f0(v) }
);

const html = cardHTML({
  kicker: "SNAP check",
  title: `States with the most ${label.replace("SNAP ", "SNAP ").toLowerCase().replace("snap", "SNAP")}`,
  hero,
  heroLabel: `${highest[0].state}; ${highest[0].latestLabel}`,
  chartSVG,
  source: "USDA Food and Nutrition Service",
  vintage: highest[0].latestLabel,
});

const lines = [
  `SNAP check (${stamp})`,
  "",
  `Metric: ${label}. Latest FNS column: ${highest[0].latestLabel}.`,
  az ? `Arizona: ${metric === "benefits" ? money(az.value) : f0(az.value)}; YoY ${az.yoy == null ? "n/a" : pct(az.yoy)}.` : "",
  "",
  "State | Latest | Month change | Year change",
  "---|---:|---:|---:",
  ...highest.map((r) => `${r.state} | ${metric === "benefits" ? money(r.value) : f0(r.value)} | ${r.mom == null ? "n/a" : pct(r.mom)} | ${r.yoy == null ? "n/a" : pct(r.yoy)}`),
  "",
  "Source: USDA Food and Nutrition Service SNAP state-level data tables.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["state", "metric", "latest", "prior_month", "prior_year", "month_change", "year_change", "latest_label"],
  rows.map((r) => [r.state, metric, r.value, r.priorMonth ?? "", r.priorYear ?? "", r.mom ?? "", r.yoy ?? "", r.latestLabel])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`)).join(" / ")}`);
