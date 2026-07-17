#!/usr/bin/env node
// Share of residents (5+) who speak a language other than English at home,
// by state, from Census ACS.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, censusRows, envValue, pct, rel } from "./lib/data-common.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-language-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

let year, acs;
for (const candidate of [2024, 2023, 2022]) {
  try {
    acs = await censusRows(candidate, "acs/acs1/profile", ["DP02_0114PE"], "state:*", key);
    if (acs.length) { year = candidate; break; }
  } catch { /* try prior ACS vintage */ }
}
if (!year) throw new Error("No Census ACS language vintage available.");

const stateByFips = new Map(STATES.map((s) => [s.fips, s]));
const rows = acs
  .map((r) => {
    const state = stateByFips.get(r.state);
    return state ? { state: state.name, abbr: state.abbr, share: Number(r.DP02_0114PE) } : null;
  })
  .filter((r) => r && r.share > 0)
  .sort((a, b) => b.share - a.share)
  .map((r, i) => ({ ...r, rank: i + 1 }));

const az = rows.find((r) => r.abbr === "AZ");
const top = rows.slice(0, 5);
const bottom = rows.slice(-5).reverse();

const chartRows = [...top, ...bottom.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.share, color: r.abbr === "AZ" ? C.s2 : r.rank <= 5 ? C.s1 : C.neg })),
  { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => pct(v) }
);

const html = cardHTML({
  kicker: "Language check",
  title: "Share who speak a language other than English at home",
  hero: pct(top[0].share),
  heroLabel: `${top[0].state}; share speaking another language at home, ${year}`,
  chartSVG, source: "U.S. Census Bureau ACS", vintage: String(year),
});

const facebook = [
  "Which states have the most linguistic diversity at home?",
  "",
  `Census ACS ${year} data — share of residents age 5+ who speak a language other than English at home, by state.`,
  "",
  "Highest share:", ...top.map((r) => `#${r.rank} ${r.state}: ${pct(r.share)}`), "",
  "Lowest share:", ...bottom.map((r) => `#${r.rank} ${r.state}: ${pct(r.share)}`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${pct(az.share)}.` : "",
  "",
  "Note: this counts anyone who speaks another language at home, regardless of English proficiency — most people in this group also speak English well or very well.",
  "",
  "Source: U.S. Census Bureau American Community Survey, 1-year estimates.",
].filter(Boolean);

const lines = [
  `State language watch (${STAMP})`, "", `Census ACS ${year} 1-year estimates.`, "",
  "Rank | State | Non-English at home",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${pct(r.share)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "non_english_at_home_pct"], rows.map((r) => [r.rank, r.state, r.share])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
