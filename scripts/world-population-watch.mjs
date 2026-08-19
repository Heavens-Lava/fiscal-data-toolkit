#!/usr/bin/env node
// World population comparison, from World Bank data across every country.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, num, rel } from "./lib/data-common.mjs";
import { worldBankLatestByCountry } from "./lib/world-bank.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `world-population-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const all = await worldBankLatestByCountry("SP.POP.TOTL");
if (!all.length) throw new Error("No World Bank population rows.");

const yearCounts = new Map();
for (const r of all) yearCounts.set(r.year, (yearCounts.get(r.year) || 0) + 1);
const year = [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
const rows = all.filter((r) => r.year === year).sort((a, b) => b.value - a.value).map((r, i) => ({ ...r, rank: i + 1 }));

const us = rows.find((r) => r.code === "USA");
const top = rows.slice(0, 10);
const worldTotal = rows.reduce((s, r) => s + r.value, 0);

const chartSVG = horizontalBarChart(
  top.map((r) => ({ label: `#${r.rank} ${r.name}`, v: r.value, color: r.code === "USA" ? C.s2 : C.s1 })),
  { fmtTick: (v) => `${(v / 1e6).toFixed(0)}M`, fmtVal: (v) => num(v) }
);

const html = cardHTML({
  kicker: "Global population check",
  title: "Which countries have the largest populations?",
  hero: `${(top[0].value / 1e6).toFixed(0)}M`,
  heroLabel: `${top[0].name}; population, ${year}`,
  chartSVG, source: "World Bank Open Data", vintage: year,
});

const facebook = [
  `${top[0].name} has ${(top[0].value / 1e6).toFixed(0)}M people — about ${((top[0].value / worldTotal) * 100).toFixed(0)}% of everyone on Earth. Every country, ranked:`,
  "",
  `World Bank data, ${year} — total population by country.`,
  "",
  "Top 10:", ...top.map((r) => `#${r.rank} ${r.name}: ${num(r.value)} (${((r.value / worldTotal) * 100).toFixed(1)}% of world population)`), "",
  us ? `United States: #${us.rank} of ${rows.length}, ${num(us.value)}.` : "",
  "",
  `For scale: the top 2 countries alone (${top[0].name} and ${top[1].name}) hold ${(((top[0].value + top[1].value) / worldTotal) * 100).toFixed(1)}% of everyone counted here.`,
  "",
  "Source: World Bank Open Data, indicator SP.POP.TOTL.",
].filter(Boolean);

const lines = [
  `World population watch (${STAMP})`, "", `World Bank Open Data, ${year} total population by country.`, "",
  "Rank | Country | Population",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.name} | ${num(r.value)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "country", "code", "population"], rows.map((r) => [r.rank, r.name, r.code, r.value])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
