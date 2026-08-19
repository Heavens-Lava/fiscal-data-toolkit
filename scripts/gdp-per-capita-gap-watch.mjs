#!/usr/bin/env node
// gdp-per-capita-gap-watch.mjs - the US-vs-China GDP-per-capita gap: nominal,
// PPP-adjusted, China's catch-up since 1980, and exports per person (total
// exports vs. per-person exports tell very different stories). World Bank
// Open Data, no API key required.
//
// Run:  node scripts/gdp-per-capita-gap-watch.mjs
//       node scripts/gdp-per-capita-gap-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const WB = "https://api.worldbank.org/v2/country";

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function money(n, digits = 0) {
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: digits })}`;
}

async function wb(indicator, countries, extra = "") {
  const url = `${WB}/${countries.join(";")}/indicator/${indicator}?format=json&per_page=100${extra}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank HTTP ${res.status} for ${indicator}`);
  const json = await res.json();
  if (!Array.isArray(json) || !Array.isArray(json[1])) throw new Error(`World Bank returned no data for ${indicator}`);
  return json[1];
}

// Latest value for one country from a multi-country response.
function latestFor(rows, iso3) {
  return rows
    .filter((r) => r.countryiso3code === iso3 && r.value != null)
    .sort((a, b) => Number(b.date) - Number(a.date))[0];
}

// Latest year where BOTH countries have a value, for apples-to-apples ratios.
function latestCommonYear(rows, iso3a, iso3b) {
  const yearsA = new Set(rows.filter((r) => r.countryiso3code === iso3a && r.value != null).map((r) => r.date));
  const years = rows
    .filter((r) => r.countryiso3code === iso3b && r.value != null && yearsA.has(r.date))
    .map((r) => r.date)
    .sort((a, b) => Number(b) - Number(a));
  return years[0];
}

function valueFor(rows, iso3, year) {
  return rows.find((r) => r.countryiso3code === iso3 && r.date === year)?.value;
}

const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();

mkdirSync(SOCIAL, { recursive: true });

// Split into 3 focused posts instead of one long mini-essay -- each covers
// one idea (nominal/PPP gap, China's catch-up trajectory, why export totals
// don't equal captured value) rather than cramming all four into one caption.
function writePost(slug, { kicker, title, hero, heroLabel, chartSVG, vintage, facebook, extraLines = [] }) {
  const outBase = path.join(SOCIAL, `${slug}-${stamp}`);
  const html = cardHTML({ kicker, title, hero, heroLabel, chartSVG, source: "World Bank Open Data", vintage });
  const lines = [
    `${kicker} (${stamp})`, "", ...extraLines, "",
    "Facebook post", "-------------", facebook.join("\n"),
  ];
  writeFileSync(`${outBase}.txt`, lines.join("\n"));
  writeFileSync(`${outBase}.csv`, toCSV(["metric", "us_value", "china_value", "year", "unit"], [
    ["gdp_per_capita_nominal", usNominal.value, cnNominal.value, usNominal.date, "usd"],
    ["gdp_per_capita_ppp", usPPP.value, cnPPP.value, usPPP.date, "usd"],
  ]));
  writeFileSync(`${outBase}.html`, html);
  if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);
  console.log(`${slug}: ${rel(`${outBase}.txt`)}`);
}

console.log("  Fetching GDP per capita (nominal + PPP), exports, and population from World Bank...");
const [nominalRows, pppRows, chinaHistRows, exportRows, popRows, chinaTotalRows] = await Promise.all([
  wb("NY.GDP.PCAP.CD", ["USA", "CHN"]),
  wb("NY.GDP.PCAP.PP.CD", ["USA", "CHN"]),
  wb("NY.GDP.PCAP.CD", ["CHN"], "&date=1980"),
  wb("NE.EXP.GNFS.CD", ["USA", "CHN"]),
  wb("SP.POP.TOTL", ["USA", "CHN"]),
  wb("NY.GDP.MKTP.CD", ["CHN"]),
]);

const usNominal = latestFor(nominalRows, "USA");
const cnNominal = latestFor(nominalRows, "CHN");
const usPPP = latestFor(pppRows, "USA");
const cnPPP = latestFor(pppRows, "CHN");
const cn1980 = chinaHistRows.find((r) => r.value != null);
const cnTotal = latestFor(chinaTotalRows, "CHN");

const nominalRatio = usNominal.value / cnNominal.value;
const pppRatio = usPPP.value / cnPPP.value;
const catchUpMultiple = cnNominal.value / cn1980.value;

const expYear = latestCommonYear(exportRows, "USA", "CHN");
const popYearUS = popRows.filter((r) => r.countryiso3code === "USA" && r.value != null).sort((a, b) => b.date - a.date)[0].date;
const popYearCN = popRows.filter((r) => r.countryiso3code === "CHN" && r.value != null).sort((a, b) => b.date - a.date)[0].date;
const usExports = valueFor(exportRows, "USA", expYear);
const cnExports = valueFor(exportRows, "CHN", expYear);
const usPop = valueFor(popRows, "USA", popYearUS);
const cnPop = valueFor(popRows, "CHN", popYearCN);
const usExportsPerCapita = usExports / usPop;
const cnExportsPerCapita = cnExports / cnPop;

// Post 1 — the nominal-vs-PPP gap itself.
writePost("gdp-per-capita-gap-watch", {
  kicker: "GDP per capita check",
  title: "The US-China GDP-per-person gap, nominal vs. cost-of-living adjusted",
  hero: `${nominalRatio.toFixed(1)}×`,
  heroLabel: `US GDP per person vs. China's, nominal · ${usNominal.date}`,
  chartSVG: horizontalBarChart(
    [
      { label: `China, nominal (${cnNominal.date})`, v: cnNominal.value, color: C.neg },
      { label: `China, PPP-adjusted (${cnPPP.date})`, v: cnPPP.value, color: C.s1 },
      { label: `United States (${usNominal.date})`, v: usNominal.value, color: C.s2 },
    ],
    { fmtTick: (v) => money(v), fmtVal: (v) => money(v) }
  ),
  vintage: usNominal.date,
  extraLines: [
    `US GDP per capita (nominal, ${usNominal.date}): ${money(usNominal.value)}`,
    `China GDP per capita (nominal, ${cnNominal.date}): ${money(cnNominal.value)}`,
    `Nominal ratio (US/China): ${nominalRatio.toFixed(2)}x`,
    `US GDP per capita (PPP, ${usPPP.date}): ${money(usPPP.value)}`,
    `China GDP per capita (PPP, ${cnPPP.date}): ${money(cnPPP.value)}`,
    `PPP ratio (US/China): ${pppRatio.toFixed(2)}x`,
  ],
  facebook: [
    `In ${usNominal.date}, GDP per person was ${money(usNominal.value)} in the US vs. ${money(cnNominal.value)} in China — the average American "produces" about ${nominalRatio.toFixed(1)}× as much economic output as the average person in China, in raw dollar terms.`,
    "",
    `Adjust for cost of living (PPP, which accounts for goods being cheaper in China) and the gap narrows but doesn't close: ${money(usPPP.value)} vs. ${money(cnPPP.value)} — about ${pppRatio.toFixed(1)}× rather than ${nominalRatio.toFixed(1)}×.`,
    "",
    "Real numbers, real source — World Bank Open Data:",
    "https://data.worldbank.org/indicator/NY.GDP.PCAP.CD",
    "https://data.worldbank.org/indicator/NY.GDP.PCAP.PP.CD",
  ],
});

// Post 2 — China's per-person catch-up trajectory (total GDP vs. per-person tell different stories).
writePost("gdp-china-catchup-watch", {
  kicker: "China's GDP catch-up",
  title: "China's economy is #2 in the world — but per person, it's a different story",
  hero: `${Math.round(catchUpMultiple)}×`,
  heroLabel: `China's GDP per person growth since ${cn1980.date}`,
  chartSVG: horizontalBarChart(
    [
      { label: `China, ${cn1980.date}`, v: cn1980.value, color: C.neg },
      { label: `China, ${cnNominal.date}`, v: cnNominal.value, color: C.s1 },
    ],
    { fmtTick: (v) => money(v), fmtVal: (v) => money(v) }
  ),
  vintage: cnNominal.date,
  extraLines: [
    `China GDP per capita in ${cn1980.date}: ${money(cn1980.value, 0)}`,
    `China GDP per capita in ${cnNominal.date}: ${money(cnNominal.value)}`,
    `China catch-up multiple since ${cn1980.date}: ${catchUpMultiple.toFixed(1)}x`,
    `China total GDP (${cnTotal.date}): ${money(cnTotal.value)}`,
  ],
  facebook: [
    `China's economy overall is ${money(cnTotal.value)} — the world's 2nd largest, trailing only the US. But split across 1.4 billion people, it's still a fraction per person: ${money(cnNominal.value)}, versus ${money(usNominal.value)} in the US.`,
    "",
    `China's per-person GDP has come a long way fast, though: from ${money(cn1980.value, 0)} in ${cn1980.date} to ${money(cnNominal.value)} today — roughly a ${Math.round(catchUpMultiple)}× increase in 45 years, one of the fastest sustained catch-ups on record.`,
    "",
    "Total GDP measures a country's overall economic weight; GDP per person measures typical living standards. A country can lead on one and trail on the other — that's exactly what's happening here.",
    "",
    "Real numbers, real source — World Bank Open Data:",
    "https://data.worldbank.org/indicator/NY.GDP.PCAP.CD",
  ],
});

// Post 3 — why export totals don't equal captured value.
writePost("gdp-export-value-watch", {
  kicker: "Trade value check",
  title: "China exports more than the US — but Americans export more per person",
  hero: money(usExportsPerCapita, 0),
  heroLabel: `US exports per person, ${expYear}`,
  chartSVG: horizontalBarChart(
    [
      { label: `China per person (${expYear})`, v: cnExportsPerCapita, color: C.neg },
      { label: `US per person (${expYear})`, v: usExportsPerCapita, color: C.s2 },
    ],
    { fmtTick: (v) => money(v), fmtVal: (v) => money(v) }
  ),
  vintage: expYear,
  extraLines: [
    `Exports of goods & services, ${expYear}: US ${money(usExports)} | China ${money(cnExports)}`,
    `Exports per capita, ${expYear}: US ${money(usExportsPerCapita, 0)} | China ${money(cnExportsPerCapita, 0)}`,
  ],
  facebook: [
    `China exported ${money(cnExports)} in goods & services in ${expYear} — more than the US's ${money(usExports)}. But split across each country's population, the US actually exports more PER PERSON: ${money(usExportsPerCapita, 0)} vs. China's ${money(cnExportsPerCapita, 0)}. China's total is bigger mainly because it has 4× the people, not because each worker exports more value.`,
    "",
    `Trade totals count a product's full price at export, not who actually captured the value. The most-cited example: researchers tracing an iPhone's supply chain found China's assembly work captured only about $10 of its value, while Apple (US) kept the majority through design, software, and brand (Kraemer, Linden & Dedrick, UC Irvine/UC Berkeley/Syracuse, 2011).`,
    "",
    "That's why \"Made in China\" on the label doesn't mean China captured most of the sale price — and why the gap narrows as China's industries move up the value chain (EVs, batteries, chips) rather than staying fixed.",
    "",
    "Real numbers, real source — World Bank Open Data:",
    "https://data.worldbank.org/indicator/NE.EXP.GNFS.CD",
  ],
});
