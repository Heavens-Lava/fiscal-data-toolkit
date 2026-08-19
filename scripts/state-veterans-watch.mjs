#!/usr/bin/env node
// Share of the civilian adult population who are veterans, by state, from
// Census ACS. Percent-based (not raw counts) so it's a fair per-capita
// comparison rather than just ranking the biggest states.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, censusRows, envValue, pct, rel } from "./lib/data-common.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-veterans-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

let year, acs;
for (const candidate of [2024, 2023, 2022]) {
  try {
    acs = await censusRows(candidate, "acs/acs1/profile", ["DP02_0070PE"], "state:*", key);
    if (acs.length) { year = candidate; break; }
  } catch { /* try prior ACS vintage */ }
}
if (!year) throw new Error("No Census ACS veteran-share vintage available.");

const rows = acs
  .map((r) => ({ state: r.NAME, stateCode: r.state, share: Number(r.DP02_0070PE) }))
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
  kicker: "Veterans check",
  title: "Share of adults who are veterans, by state",
  hero: pct(top[0].share),
  heroLabel: `${top[0].state}; share of civilian adults who are veterans, ${year}`,
  chartSVG, source: "U.S. Census Bureau ACS", vintage: String(year),
});

const ratio = top[0].share / bottom[0].share;
const facebook = [
  `${top[0].state}: ${pct(top[0].share)} of adults are veterans — ${ratio.toFixed(1)}x ${bottom[0].state}'s share. Every state's veteran population, ranked:`,
  "",
  `Census ACS ${year} data — share of the civilian population 18+ who are veterans, by state.`,
  "",
  "Highest veteran share:", ...top.map((r) => `#${r.rank} ${r.state}: ${pct(r.share)}`), "",
  "Lowest veteran share:", ...bottom.map((r) => `#${r.rank} ${r.state}: ${pct(r.share)}`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${pct(az.share)}.` : "",
  "",
  "Note: this reflects each state's share of adult residents who are veterans, not the total number of veterans living there — proximity to military bases and retiree migration both shape these numbers.",
  "",
  "Source: U.S. Census Bureau American Community Survey, 1-year estimates.",
].filter(Boolean);

const lines = [
  `State veterans watch (${STAMP})`, "", `Census ACS ${year} 1-year estimates.`, "",
  "Rank | State | Veteran share of adults",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${pct(r.share)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "veteran_share_pct"], rows.map((r) => [r.rank, r.state, r.share])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
