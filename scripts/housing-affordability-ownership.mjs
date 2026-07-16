#!/usr/bin/env node
// housing-affordability-ownership.mjs — does cheaper housing predict higher
// homeownership, across ALL states (not just anecdotally, e.g. West Virginia
// vs. DC)? Pulls median home value + homeownership rate for all 51
// state-equivalents from Census ACS, computes the correlation, and compares
// average homeownership in the 10 cheapest vs. 10 priciest states.
//
// Run:  node scripts/housing-affordability-ownership.mjs
//       node scripts/housing-affordability-ownership.mjs --no-image

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, engagementCTA, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

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
function stamp() {
  return new Date().toISOString().slice(0, 10);
}
function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}
function money(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

// Pearson correlation coefficient — how strongly two variables move together
// (-1 = perfect inverse, 0 = no relationship, +1 = perfect direct).
function correlation(pairs) {
  const n = pairs.length;
  const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
  const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (const [x, y] of pairs) { cov += (x - mx) * (y - my); vx += (x - mx) ** 2; vy += (y - my) ** 2; }
  return cov / Math.sqrt(vx * vy);
}

const key = getCensusKey();
if (!key) {
  console.error("Missing CENSUS_API_KEY. Add CENSUS_API_KEY=your_key to .env.");
  process.exit(1);
}
const noImage = process.argv.includes("--no-image");

async function acsAllStates(year, variables) {
  const qs = new URLSearchParams({ get: ["NAME", ...variables].join(","), for: "state:*", key });
  const res = await fetch(`https://api.census.gov/data/${year}/acs/acs1/profile?${qs}`);
  if (!res.ok) throw new Error(`Census HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const [header, ...rows] = await res.json();
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return rows
    .filter((r) => /^\d{2}$/.test(r[idx.state]) && Number(r[idx.state]) <= 56)
    .map((r) => ({ name: r[idx.NAME], ...Object.fromEntries(variables.map((v) => [v, Number(r[idx[v]])])) }));
}

async function latestYear() {
  for (const year of [2025, 2024, 2023, 2022, 2021]) {
    try {
      await acsAllStates(year, ["DP04_0046PE"]);
      return year;
    } catch { /* try an earlier vintage */ }
  }
  throw new Error("No ACS 1-year profile vintage available.");
}

console.log("Fetching homeownership rate + median home value for all states...");
const year = await latestYear();
const raw = await acsAllStates(year, ["DP04_0046PE", "DP04_0089E"]);
const states = raw
  .map((r) => ({ name: r.name, own: r.DP04_0046PE, val: r.DP04_0089E }))
  .filter((s) => Number.isFinite(s.own) && Number.isFinite(s.val));

const r = correlation(states.map((s) => [s.val, s.own]));
const byVal = [...states].sort((a, b) => a.val - b.val);
const cheapest10 = byVal.slice(0, 10);
const priciest10 = byVal.slice(-10);
const avgOwnCheap = cheapest10.reduce((s, x) => s + x.own, 0) / 10;
const avgOwnPricey = priciest10.reduce((s, x) => s + x.own, 0) / 10;

// 5 + 5 for the chart (not the full 10 + 10) — keeps bars readable at a
// fixed card size; the full 20-state breakdown is still in the data table/csv.
const cheapest5 = cheapest10.slice(0, 5), priciest5 = priciest10.slice(-5);
const chartStates = [...cheapest5, ...priciest5];
const chartSVG = horizontalBarChart(
  chartStates.map((s, i) => ({ label: s.name, v: s.own, color: i < 5 ? C.s2 : C.s1 })),
  { fmtTick: (v) => `${Math.round(v)}%`, fmtVal: (v) => `${v.toFixed(1)}%` }
);

const html = cardHTML({
  kicker: "Housing · national pattern",
  title: "Cheaper states to buy a home have higher homeownership rates",
  hero: `${avgOwnCheap.toFixed(0)}% vs ${avgOwnPricey.toFixed(0)}%`,
  heroLabel: "avg. homeownership: 10 cheapest vs. 10 priciest states",
  chartSVG,
  source: "U.S. Census Bureau ACS 1-year Data Profile",
  vintage: String(year),
});

const facebook = [
  `Across all 51 states, the correlation between median home value and homeownership rate is ${r.toFixed(2)} — a real, moderately strong pattern, not a coincidence between any two states.`,
  "",
  `The 10 states with the cheapest homes average ${avgOwnCheap.toFixed(1)}% homeownership. The 10 most expensive average ${avgOwnPricey.toFixed(1)}%. Cheaper housing means more people can actually afford to buy instead of rent.`,
  "",
  `Cheapest 10: ${cheapest10.map((s) => `${s.name} (${money(s.val)})`).join(", ")}.`,
  `Priciest 10: ${priciest10.map((s) => `${s.name} (${money(s.val)})`).join(", ")}.`,
  "",
  "Caveat: correlation, not proof of pure causation — cheaper states also tend to have older populations, more rural housing stock, and less population turnover, which independently push ownership rates up too.",
  "",
  "Source: U.S. Census Bureau, American Community Survey 1-year estimates.",
  "",
  engagementCTA("ranking", `housing-ownership-${stamp()}`),
];

const lines = [
  `Housing affordability vs. homeownership (${stamp()})`,
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
  "",
  "Data table",
  "----------",
  `Correlation (home value vs. homeownership rate, all 51 states): ${r.toFixed(3)}`,
  `10 cheapest states avg. homeownership: ${avgOwnCheap.toFixed(1)}%`,
  `10 priciest states avg. homeownership: ${avgOwnPricey.toFixed(1)}%`,
  "",
  "State | Median home value | Homeownership rate | Group",
  "---|---:|---:|---",
  ...cheapest10.map((s) => `${s.name} | ${money(s.val)} | ${s.own.toFixed(1)}% | Cheapest 10`),
  ...priciest10.map((s) => `${s.name} | ${money(s.val)} | ${s.own.toFixed(1)}% | Priciest 10`),
  "",
  "Source: U.S. Census Bureau ACS 1-year Data Profile.",
];

mkdirSync(SOCIAL, { recursive: true });
const outBase = path.join(SOCIAL, `housing-affordability-ownership-${stamp()}`);
writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["state", "median_home_value", "homeownership_rate_pct", "group"],
  [...cheapest10.map((s) => [s.name, s.val, s.own, "cheapest10"]), ...priciest10.map((s) => [s.name, s.val, s.own, "priciest10"])]
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
