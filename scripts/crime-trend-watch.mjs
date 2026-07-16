#!/usr/bin/env node
// crime-trend-watch.mjs - national violent/property crime rate trend, direct
// from the FBI Crime Data Explorer (NIBRS-based estimates). Needs a free
// api.data.gov key (same one that works for campaign-finance-watch.mjs and
// college-cost-watch.mjs) — sign up at https://api.data.gov/signup/ and set
// FEC_API_KEY (or a dedicated FBI_CDE_API_KEY) in .env.
//
// Run:  node scripts/crime-trend-watch.mjs
//       node scripts/crime-trend-watch.mjs --offense property-crime
//       node scripts/crime-trend-watch.mjs --no-image
//
// Important: the FBI's most recent 1-2 months always look artificially low —
// local agencies submit crime data with a lag, and the API returns whatever
// has been received so far, not a complete count. This script only uses
// complete calendar years (Jan-Dec, all 12 months present) to avoid that trap.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, lineChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

const OFFENSES = {
  "violent-crime": "Violent crime",
  "property-crime": "Property crime",
  homicide: "Homicide",
  robbery: "Robbery",
  "aggravated-assault": "Aggravated assault",
  burglary: "Burglary",
  "larceny": "Larceny-theft",
  "motor-vehicle-theft": "Motor vehicle theft",
};

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function getKey() {
  if (process.env.FBI_CDE_API_KEY) return process.env.FBI_CDE_API_KEY;
  if (process.env.FEC_API_KEY) return process.env.FEC_API_KEY; // same api.data.gov key works
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    const text = readFileSync(envPath, "utf8");
    const m1 = text.match(/^FBI_CDE_API_KEY=(.+)$/m);
    if (m1) return m1[1].trim();
    const m2 = text.match(/^FEC_API_KEY=(.+)$/m);
    if (m2) return m2[1].trim();
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

const key = getKey();
if (!key) {
  console.error("Missing FBI Crime Data Explorer key. Get a free key at https://api.data.gov/signup/ and set FEC_API_KEY (or FBI_CDE_API_KEY) in .env.");
  process.exit(1);
}

const offenseKey = argValue("--offense", "violent-crime");
if (!OFFENSES[offenseKey]) {
  console.error(`Unknown --offense "${offenseKey}". Options: ${Object.keys(OFFENSES).join(", ")}`);
  process.exit(1);
}
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `crime-trend-watch-${offenseKey}-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const thisYear = new Date().getUTCFullYear();
const fromYear = thisYear - 11; // 11 full years back, plus current partial year fetched and then dropped
const url = `https://api.usa.gov/crime/fbi/cde/summarized/national/${offenseKey}` +
  `?from=01-${fromYear}&to=12-${thisYear}&api_key=${key}`;
const res = await fetch(url);
const text = await res.text();
if (!res.ok) throw new Error(`FBI CDE HTTP ${res.status}: ${text.slice(0, 300)}`);
const json = JSON.parse(text);

const rateKey = Object.keys(json.offenses?.rates || {}).find((k) => /Offenses$/.test(k));
if (!rateKey) throw new Error("Could not find a national offenses rate series in the FBI CDE response");
const rates = json.offenses.rates[rateKey];

const byYear = new Map();
for (const [key2, value] of Object.entries(rates)) {
  if (value == null) continue;
  const [, y] = key2.split("-");
  if (!byYear.has(y)) byYear.set(y, []);
  byYear.get(y).push(Number(value));
}

// Only keep years where all 12 months are present — a partial year (including
// the current one, and any year with an unreported trailing month) would
// understate the annual rate and make it look like crime cratered.
const years = [...byYear.entries()]
  .filter(([, months]) => months.length === 12)
  .map(([y, months]) => ({ year: Number(y), rate: months.reduce((s, v) => s + v, 0) }))
  .sort((a, b) => a.year - b.year);

if (years.length < 2) throw new Error("Not enough complete years of FBI CDE data to show a trend");

const latest = years[years.length - 1];
const first = years[0];
const peak = years.reduce((a, b) => (b.rate > a.rate ? b : a));
const changeFromPeak = ((latest.rate - peak.rate) / peak.rate) * 100;
const changeFromFirst = ((latest.rate - first.rate) / first.rate) * 100;

const pts = years.map((y) => ({ label: String(y.year), v: y.rate }));
const chartSVG = lineChart(
  [{ color: C.s1, points: pts, endLabel: (v) => v }],
  { fmtTick: (v) => Math.round(v), fmtVal: (v) => v.toFixed(1), labelStep: 1, yLabel: `${OFFENSES[offenseKey]} rate per 100k` }
);

const html = cardHTML({
  kicker: "Crime trend check",
  title: `US ${OFFENSES[offenseKey].toLowerCase()} rate, ${first.year}-${latest.year}`,
  hero: latest.rate.toFixed(0),
  heroLabel: `per 100,000 people · ${latest.year} (complete-year estimate)`,
  chartSVG,
  source: "FBI Crime Data Explorer (NIBRS-based estimate)",
  vintage: String(latest.year),
});

const droppedNote = [...byYear.entries()].some(([y, m]) => Number(y) === thisYear && m.length < 12)
  ? ` ${thisYear} is excluded — local agencies are still submitting data for it, and the partial total so far would make crime look artificially low.`
  : "";

const facebook = [
  "Crime trend check:",
  "",
  `The national ${OFFENSES[offenseKey].toLowerCase()} rate was about ${latest.rate.toFixed(0)} per 100,000 people in ${latest.year} (the most recent complete calendar year in FBI's data) — down ${Math.abs(changeFromPeak).toFixed(0)}% from the ${first.year}-${latest.year} peak of ${peak.rate.toFixed(0)} in ${peak.year}, and ${changeFromFirst >= 0 ? "up" : "down"} ${Math.abs(changeFromFirst).toFixed(0)}% compared to ${first.year}.${droppedNote}`,
  "",
  "Important: the FBI's most recent 1-2 months in this feed are always incomplete — local police departments submit crime data on their own schedule, sometimes months late. A chart that includes an in-progress year without accounting for that will show crime crashing to near-zero right at the end, which is a reporting artifact, not reality. This chart only uses years where all 12 months had reported data.",
  "",
  "Real numbers, real source — FBI Crime Data Explorer:",
  "https://cde.ucr.cjis.gov/",
];

const lines = [
  `Crime trend check (${stamp})`,
  "",
  `Offense: ${OFFENSES[offenseKey]} | National rate per 100,000 people, complete calendar years only`,
  "",
  "Year | Rate per 100k",
  "---:|---:",
  ...years.map((y) => `${y.year} | ${y.rate.toFixed(1)}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["year", "rate_per_100k"], years.map((y) => [y.year, y.rate])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
