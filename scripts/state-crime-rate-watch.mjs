#!/usr/bin/env node
// State violent/property crime rates and clearance rates, from the FBI
// Crime Data Explorer (NIBRS-based estimates). Same API/key as
// crime-trend-watch.mjs (national trend) — this is the state-by-state
// ranking version.
//
// Framing note: describes the dataset ("highest reported violent crime
// rate, FBI data") rather than labeling places — avoid "most dangerous
// states" style claims.
//
// Run:  node scripts/state-crime-rate-watch.mjs --offense violent-crime
//       node scripts/state-crime-rate-watch.mjs --offense property-crime --metric clearance

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, argValue, envValue, rel } from "./lib/data-common.mjs";

const OFFENSES = { "violent-crime": "Violent crime", "property-crime": "Property crime" };

function key() {
  return envValue("FEC_API_KEY") || envValue("FBI_CDE_API_KEY");
}

const apiKey = key();
if (!apiKey) throw new Error("Missing FEC_API_KEY (doubles as the FBI CDE key) in .env. Free key: https://api.data.gov/signup/");
const offenseKey = String(argValue("--offense", "violent-crime")).toLowerCase();
if (!OFFENSES[offenseKey]) throw new Error(`--offense must be one of: ${Object.keys(OFFENSES).join(", ")}`);
const metric = String(argValue("--metric", "rate")).toLowerCase();
if (!["rate", "clearance"].includes(metric)) throw new Error("--metric must be rate or clearance.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-${offenseKey}-${metric}-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

// Only complete calendar years — the FBI's most recent 1-2 months always
// look artificially low because local agencies submit with a lag.
function annualRate(monthlyRates, targetYear) {
  const months = Object.entries(monthlyRates).filter(([ym]) => ym.endsWith(`-${targetYear}`));
  if (months.length !== 12) return null;
  return months.reduce((s, [, v]) => s + v, 0);
}

async function fetchState(abbr, name, year) {
  const url = `https://api.usa.gov/crime/fbi/cde/summarized/state/${abbr}/${offenseKey}?from=01-${year - 1}&to=12-${year}&API_KEY=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const rates = json.offenses?.rates || {};
  const offenseKeyName = Object.keys(rates).find((k) => k.endsWith("Offenses") && !k.startsWith("United States"));
  const clearanceKeyName = Object.keys(rates).find((k) => k.endsWith("Clearances") && !k.startsWith("United States"));
  const series = metric === "clearance" ? rates[clearanceKeyName] : rates[offenseKeyName];
  if (!series) return null;
  const rate = annualRate(series, year);
  return rate == null ? null : { state: name, abbr, rate };
}

// Find the latest year with complete data by testing Texas (a large,
// reliably-reporting state) — same "known good indicator" trick used
// elsewhere in this toolkit.
let year = null;
for (const candidate of [2024, 2023, 2022]) {
  const probe = await fetchState("TX", "Texas", candidate);
  if (probe) { year = candidate; break; }
}
if (!year) throw new Error("Could not find a complete recent year of FBI CDE data.");

const BATCH = 10;
const results = [];
for (let i = 0; i < STATES.length; i += BATCH) {
  const batch = STATES.slice(i, i + BATCH);
  const batchResults = await Promise.all(batch.map((s) => fetchState(s.abbr, s.name, year)));
  results.push(...batchResults);
}
const rows = results.filter(Boolean).sort((a, b) => b.rate - a.rate).map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error(`No usable state ${offenseKey} rows for ${year}.`);

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 10);
const bottom = rows.slice(-5).reverse();
const label = OFFENSES[offenseKey];
const metricLabel = metric === "clearance" ? `${label} clearance rate` : `${label} rate`;

const chartRows = metric === "clearance" ? top : [...top, ...bottom.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.rate, color: r.state === "Arizona" ? C.s2 : r.rank <= 10 ? C.s1 : C.neg })),
  { fmtTick: (v) => v.toFixed(0), fmtVal: (v) => `${v.toFixed(1)} per 100k` }
);

const html = cardHTML({
  kicker: "Crime data check",
  title: `${metricLabel}, by state`,
  hero: top[0].rate.toFixed(1),
  heroLabel: `${top[0].state}; ${metricLabel.toLowerCase()} per 100,000 residents, ${year}`,
  chartSVG, source: "FBI Crime Data Explorer (NIBRS-based estimate)", vintage: String(year),
});

const facebook = metric === "clearance" ? [
  `How often are ${label.toLowerCase()} cases actually solved?`,
  "",
  `FBI Crime Data Explorer, ${year} data — ${label.toLowerCase()} clearance rate by state (cases cleared per 100,000 residents; not the same as clearance percentage of reported cases).`,
  "",
  "Highest reported clearance rates:", ...top.map((r) => `#${r.rank} ${r.state}: ${r.rate.toFixed(1)} per 100k`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${az.rate.toFixed(1)} per 100k.` : "",
  "",
  "Note: this reflects reported/cleared case volume relative to population, not the percentage of cases solved — a state can have a high clearance rate here simply from a higher overall crime rate. Based on NIBRS-based estimates; not every agency reports to the FBI, so this is an estimate, not a full census.",
  "",
  "Source: FBI Crime Data Explorer (Uniform Crime Reporting Program).",
].filter(Boolean) : [
  `States with the highest reported ${label.toLowerCase()} rate (${year} FBI data)`,
  "",
  `FBI Crime Data Explorer, ${year} data — reported ${label.toLowerCase()} rate per 100,000 residents.`,
  "",
  "Highest reported rates:", ...top.map((r) => `#${r.rank} ${r.state}: ${r.rate.toFixed(1)} per 100k`), "",
  "Lowest reported rates:", ...bottom.map((r) => `#${r.rank} ${r.state}: ${r.rate.toFixed(1)} per 100k`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${az.rate.toFixed(1)} per 100k.` : "",
  "",
  "Note: these are reported rates based on NIBRS-based FBI estimates, not every agency reports, and local factors (reporting practices, population density, tourism) all affect the numbers — this describes the dataset, not a ranking of how dangerous a place is.",
  "",
  "Source: FBI Crime Data Explorer (Uniform Crime Reporting Program).",
].filter(Boolean);

const lines = [
  `State ${offenseKey} ${metric} watch (${STAMP})`, "", `FBI Crime Data Explorer, ${year} ${metricLabel.toLowerCase()} per 100,000 residents.`, "",
  `Rank | State | ${metricLabel} (per 100k)`,
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${r.rate.toFixed(1)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", `${offenseKey}_${metric}_per_100k`], rows.map((r) => [r.rank, r.state, r.rate])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
