#!/usr/bin/env node
// Which states Americans are actually leaving vs. moving to — net domestic
// migration by state, Census Bureau Population Estimates Program. Keyless:
// PEP's migration components are no longer on the API (retired after the
// 2020 vintage), so this reads the official flat-file release directly.
//
// Run:  node scripts/state-migration-watch.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, num, rel } from "./lib/data-common.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-migration-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const VINTAGE_YEAR = 2024;
const url = `https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/state/totals/NST-EST${VINTAGE_YEAR}-ALLDATA.csv`;
const res = await fetch(url, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
if (!res.ok) throw new Error(`Census PEP flat file HTTP ${res.status}`);
const text = await res.text();
const [header, ...csvLines] = text.trim().split("\n");
const cols = header.split(",");
const idx = Object.fromEntries(cols.map((c, i) => [c, i]));
const domesticCol = `DOMESTICMIG${VINTAGE_YEAR}`;
const rateCol = `RDOMESTICMIG${VINTAGE_YEAR}`;

const rows = csvLines
  .map((l) => l.split(","))
  .filter((r) => r[idx.SUMLEV] === "040")
  .map((r) => ({
    state: r[idx.NAME],
    net: Number(r[idx[domesticCol]]),
    ratePer1000: Number(r[idx[rateCol]]),
  }))
  .filter((r) => Number.isFinite(r.net) && Number.isFinite(r.ratePer1000))
  .sort((a, b) => b.ratePer1000 - a.ratePer1000)
  .map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error("No Census PEP state migration rows parsed.");

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 6);
const bottom = rows.slice(-6).reverse();
const chartRows = [...top, ...bottom.reverse()];

const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({
    label: `#${r.rank} ${r.state}`, v: r.ratePer1000,
    color: r.ratePer1000 >= 0 ? C.s1 : C.neg,
  })),
  { fmtTick: (v) => v.toFixed(0), fmtVal: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}/1,000` }
);

const html = cardHTML({
  kicker: "State migration check",
  title: "Which states are Americans leaving — and moving to?",
  hero: `${top[0].ratePer1000 >= 0 ? "+" : ""}${top[0].ratePer1000.toFixed(1)}`,
  heroLabel: `${top[0].state}; net domestic migration per 1,000 residents, ${VINTAGE_YEAR}`,
  chartSVG, source: "U.S. Census Bureau, Population Estimates Program", vintage: String(VINTAGE_YEAR),
});

const facebook = [
  `${top[0].state} gained ${top[0].ratePer1000.toFixed(1)} residents per 1,000 to domestic migration in ${VINTAGE_YEAR}, while ${bottom.at(-1).state} lost ${Math.abs(bottom.at(-1).ratePer1000).toFixed(1)} per 1,000. Every state, ranked:`,
  "",
  `Census Bureau data, ${VINTAGE_YEAR} — net domestic migration (people who moved in from another state, minus people who moved out), per 1,000 residents:`,
  "",
  "Gaining the most:", ...top.map((r) => `#${r.rank} ${r.state}: ${r.ratePer1000 >= 0 ? "+" : ""}${r.ratePer1000.toFixed(1)}/1,000 (${r.net >= 0 ? "+" : ""}${num(r.net)} people net)`), "",
  "Losing the most:", ...bottom.map((r) => `#${r.rank} ${r.state}: ${r.ratePer1000.toFixed(1)}/1,000 (${num(r.net)} people net)`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${az.ratePer1000 >= 0 ? "+" : ""}${az.ratePer1000.toFixed(1)}/1,000.` : "",
  "",
  "This is domestic migration only — Americans moving between states — and doesn't include international immigration or births/deaths, which also drive total population change. A per-1,000-residents rate is used instead of raw totals so small and large states are directly comparable.",
  "",
  "Source: U.S. Census Bureau, Vintage 2024 Population Estimates.",
].filter(Boolean);

const lines = [
  `State migration watch (${STAMP})`, "", `Census Bureau Population Estimates, net domestic migration, ${VINTAGE_YEAR}.`, "",
  "Rank | State | Net migration (people) | Rate per 1,000 residents",
  "---:|---|---:|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${r.net >= 0 ? "+" : ""}${num(r.net)} | ${r.ratePer1000 >= 0 ? "+" : ""}${r.ratePer1000.toFixed(1)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "net_domestic_migration", "rate_per_1000", "vintage"], rows.map((r) => [r.rank, r.state, r.net, r.ratePer1000, VINTAGE_YEAR])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
