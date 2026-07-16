#!/usr/bin/env node
// Median household income by state, from Census ACS.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, censusRows, envValue, money, rel } from "./lib/data-common.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-income-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

let year, acs;
for (const candidate of [2024, 2023, 2022]) {
  try {
    acs = await censusRows(candidate, "acs/acs1/profile", ["DP03_0062E"], "state:*", key);
    if (acs.length) { year = candidate; break; }
  } catch { /* try prior ACS vintage */ }
}
if (!year) throw new Error("No Census ACS median household income vintage available.");

const rows = acs
  .map((r) => ({ state: r.NAME, stateCode: r.state, income: Number(r.DP03_0062E) }))
  .filter((r) => r.stateCode !== "72" && r.income > 0)
  .sort((a, b) => b.income - a.income)
  .map((r, i) => ({ ...r, rank: i + 1 }));

const az = rows.find((r) => r.state === "Arizona");
const highest = rows.slice(0, 5);
const lowest = rows.slice(-5).reverse();
const nationalMedian = [...rows].sort((a, b) => a.income - b.income)[Math.floor(rows.length / 2)].income;

const chartRows = [...highest, ...lowest.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.income, color: r.state === "Arizona" ? C.s2 : r.rank <= 5 ? C.s1 : C.neg })),
  { fmtTick: (v) => `$${Math.round(v / 1000)}k`, fmtVal: money }
);

const html = cardHTML({
  kicker: "Household income check",
  title: "Median household income by state",
  hero: money(highest[0].income),
  heroLabel: `${highest[0].state}; median household income, ${year}`,
  chartSVG, source: "U.S. Census Bureau ACS", vintage: String(year),
});

const facebook = [
  "Which states have the highest median household income?",
  "",
  `Census ACS ${year} data — median household income by state.`,
  "",
  "Highest:", ...highest.map((r) => `#${r.rank} ${r.state}: ${money(r.income)}`), "",
  "Lowest:", ...lowest.map((r) => `#${r.rank} ${r.state}: ${money(r.income)}`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${money(az.income)}.` : "",
  "",
  "Note: this is median household income, not per-person income or wealth — a state's cost of living can be very different from another's, so the same dollar figure doesn't buy the same lifestyle everywhere.",
  "",
  "Source: U.S. Census Bureau American Community Survey, 1-year estimates.",
].filter(Boolean);

const lines = [
  `State income watch (${STAMP})`, "", `Census ACS ${year} 1-year estimates.`, "",
  "Rank | State | Median household income",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${money(r.income)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "median_household_income"], rows.map((r) => [r.rank, r.state, r.income])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
