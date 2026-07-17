#!/usr/bin/env node
// Summarize which generated datasets are fresh enough for regular posting.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const OUT_MD = path.join(SOCIAL, "data-freshness-dashboard.md");
const OUT_JSON = path.join(SOCIAL, "data-freshness-dashboard.json");

const SOURCES = [
  { name: "Cost of living", pattern: /^cost-of-living-index-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "monthly/weekly", source: "FRED", staleDays: 45 },
  { name: "Weekly digest", pattern: /^weekly-digest-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "weekly", source: "mixed", staleDays: 14 },
  { name: "Tax dollar detail", pattern: /^tax-dollar-detail-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "annual/as needed", source: "Treasury/OMB", staleDays: 400 },
  { name: "Household debt", pattern: /^household-debt-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "quarterly", source: "FRED", staleDays: 120 },
  { name: "Bank debt holders", pattern: /^debt-holders-.+-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "quarterly", source: "FDIC", staleDays: 120 },
  { name: "Money/debt/cash", pattern: /^money-debt-cash-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "monthly/quarterly", source: "FRED/FDIC", staleDays: 60 },
  { name: "Market structure", pattern: /^market-structure-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "monthly", source: "SIFMA/FINRA/FRED", staleDays: 60 },
  { name: "Campaign finance", pattern: /^campaign-finance-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "election cycle", source: "FEC", staleDays: 120 },
  { name: "Crime trends", pattern: /^crime-trend-watch-.+-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "monthly/annual", source: "FBI CDE", staleDays: 120 },
  { name: "College costs", pattern: /^college-cost-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "annual", source: "College Scorecard", staleDays: 400 },
  { name: "SSA trust fund", pattern: /^ssa-trust-fund-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "quarterly", source: "SSA OACT", staleDays: 120 },
  { name: "Wealth concentration", pattern: /^wealth-concentration-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "quarterly", source: "Fed DFA/FRED", staleDays: 120 },
  { name: "Credit card cost", pattern: /^credit-card-cost-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "monthly", source: "FRED", staleDays: 45 },
  { name: "GDP per capita gap (US-China)", pattern: /^gdp-per-capita-gap-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "annual", source: "World Bank", staleDays: 400 },
  { name: "Life expectancy ranked", pattern: /^world-life-expectancy-ranked-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "annual", source: "World Bank (WHO)", staleDays: 400 },
  { name: "Religion adherence by state", pattern: /^religion-adherence-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "decadal", source: "U.S. Religion Census (ASARB/ARDA)", staleDays: 3000 },
  { name: "Electricity prices", pattern: /^electricity-price-watch-.+-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "monthly", source: "EIA", staleDays: 60 },
  { name: "State unemployment", pattern: /^state-unemployment-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "monthly", source: "BLS", staleDays: 45 },
  { name: "Census topic snapshots", pattern: /^census-.+-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "annual", source: "Census", staleDays: 400 },
  { name: "Weather", pattern: /^weather-.+-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "daily", source: "Open-Meteo", staleDays: 3 },
  { name: "Earthquakes", pattern: /^earthquake-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "daily/weekly", source: "USGS", staleDays: 14 },
  { name: "Crypto", pattern: /^crypto-market-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "daily/weekly", source: "CoinGecko", staleDays: 7 },
  { name: "NASA space", pattern: /^nasa-space-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "daily", source: "NASA", staleDays: 7 },
  { name: "OSM place profile", pattern: /^osm-place-profile-.+-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "as needed", source: "OpenStreetMap", staleDays: 180 },
  { name: "Arizona water", pattern: /^arizona-water-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "weekly", source: "USBR/USDM", staleDays: 14 },
  { name: "Consumer complaints", pattern: /^consumer-complaint-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "monthly", source: "CFPB", staleDays: 45 },
  { name: "Vehicle recalls", pattern: /^vehicle-recall-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "weekly", source: "NHTSA", staleDays: 14 },
  { name: "Housing supply", pattern: /^housing-supply-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "annual", source: "Census ACS", staleDays: 400 },
  { name: "Food recalls", pattern: /^food-recall-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "weekly", source: "FDA", staleDays: 14 },
  { name: "American time use", pattern: /^american-time-use-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "annual", source: "BLS ATUS", staleDays: 400 },
  { name: "Disaster declarations", pattern: /^disaster-declarations-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "monthly", source: "FEMA", staleDays: 45 },
  { name: "Baby names", pattern: /^baby-name-trends-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "annual", source: "SSA", staleDays: 400 },
  { name: "Salary buying power", pattern: /^salary-buying-power-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "annual", source: "BEA RPP", staleDays: 400 },
  { name: "Public-service pay", pattern: /^public-service-pay-.+-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "annual", source: "BLS OEWS", staleDays: 400 },
  { name: "Young-adult migration", pattern: /^young-adult-migration-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "annual", source: "Census ACS", staleDays: 400 },
  { name: "Family costs", pattern: /^family-cost-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "annual", source: "DOL/Census", staleDays: 400 },
  { name: "Retirement security", pattern: /^retirement-readiness-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "annual", source: "Census ACS", staleDays: 400 },
  { name: "Rental housing ownership", pattern: /^housing-ownership-watch-\d{4}-\d{2}-\d{2}\.csv$/, cadence: "triennial", source: "Census/HUD RHFS", staleDays: 1100 },
];

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    const st = statSync(file);
    if (st.isDirectory()) out.push(...walk(file));
    else out.push(file);
  }
  return out;
}

function daysOld(date) {
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function newestFor(pattern, files) {
  return files
    .filter((file) => pattern.test(path.basename(file)))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || null;
}

mkdirSync(SOCIAL, { recursive: true });
const files = walk(SOCIAL).filter((file) => /\.csv$/i.test(file));

const rows = SOURCES.map((item) => {
  const file = newestFor(item.pattern, files);
  const modified = file ? statSync(file).mtime : null;
  const age = modified ? daysOld(modified) : null;
  const status = !file ? "missing" : age <= item.staleDays ? "fresh" : "stale";
  return {
    ...item,
    latestFile: file ? rel(file) : "",
    modified: modified ? modified.toISOString().slice(0, 10) : "",
    ageDays: age,
    status,
  };
});

const lines = [
  "# Data Freshness Dashboard",
  "",
  `Generated: ${new Date().toLocaleString("en-US")}`,
  "",
  "Dataset | Source | Cadence | Latest local file | Age | Status",
  "---|---|---|---|---:|---",
  ...rows.map((r) => `${r.name} | ${r.source} | ${r.cadence} | ${r.latestFile || "-"} | ${r.ageDays ?? "-"} | ${r.status}`),
  "",
  "Note: This checks the newest local generated CSV, not the upstream API directly. A stale row usually means rerun that script before posting.",
  "",
];

writeFileSync(OUT_MD, lines.join("\n"));
writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2) + "\n");

console.log(`Freshness dashboard: ${rel(OUT_MD)}`);
console.log(`JSON: ${rel(OUT_JSON)}`);
