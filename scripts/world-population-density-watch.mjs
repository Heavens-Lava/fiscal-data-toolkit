#!/usr/bin/env node
// Population compared to landmass — people per square km, by country, from
// World Bank population and land-area data.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, num, rel } from "./lib/data-common.mjs";
import { worldBankLatestByCountry } from "./lib/world-bank.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `world-population-density-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const [pop, land] = await Promise.all([
  worldBankLatestByCountry("SP.POP.TOTL"),
  worldBankLatestByCountry("AG.LND.TOTL.K2"),
]);
const landByCode = new Map(land.map((r) => [r.code, r.value]));

const rows = pop
  .map((r) => ({ ...r, landKm2: landByCode.get(r.code) }))
  .filter((r) => Number.isFinite(r.landKm2) && r.landKm2 > 1000) // drop tiny territories/data noise
  .map((r) => ({ ...r, density: r.value / r.landKm2 }))
  .sort((a, b) => b.density - a.density)
  .map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error("No matched World Bank population/land-area rows.");

const us = rows.find((r) => r.code === "USA");
const top = rows.slice(0, 10);
const bottom = rows.slice(-5).reverse();

const chartSVG = horizontalBarChart(
  top.map((r) => ({ label: `#${r.rank} ${r.name}`, v: r.density, color: r.code === "USA" ? C.s2 : C.s1 })),
  { fmtTick: (v) => `${Math.round(v)}`, fmtVal: (v) => `${Math.round(v).toLocaleString()}/km²` }
);

const html = cardHTML({
  kicker: "Population density check",
  title: "Which countries are the most densely populated?",
  hero: `${Math.round(top[0].density).toLocaleString()}/km²`,
  heroLabel: `${top[0].name}; people per square km`,
  chartSVG, source: "World Bank Open Data", vintage: `${rows[0].year}`,
});

const facebook = [
  "Which countries are actually the most crowded?",
  "",
  "World Bank data — population per square kilometer of land area, countries with at least 1,000 km² excluded from noise (city-states like Monaco/Singapore aside).",
  "",
  "Most densely populated:", ...top.map((r) => `#${r.rank} ${r.name}: ${Math.round(r.density).toLocaleString()} people/km²`), "",
  "Least densely populated:", ...bottom.map((r) => `#${r.rank} ${r.name}: ${r.density.toFixed(1)} people/km²`), "",
  us ? `United States: #${us.rank} of ${rows.length}, ${Math.round(us.density)} people/km² (${num(us.value)} people across ${num(us.landKm2)} km²).` : "",
  "",
  "Note: a country can have a huge population (like China or the US) but low overall density if much of its land is sparsely inhabited — this measures the whole country's average, not where people actually cluster within it.",
  "",
  "Source: World Bank Open Data, indicators SP.POP.TOTL and AG.LND.TOTL.K2.",
].filter(Boolean);

const lines = [
  `World population density watch (${STAMP})`, "", "World Bank Open Data, population per km² of land area.", "",
  "Rank | Country | Population | Land area (km²) | Density (people/km²)",
  "---:|---|---:|---:|---:",
  ...rows.map((r) => `${r.rank} | ${r.name} | ${num(r.value)} | ${num(r.landKm2)} | ${r.density.toFixed(1)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "country", "code", "population", "land_area_km2", "density_per_km2"], rows.map((r) => [r.rank, r.name, r.code, r.value, r.landKm2, r.density])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
