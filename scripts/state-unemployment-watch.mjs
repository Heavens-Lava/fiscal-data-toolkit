#!/usr/bin/env node
// state-unemployment-watch.mjs - rank every state's unemployment rate, direct
// from BLS (Local Area Unemployment Statistics), not the FRED mirror. No API
// key required for this volume (BLS allows unregistered requests up to 25
// series per call and 25 calls/day; register free at
// https://data.bls.gov/registrationEngine/ and set BLS_API_KEY in .env for
// higher limits — this script batches either way).
//
// Run:  node scripts/state-unemployment-watch.mjs
//       node scripts/state-unemployment-watch.mjs --no-image

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

// FIPS state code -> postal abbreviation + name (BLS LAUS series use FIPS).
const STATES = {
  "01": ["AL", "Alabama"], "02": ["AK", "Alaska"], "04": ["AZ", "Arizona"], "05": ["AR", "Arkansas"],
  "06": ["CA", "California"], "08": ["CO", "Colorado"], "09": ["CT", "Connecticut"], "10": ["DE", "Delaware"],
  "11": ["DC", "District of Columbia"], "12": ["FL", "Florida"], "13": ["GA", "Georgia"], "15": ["HI", "Hawaii"],
  "16": ["ID", "Idaho"], "17": ["IL", "Illinois"], "18": ["IN", "Indiana"], "19": ["IA", "Iowa"],
  "20": ["KS", "Kansas"], "21": ["KY", "Kentucky"], "22": ["LA", "Louisiana"], "23": ["ME", "Maine"],
  "24": ["MD", "Maryland"], "25": ["MA", "Massachusetts"], "26": ["MI", "Michigan"], "27": ["MN", "Minnesota"],
  "28": ["MS", "Mississippi"], "29": ["MO", "Missouri"], "30": ["MT", "Montana"], "31": ["NE", "Nebraska"],
  "32": ["NV", "Nevada"], "33": ["NH", "New Hampshire"], "34": ["NJ", "New Jersey"], "35": ["NM", "New Mexico"],
  "36": ["NY", "New York"], "37": ["NC", "North Carolina"], "38": ["ND", "North Dakota"], "39": ["OH", "Ohio"],
  "40": ["OK", "Oklahoma"], "41": ["OR", "Oregon"], "42": ["PA", "Pennsylvania"], "44": ["RI", "Rhode Island"],
  "45": ["SC", "South Carolina"], "46": ["SD", "South Dakota"], "47": ["TN", "Tennessee"], "48": ["TX", "Texas"],
  "49": ["UT", "Utah"], "50": ["VT", "Vermont"], "51": ["VA", "Virginia"], "53": ["WA", "Washington"],
  "54": ["WV", "West Virginia"], "55": ["WI", "Wisconsin"], "56": ["WY", "Wyoming"],
};

function getBlsKey() {
  if (process.env.BLS_API_KEY) return process.env.BLS_API_KEY;
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^BLS_API_KEY=(.+)$/m);
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

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function blsSeries(seriesIds, key) {
  const body = { seriesid: seriesIds, latest: true };
  if (key) body.registrationkey = key;
  const res = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`BLS API HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS API: ${json.status} — ${(json.message || []).join("; ")}`);
  return json.Results?.series || [];
}

const key = getBlsKey();
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `state-unemployment-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

// Unregistered requests are capped at 25 series per call; registered at 50.
const fipsCodes = Object.keys(STATES);
const batchSize = key ? 50 : 25;
const batches = chunk(fipsCodes.map((f) => `LAUST${f}0000000000003`), batchSize);
const allSeries = (await Promise.all(batches.map((b) => blsSeries(b, key)))).flat();

const fipsBySeries = new Map(fipsCodes.map((f) => [`LAUST${f}0000000000003`, f]));
const rows = allSeries.map((s) => {
  const fips = fipsBySeries.get(s.seriesID);
  const [abbr, name] = STATES[fips];
  const d = s.data[0];
  return { abbr, name, rate: Number(d?.value), period: d ? `${d.periodName} ${d.year}` : null, footnote: d?.footnotes?.[0]?.text || null };
}).filter((r) => Number.isFinite(r.rate)).sort((a, b) => a.rate - b.rate);

if (!rows.length) throw new Error("No state unemployment data returned from BLS");

const vintage = rows[0].period;
const lowest = rows.slice(0, 5);
const highest = rows.slice(-5).reverse();
const national = rows.reduce((s, r) => s + r.rate, 0) / rows.length; // simple average across states, not BLS's own national rate

const chartRows = [...highest, ...lowest.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r, i) => ({
    label: `${r.name} (${r.abbr})`,
    v: r.rate,
    color: i < 5 ? C.neg : C.s2,
  })),
  { fmtTick: (v) => `${v.toFixed(1)}%`, fmtVal: (v) => `${v.toFixed(1)}%` }
);

const html = cardHTML({
  kicker: "State unemployment check",
  title: "Highest and lowest state unemployment rates",
  hero: `${highest[0].rate.toFixed(1)}%`,
  heroLabel: `${highest[0].name} — highest in the US · ${vintage}`,
  chartSVG,
  source: "BLS Local Area Unemployment Statistics (LAUS)",
  vintage,
});

const facebook = [
  "State unemployment check:",
  "",
  `Highest unemployment rate in the country (${vintage}): ${highest[0].name} at ${highest[0].rate.toFixed(1)}%. Lowest: ${lowest[0].name} at ${lowest[0].rate.toFixed(1)}%.`,
  "",
  `Top 5 highest: ${highest.map((r) => `${r.name} ${r.rate.toFixed(1)}%`).join(", ")}.`,
  `Top 5 lowest: ${lowest.map((r) => `${r.name} ${r.rate.toFixed(1)}%`).join(", ")}.`,
  "",
  `Simple average across all 50 states + DC: ${national.toFixed(1)}%. (Note: this is an unweighted average of state rates, not the official national unemployment rate, which is weighted by each state's labor force size — a few small states with unusual rates can pull this simple average away from the real national figure.)`,
  "",
  "Real numbers, real source — BLS Local Area Unemployment Statistics, direct from BLS (not a mirror):",
  "https://www.bls.gov/lau/",
];

const lines = [
  `State unemployment check (${stamp})`,
  "",
  `Data through: ${vintage}`,
  "",
  "Rank | State | Unemployment Rate",
  "---:|---|---:",
  ...rows.map((r, i) => `${i + 1} | ${r.name} (${r.abbr}) | ${r.rate.toFixed(1)}%`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "state", "abbr", "unemployment_rate", "period"],
  rows.map((r, i) => [i + 1, r.name, r.abbr, r.rate, r.period])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
