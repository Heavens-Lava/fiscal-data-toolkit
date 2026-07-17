#!/usr/bin/env node
// Average household size by state, from Census ACS.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, censusRows, envValue, rel } from "./lib/data-common.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-household-size-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

let year, acs;
for (const candidate of [2024, 2023, 2022]) {
  try {
    acs = await censusRows(candidate, "acs/acs1/profile", ["DP02_0016E"], "state:*", key);
    if (acs.length) { year = candidate; break; }
  } catch { /* try prior ACS vintage */ }
}
if (!year) throw new Error("No Census ACS household-size vintage available.");

const rows = acs
  .map((r) => ({ state: r.NAME, stateCode: r.state, size: Number(r.DP02_0016E) }))
  .filter((r) => r.stateCode !== "72" && r.size > 0)
  .sort((a, b) => b.size - a.size)
  .map((r, i) => ({ ...r, rank: i + 1 }));

const az = rows.find((r) => r.state === "Arizona");
const largest = rows.slice(0, 5);
const smallest = rows.slice(-5).reverse();

const chartRows = [...largest, ...smallest.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.size, color: r.state === "Arizona" ? C.s2 : r.rank <= 5 ? C.s1 : C.neg })),
  { fmtTick: (v) => v.toFixed(1), fmtVal: (v) => `${v.toFixed(2)} people` }
);

const html = cardHTML({
  kicker: "Household check",
  title: "Average household size by state",
  hero: largest[0].size.toFixed(2),
  heroLabel: `${largest[0].state}; average household size, ${year}`,
  chartSVG, source: "U.S. Census Bureau ACS", vintage: String(year),
});

const facebook = [
  "Where do people live in the biggest — and smallest — households?",
  "",
  `Census ACS ${year} data — average household size by state.`,
  "",
  "Largest households:", ...largest.map((r) => `#${r.rank} ${r.state}: ${r.size.toFixed(2)} people`), "",
  "Smallest households:", ...smallest.map((r) => `#${r.rank} ${r.state}: ${r.size.toFixed(2)} people`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${az.size.toFixed(2)} people.` : "",
  "",
  "Note: household size reflects a mix of factors — multigenerational living, family size, birth rates, and cost of living can all push this number up or down.",
  "",
  "Source: U.S. Census Bureau American Community Survey, 1-year estimates.",
].filter(Boolean);

const lines = [
  `State household size watch (${STAMP})`, "", `Census ACS ${year} 1-year estimates.`, "",
  "Rank | State | Average household size",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${r.size.toFixed(2)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "avg_household_size"], rows.map((r) => [r.rank, r.state, r.size])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
