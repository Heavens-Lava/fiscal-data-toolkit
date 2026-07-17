#!/usr/bin/env node
// Share of households with a broadband internet subscription, by state,
// from Census ACS. Rendered as a real state outline map.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cardHTML, screenshot, stateOutlineMap, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, censusRows, envValue, pct, rel } from "./lib/data-common.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-broadband-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

let year, acs;
for (const candidate of [2024, 2023, 2022]) {
  try {
    acs = await censusRows(candidate, "acs/acs1/profile", ["DP02_0154PE"], "state:*", key);
    if (acs.length) { year = candidate; break; }
  } catch { /* try prior ACS vintage */ }
}
if (!year) throw new Error("No Census ACS broadband vintage available.");

const stateByFips = new Map(STATES.map((s) => [s.fips, s]));
const rows = acs
  .map((r) => {
    const state = stateByFips.get(r.state);
    return state ? { state: state.name, abbr: state.abbr, share: Number(r.DP02_0154PE) } : null;
  })
  .filter((r) => r && r.share > 0)
  .sort((a, b) => b.share - a.share)
  .map((r, i) => ({ ...r, rank: i + 1 }));

const az = rows.find((r) => r.abbr === "AZ");
const top = rows.slice(0, 5);
const bottom = rows.slice(-5).reverse();

const chartSVG = stateOutlineMap(rows.map((r) => ({ ...r, v: r.share })), { fmtVal: (v) => pct(v, 1) });
const html = cardHTML({
  kicker: "Internet access check",
  title: "Share of households with broadband, by state",
  hero: pct(top[0].share),
  heroLabel: `${top[0].state}; households with a broadband subscription, ${year}`,
  chartSVG, source: "U.S. Census Bureau ACS", vintage: String(year),
});

const facebook = [
  "Which states have the best broadband access?",
  "",
  `Census ACS ${year} data — share of households with a broadband internet subscription, by state.`,
  "",
  "Highest share:", ...top.map((r) => `#${r.rank} ${r.state}: ${pct(r.share)}`), "",
  "Lowest share:", ...bottom.map((r) => `#${r.rank} ${r.state}: ${pct(r.share)}`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${pct(az.share)}.` : "",
  "",
  "Note: this measures households that report paying for a broadband subscription — it doesn't capture speed, reliability, or whether broadband is even available where they live.",
  "",
  "Source: U.S. Census Bureau American Community Survey, 1-year estimates.",
].filter(Boolean);

const lines = [
  `State broadband watch (${STAMP})`, "", `Census ACS ${year} 1-year estimates.`, "",
  "Rank | State | Broadband share",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${pct(r.share)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "broadband_share_pct"], rows.map((r) => [r.rank, r.state, r.share])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
