#!/usr/bin/env node
// world-life-expectancy-ranked.mjs - full best-vs-worst ranked infographic of
// life expectancy across all ~217 World Bank-tracked countries (not a top-10
// cutoff) — the "Visual Capitalist ranked infographic" format, built on an
// audited hard-data metric (WHO/World Bank) instead of a survey-composite
// index. World Bank Open Data, no API key required.
//
// Run:  node scripts/world-life-expectancy-ranked.mjs
//       node scripts/world-life-expectancy-ranked.mjs --top 25
//       node scripts/world-life-expectancy-ranked.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flagDataUriMap, rankedTwoColumnHTML, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const WB = "https://api.worldbank.org/v2";
const INDICATOR = "SP.DYN.LE00.IN"; // Life expectancy at birth, total (years)
const DOMAIN = [40, 90]; // shared bar-scaling range across both columns

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank HTTP ${res.status} for ${url}`);
  const json = await res.json();
  if (!Array.isArray(json) || !Array.isArray(json[1])) throw new Error("World Bank returned no data");
  return json[1];
}

const topN = Number(argValue("--top", "20"));
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `world-life-expectancy-ranked-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

console.log("  Fetching country metadata + life expectancy for all countries from World Bank...");
const [countryRows, leRows] = await Promise.all([
  getJSON(`${WB}/country?format=json&per_page=300`),
  getJSON(`${WB}/country/all/indicator/${INDICATOR}?format=json&per_page=20000&mrnev=1`),
]);

const countries = new Map(
  countryRows
    .filter((c) => c.region && c.region.value !== "Aggregates")
    .map((c) => [c.id, c])
);

const rows = leRows
  .filter((r) => r.value != null && countries.has(r.countryiso3code))
  .map((r) => ({
    name: countries.get(r.countryiso3code).name,
    iso3: r.countryiso3code,
    iso2: countries.get(r.countryiso3code).iso2Code,
    value: r.value,
    date: r.date,
  }))
  .sort((a, b) => b.value - a.value);

if (rows.length < topN * 2) throw new Error(`Only ${rows.length} countries had data — expected at least ${topN * 2}`);

const highest = rows.slice(0, topN);
const lowest = rows.slice(-topN).reverse();
const vintage = rows[0].date;

const usRank = rows.findIndex((r) => r.iso3 === "USA") + 1;
const us = rows.find((r) => r.iso3 === "USA");
const gap = highest[0].value - lowest[0].value;

console.log("  Resolving flag images (cached locally after first fetch)...");
const flagMap = await flagDataUriMap([...highest, ...lowest].map((r) => r.iso2));
const withFlags = (list) => list.map((r) => ({ ...r, flagSrc: flagMap.get((r.iso2 || "").toLowerCase()) }));
const highestFlagged = withFlags(highest);
const lowestFlagged = withFlags(lowest);

const html = rankedTwoColumnHTML({
  kicker: "Life expectancy check",
  title: `Life expectancy by country, ${vintage} — highest vs. lowest of ${rows.length} countries`,
  leftLabel: "Highest",
  rightLabel: "Lowest",
  leftRows: highestFlagged,
  rightRows: lowestFlagged,
  domainMin: DOMAIN[0],
  domainMax: DOMAIN[1],
  fmtVal: (v) => v.toFixed(1),
  source: "World Bank Open Data (WHO-sourced)",
  vintage,
});

const facebook = [
  "Life expectancy check:",
  "",
  `Across ${rows.length} countries with World Bank data (${vintage}), life expectancy at birth ranges from ${highest[0].value.toFixed(1)} years (${highest[0].name}) down to ${lowest[0].value.toFixed(1)} years (${lowest[0].name}) — a gap of ${gap.toFixed(1)} years depending entirely on where you're born.`,
  "",
  `Where's the US? ${ordinal(usRank)} of ${rows.length}, at ${us.value.toFixed(1)} years — behind every country in the "Highest" column here despite having, by far, the largest economy and highest health spending per person of any large country. Money alone doesn't buy the longest life expectancy; health-system design, inequality, and lifestyle factors matter as much as GDP.`,
  "",
  "Caveat: this is life expectancy at birth (a period estimate based on current mortality rates, not a guarantee for anyone born today), sourced from WHO estimates via the World Bank. A few very small territories/city-states with limited populations (e.g. Monaco, San Marino) can rank at the extremes partly due to small-sample effects.",
  "",
  "Real numbers, real source — World Bank Open Data, life expectancy indicator:",
  "https://data.worldbank.org/indicator/SP.DYN.LE00.IN",
];

const lines = [
  `Life expectancy check (${stamp})`,
  "",
  `${rows.length} countries with data, vintage ${vintage}`,
  `Highest: ${highest[0].name} (${highest[0].value.toFixed(1)}) | Lowest: ${lowest[0].name} (${lowest[0].value.toFixed(1)}) | Gap: ${gap.toFixed(1)} years`,
  `US rank: ${usRank} of ${rows.length} (${us.value.toFixed(1)} years)`,
  "",
  "Rank | Country | Life expectancy (highest column)",
  "---:|---|---:",
  ...highest.map((r, i) => `${i + 1} | ${r.name} | ${r.value.toFixed(1)}`),
  "",
  "Rank | Country | Life expectancy (lowest column)",
  "---:|---|---:",
  ...lowest.map((r, i) => `${i + 1} | ${r.name} | ${r.value.toFixed(1)}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["group", "rank", "country", "iso3", "life_expectancy_years", "vintage"],
  [
    ...highest.map((r, i) => ["highest", i + 1, r.name, r.iso3, r.value, r.date]),
    ...lowest.map((r, i) => ["lowest", i + 1, r.name, r.iso3, r.value, r.date]),
  ]
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) {
  const height = 210 + Math.max(highest.length, lowest.length) * 34 + 40 + 60;
  screenshot(`${outBase}.html`, `${outBase}.png`, { width: 1200, height });
}

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
