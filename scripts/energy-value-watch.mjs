#!/usr/bin/env node
// energy-value-watch.mjs - how much energy the US actually consumes (by
// source, in quadrillion BTU) and what it actually costs, from EIA's own
// published figures — not a back-of-envelope $/MMBtu guess. Cross-referenced
// against M2 money supply and physical cash (FRED) for scale. Needs
// EIA_API_KEY in .env (same key as electricity-price-watch.mjs).
//
// Run:  node scripts/energy-value-watch.mjs
//       node scripts/energy-value-watch.mjs --no-image

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, fred, horizontalBarChart, last, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

const SOURCES = [
  { msn: "PATCBUS", label: "Petroleum" },
  { msn: "NNTCBUS", label: "Natural gas" },
  { msn: "RETCBUS", label: "Renewables" },
  { msn: "CLTCBUS", label: "Coal" },
  { msn: "NUETBUS", label: "Nuclear" },
];

function getKey() {
  if (process.env.EIA_API_KEY) return process.env.EIA_API_KEY;
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^EIA_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function money(n) {
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

async function eia(pathq) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`https://api.eia.gov${pathq}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`EIA API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`EIA API timed out after 20s for ${pathq}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function eiaLatest(collection, seriesId, facetKey = "msn") {
  const qs = new URLSearchParams({
    api_key: key, frequency: "annual", "data[0]": "value",
    [`facets[${facetKey}][]`]: seriesId, "sort[0][column]": "period", "sort[0][direction]": "desc", length: "1",
  });
  if (collection === "seds") qs.set("facets[stateId][]", "US");
  const json = await eia(`/v2/${collection}/data/?${qs}`);
  const row = json.response?.data?.[0];
  if (!row) throw new Error(`No EIA data for ${collection}/${seriesId}`);
  return { period: row.period, value: Number(row.value) };
}

const key = getKey();
if (!key) {
  console.error("Missing EIA_API_KEY. Get a free key (emailed instantly) at https://www.eia.gov/opendata/register.php and set EIA_API_KEY in .env.");
  process.exit(1);
}

const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `energy-value-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

console.log("  Fetching total US energy consumption from EIA...");
const totalConsumption = await eiaLatest("total-energy", "TETCBUS");

console.log("  Fetching consumption by source (5 EIA calls)...");
const sourceRows = await Promise.all(
  SOURCES.map(async (s) => ({ ...s, ...(await eiaLatest("total-energy", s.msn)) }))
);

console.log("  Fetching total energy expenditure from EIA SEDS...");
const expenditure = await eiaLatest("seds", "TETCV", "seriesId");

console.log("  Fetching GDP, M2, and cash from FRED...");
const [m2Rows, cashRows, gdpRows] = await Promise.all([fred("M2SL"), fred("CURRCIR"), fred("GDP")]);
const m2 = last(m2Rows), cash = last(cashRows), gdp = last(gdpRows);
const m2Dollars = m2.v * 1e9, cashDollars = cash.v * 1e9, gdpDollars = gdp.v * 1e9;
const expenditureDollars = expenditure.value * 1e6;

const sourceSum = sourceRows.reduce((s, r) => s + r.value, 0);
const shareOfGDP = (expenditureDollars / gdpDollars) * 100;
const shareOfM2 = (expenditureDollars / m2Dollars) * 100;
const multipleOfCash = expenditureDollars / cashDollars;

const chartSVG = horizontalBarChart(
  sourceRows
    .map((r) => ({ label: r.label, v: r.value / 1000, pct: (r.value / sourceSum) * 100 }))
    .sort((a, b) => b.v - a.v)
    .map((r, i) => ({ label: `${r.label} (${r.pct.toFixed(0)}%)`, v: r.v, color: i === 0 ? C.s2 : C.s1 })),
  { fmtTick: (v) => `${v.toFixed(0)}Q`, fmtVal: (v) => `${v.toFixed(1)} quads` }
);

const html = cardHTML({
  kicker: "Energy value check",
  title: `US energy consumption by source, ${totalConsumption.period}`,
  hero: `${(totalConsumption.value / 1000).toFixed(1)} quads`,
  heroLabel: `total primary energy · ${totalConsumption.period}`,
  chartSVG,
  source: "EIA Monthly Energy Review / SEDS",
  vintage: totalConsumption.period,
});

const facebook = [
  "Energy value check:",
  "",
  `The US consumed ${(totalConsumption.value / 1000).toFixed(1)} quadrillion BTU ("quads") of primary energy in ${totalConsumption.period} — the by-source breakdown: ${sourceRows.slice().sort((a, b) => b.value - a.value).map((r) => `${r.label} ${((r.value / sourceSum) * 100).toFixed(0)}%`).join(", ")}. (Note: these five sources sum to about ${((sourceSum / totalConsumption.value - 1) * 100).toFixed(1)}% more than the official total due to how EIA nets out electricity conversion losses — shares above are each source's share of the five-source sum, not the headline total, so they add to 100%.)`,
  "",
  `What that energy actually costs: EIA's own expenditure estimate is ${money(expenditureDollars)} for ${expenditure.period} (the most recent year with published expenditure data — it lags consumption data by about a year). That is NOT a back-of-envelope estimate — it's EIA's own bottom-up total across every energy source and sector.`,
  "",
  `For scale: US energy spending is about ${shareOfGDP.toFixed(1)}% of GDP (${money(gdpDollars)}, ${gdp.d}), equal to about ${shareOfM2.toFixed(1)}% of the entire M2 money supply (${money(m2Dollars)}, ${m2.d}), and ${multipleOfCash.toFixed(1)}x all the physical cash in circulation (${money(cashDollars)}, ${cash.d}).`,
  "",
  "Real numbers, real source — EIA Monthly Energy Review, EIA State Energy Data System, FRED:",
  "https://www.eia.gov/totalenergy/data/monthly/",
];

const lines = [
  `Energy value check (${stamp})`,
  "",
  `Total primary energy consumption: ${(totalConsumption.value / 1000).toFixed(2)} quads (${totalConsumption.period})`,
  "",
  "Source | Quads | Share of 5-source total",
  "---|---:|---:",
  ...sourceRows.slice().sort((a, b) => b.value - a.value).map((r) => `${r.label} | ${(r.value / 1000).toFixed(2)} | ${((r.value / sourceSum) * 100).toFixed(1)}%`),
  "",
  `Total energy expenditure: ${money(expenditureDollars)} (${expenditure.period})`,
  `US GDP: ${money(gdpDollars)} (${gdp.d}) — energy is ${shareOfGDP.toFixed(1)}% of GDP`,
  `M2 money supply: ${money(m2Dollars)} (${m2.d}) — energy expenditure is ${shareOfM2.toFixed(1)}% of M2`,
  `Physical cash in circulation: ${money(cashDollars)} (${cash.d}) — energy expenditure is ${multipleOfCash.toFixed(1)}x physical cash`,
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["source", "quads", "share_pct"],
  sourceRows.map((r) => [r.label, (r.value / 1000).toFixed(3), ((r.value / sourceSum) * 100).toFixed(2)])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
