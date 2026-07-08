#!/usr/bin/env node
// World Bank country comparison snapshot. No API key required.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  C,
  cardHTML,
  horizontalBarChart,
  screenshot,
  toCSV,
} from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

const COUNTRY_ALIASES = {
  US: "USA", USA: "USA",
  CN: "CHN", CHINA: "CHN", CHN: "CHN",
  MX: "MEX", MEXICO: "MEX", MEX: "MEX",
  CA: "CAN", CANADA: "CAN", CAN: "CAN",
  JP: "JPN", JAPAN: "JPN", JPN: "JPN",
  DE: "DEU", GERMANY: "DEU", DEU: "DEU",
  GB: "GBR", UK: "GBR", GBR: "GBR",
  FR: "FRA", FRANCE: "FRA", FRA: "FRA",
  IN: "IND", INDIA: "IND", IND: "IND",
  BR: "BRA", BRAZIL: "BRA", BRA: "BRA",
};

const INDICATORS = {
  gdp: {
    id: "NY.GDP.MKTP.CD",
    label: "GDP",
    title: "GDP by country",
    heroLabel: "largest economy in this group",
    fmt: (v) => money(v),
    scale: (v) => v,
    tick: (v) => money(v),
  },
  "gdp-per-capita": {
    id: "NY.GDP.PCAP.CD",
    label: "GDP per capita",
    title: "GDP per person by country",
    heroLabel: "highest GDP per person",
    fmt: (v) => money(v, 0),
    scale: (v) => v,
    tick: (v) => money(v, 0),
  },
  "gdp-growth": {
    id: "NY.GDP.MKTP.KD.ZG",
    label: "GDP growth",
    title: "Real GDP growth by country",
    heroLabel: "fastest growth",
    fmt: (v) => `${v.toFixed(1)}%`,
    scale: (v) => v,
    tick: (v) => `${Math.round(v)}%`,
  },
  population: {
    id: "SP.POP.TOTL",
    label: "Population",
    title: "Population by country",
    heroLabel: "largest population",
    fmt: (v) => compact(v),
    scale: (v) => v,
    tick: (v) => compact(v),
  },
  inflation: {
    id: "FP.CPI.TOTL.ZG",
    label: "Inflation",
    title: "Inflation by country",
    heroLabel: "highest inflation",
    fmt: (v) => `${v.toFixed(1)}%`,
    scale: (v) => v,
    tick: (v) => `${Math.round(v)}%`,
  },
  "life-expectancy": {
    id: "SP.DYN.LE00.IN",
    label: "Life expectancy",
    title: "Life expectancy by country",
    heroLabel: "highest life expectancy",
    fmt: (v) => `${v.toFixed(1)} years`,
    scale: (v) => v,
    tick: (v) => `${Math.round(v)}`,
  },
  poverty: {
    id: "SI.POV.DDAY",
    label: "Extreme poverty rate",
    title: "Extreme poverty rate by country",
    heroLabel: "highest poverty rate",
    fmt: (v) => `${v.toFixed(1)}%`,
    scale: (v) => v,
    tick: (v) => `${Math.round(v)}%`,
  },
  "health-spending": {
    id: "SH.XPD.CHEX.PC.CD",
    label: "Health spending per person",
    title: "Health spending per person",
    heroLabel: "highest health spending per person",
    fmt: (v) => money(v, 0),
    scale: (v) => v,
    tick: (v) => money(v, 0),
  },
};

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function normalizeCountry(code) {
  const key = String(code).trim().toUpperCase();
  return COUNTRY_ALIASES[key] || key;
}

function money(n, digits = 1) {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(digits)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(digits)}M`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: digits })}`;
}

function compact(n) {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return Math.round(n).toLocaleString("en-US");
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function worldBank(indicator, countries) {
  const url = `https://api.worldbank.org/v2/country/${countries.join(";")}/indicator/${indicator}?format=json&per_page=200`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json) || !Array.isArray(json[1])) throw new Error("World Bank returned no data");
  return json[1];
}

function latestByCountry(rows) {
  const best = new Map();
  for (const row of rows) {
    if (row.value == null) continue;
    const code = row.countryiso3code;
    const cur = best.get(code);
    if (!cur || Number(row.date) > Number(cur.year)) {
      best.set(code, {
        code,
        name: row.country?.value || code,
        year: row.date,
        value: Number(row.value),
      });
    }
  }
  return [...best.values()];
}

const indicatorKey = argValue("--indicator", "gdp-per-capita");
const indicator = INDICATORS[indicatorKey];
if (!indicator) {
  console.error(`Unknown --indicator "${indicatorKey}". Options: ${Object.keys(INDICATORS).join(", ")}`);
  process.exit(1);
}

const countries = argValue("--countries", "US,CN,MX,CA")
  .split(",")
  .map(normalizeCountry)
  .filter(Boolean);
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `world-country-${indicatorKey}-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const wbRows = await worldBank(indicator.id, countries);
const rows = latestByCountry(wbRows).sort((a, b) => b.value - a.value);
if (!rows.length) throw new Error("No usable country rows returned");

const leader = rows[0];
const chartSVG = horizontalBarChart(
  rows.map((r, i) => ({ label: r.code, v: indicator.scale(r.value), color: i === 0 ? C.s2 : C.s1 })),
  { fmtTick: indicator.tick, fmtVal: indicator.fmt }
);

const html = cardHTML({
  kicker: "World Bank check",
  title: indicator.title,
  hero: indicator.fmt(leader.value),
  heroLabel: `${leader.name}: ${indicator.heroLabel}`,
  chartSVG,
  source: "World Bank Open Data",
  vintage: rows.map((r) => r.year).sort().at(-1),
});

const lines = [
  `World Bank check (${stamp})`,
  "",
  `${indicator.label}: ${leader.name} leads this group at ${indicator.fmt(leader.value)} (${leader.year}).`,
  "",
  "Country | Code | Latest year | Value",
  "---|---:|---:|---:",
  ...rows.map((r) => `${r.name} | ${r.code} | ${r.year} | ${indicator.fmt(r.value)}`),
  "",
  `Source: World Bank Open Data indicator ${indicator.id}.`,
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["country", "code", "indicator", "year", "value"],
  rows.map((r) => [r.name, r.code, indicatorKey, r.year, r.value])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
