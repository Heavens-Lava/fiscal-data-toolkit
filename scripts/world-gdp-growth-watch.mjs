#!/usr/bin/env node
// Which countries' economies are growing the fastest, from World Bank real
// GDP growth data across every country (not just a handful).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, pct, rel } from "./lib/data-common.mjs";
import { worldBankLatestByCountry } from "./lib/world-bank.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `world-gdp-growth-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const all = await worldBankLatestByCountry("NY.GDP.MKTP.KD.ZG");
if (!all.length) throw new Error("No World Bank GDP growth rows.");

// Keep only the most common reporting year — mixing a stale one-off with
// the current cohort would misleadingly compare different years' growth.
const yearCounts = new Map();
for (const r of all) yearCounts.set(r.year, (yearCounts.get(r.year) || 0) + 1);
const year = [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
const rows = all.filter((r) => r.year === year).sort((a, b) => b.value - a.value).map((r, i) => ({ ...r, rank: i + 1 }));
const excluded = all.length - rows.length;

const us = rows.find((r) => r.code === "USA");
const top = rows.slice(0, 10);
const bottom = rows.slice(-5).reverse();

const chartSVG = horizontalBarChart(
  top.map((r) => ({ label: `#${r.rank} ${r.name}`, v: r.value, color: r.code === "USA" ? C.s2 : C.s1 })),
  { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => pct(v) }
);

const html = cardHTML({
  kicker: "Global growth check",
  title: "Which countries' economies are growing fastest?",
  hero: pct(top[0].value),
  heroLabel: `${top[0].name}; real GDP growth, ${year}`,
  chartSVG, source: "World Bank Open Data", vintage: year,
});

const facebook = [
  `${top[0].name}'s economy grew ${pct(top[0].value)} in ${year} — the fastest of any country with complete data. Every country, ranked:`,
  "",
  `World Bank data, ${year} — real (inflation-adjusted) GDP growth by country, ${rows.length} countries with complete ${year} data.`,
  "",
  "Fastest growing:", ...top.map((r) => `#${r.rank} ${r.name}: ${pct(r.value)}`), "",
  "Shrinking / slowest:", ...bottom.map((r) => `#${r.rank} ${r.name}: ${pct(r.value)}`), "",
  us ? `United States: #${us.rank} of ${rows.length}, ${pct(us.value)}.` : "",
  "",
  "Note: fast growth often means a smaller or recovering economy (a resource boom, post-crisis rebound) rather than a large, mature one — see our GDP-by-country post for the actual size ranking.",
  "",
  `Source: World Bank Open Data, indicator NY.GDP.MKTP.KD.ZG.${excluded ? ` ${excluded} countries excluded for lacking complete ${year} data.` : ""}`,
].filter(Boolean);

const lines = [
  `World GDP growth watch (${STAMP})`, "", `World Bank Open Data, ${year} real GDP growth by country.`, "",
  "Rank | Country | Real GDP growth",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.name} | ${pct(r.value)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "country", "code", "real_gdp_growth_pct"], rows.map((r) => [r.rank, r.name, r.code, r.value])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
