#!/usr/bin/env node
// Share of adults (25+) with a bachelor's degree or higher, by state, from
// Census ACS.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, censusRows, envValue, pct, rel } from "./lib/data-common.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-college-graduates-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

let year, acs;
for (const candidate of [2024, 2023, 2022]) {
  try {
    acs = await censusRows(candidate, "acs/acs1/profile", ["DP02_0068PE"], "state:*", key);
    if (acs.length) { year = candidate; break; }
  } catch { /* try prior ACS vintage */ }
}
if (!year) throw new Error("No Census ACS educational-attainment vintage available.");

const rows = acs
  .map((r) => ({ state: r.NAME, stateCode: r.state, share: Number(r.DP02_0068PE) }))
  .filter((r) => r.stateCode !== "72" && r.share > 0)
  .sort((a, b) => b.share - a.share)
  .map((r, i) => ({ ...r, rank: i + 1 }));

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 5);
const bottom = rows.slice(-5).reverse();

const chartRows = [...top, ...bottom.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.share, color: r.state === "Arizona" ? C.s2 : r.rank <= 5 ? C.s1 : C.neg })),
  { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => pct(v) }
);

const html = cardHTML({
  kicker: "Education check",
  title: "Share of adults with a bachelor's degree, by state",
  hero: pct(top[0].share),
  heroLabel: `${top[0].state}; adults 25+ with a bachelor's degree or higher, ${year}`,
  chartSVG, source: "U.S. Census Bureau ACS", vintage: String(year),
});

const facebook = [
  `${pct(top[0].share)} of adults in ${top[0].state} hold a bachelor's degree — ${(top[0].share / bottom[0].share).toFixed(1)}x the share in ${bottom[0].state}. Every state, ranked:`,
  "",
  `Census ACS ${year} data — share of adults 25 and older with a bachelor's degree or higher, by state.`,
  "",
  "Highest share:", ...top.map((r) => `#${r.rank} ${r.state}: ${pct(r.share)}`), "",
  "Lowest share:", ...bottom.map((r) => `#${r.rank} ${r.state}: ${pct(r.share)}`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${pct(az.share)}.` : "",
  "",
  "Note: this counts adults with at least a bachelor's degree, not overall educational quality — a state can rank lower here while still having strong schools and high school graduation rates.",
  "",
  "Source: U.S. Census Bureau American Community Survey, 1-year estimates.",
].filter(Boolean);

const lines = [
  `State college graduates watch (${STAMP})`, "", `Census ACS ${year} 1-year estimates.`, "",
  "Rank | State | Bachelor's degree or higher",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${pct(r.share)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "bachelors_or_higher_pct"], rows.map((r) => [r.rank, r.state, r.share])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
