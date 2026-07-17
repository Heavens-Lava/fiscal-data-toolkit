#!/usr/bin/env node
// Median age by state, from Census ACS.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, censusRows, envValue, rel } from "./lib/data-common.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-median-age-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

let year, acs;
for (const candidate of [2024, 2023, 2022]) {
  try {
    acs = await censusRows(candidate, "acs/acs1/profile", ["DP05_0018E"], "state:*", key);
    if (acs.length) { year = candidate; break; }
  } catch { /* try prior ACS vintage */ }
}
if (!year) throw new Error("No Census ACS median age vintage available.");

const rows = acs
  .map((r) => ({ state: r.NAME, stateCode: r.state, age: Number(r.DP05_0018E) }))
  .filter((r) => r.stateCode !== "72" && r.age > 0)
  .sort((a, b) => b.age - a.age)
  .map((r, i) => ({ ...r, rank: i + 1 }));

const az = rows.find((r) => r.state === "Arizona");
const oldest = rows.slice(0, 5);
const youngest = rows.slice(-5).reverse();

const chartRows = [...oldest, ...youngest.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.age, color: r.state === "Arizona" ? C.s2 : r.rank <= 5 ? C.s1 : C.neg })),
  { fmtTick: (v) => v.toFixed(0), fmtVal: (v) => `${v.toFixed(1)} yrs` }
);

const html = cardHTML({
  kicker: "Population check",
  title: "Median age by state",
  hero: oldest[0].age.toFixed(1),
  heroLabel: `${oldest[0].state}; median age, ${year}`,
  chartSVG, source: "U.S. Census Bureau ACS", vintage: String(year),
});

const facebook = [
  "Which states have the oldest — and youngest — populations?",
  "",
  `Census ACS ${year} data — median age by state.`,
  "",
  "Oldest median age:", ...oldest.map((r) => `#${r.rank} ${r.state}: ${r.age.toFixed(1)} years`), "",
  "Youngest median age:", ...youngest.map((r) => `#${r.rank} ${r.state}: ${r.age.toFixed(1)} years`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${az.age.toFixed(1)} years.` : "",
  "",
  "Note: median age reflects a mix of factors — retiree migration, birth rates, and college/military populations can all pull a state's median in either direction.",
  "",
  "Source: U.S. Census Bureau American Community Survey, 1-year estimates.",
].filter(Boolean);

const lines = [
  `State median age watch (${STAMP})`, "", `Census ACS ${year} 1-year estimates.`, "",
  "Rank | State | Median age",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${r.age.toFixed(1)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "median_age"], rows.map((r) => [r.rank, r.state, r.age])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
