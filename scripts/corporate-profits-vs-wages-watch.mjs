#!/usr/bin/env node
// corporate-profits-vs-wages-watch.mjs - corporate profits' and workers'
// compensation's shares of total US national income, over time. BEA NIPA
// Table 1.12 (National Income by Type of Income). Uses the existing
// BEA_API_KEY (same key as bea-industry.mjs / bea-regional.mjs).
//
// Run:  node scripts/corporate-profits-vs-wages-watch.mjs
//       node scripts/corporate-profits-vs-wages-watch.mjs --years 60
//       node scripts/corporate-profits-vs-wages-watch.mjs --no-image

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, legend, lineChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

try {
  for (const line of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
} catch { /* no .env file — fall through to environment */ }

const KEY = process.env.BEA_API_KEY;
if (!KEY) {
  console.error("  BEA_API_KEY not set. Add it to .env or set it as an environment variable.");
  console.error("  Free key: https://apps.bea.gov/API/signup/");
  process.exit(1);
}

const BEA = "https://apps.bea.gov/api/data";

async function bea(params) {
  const qs = new URLSearchParams({ UserID: KEY, ResultFormat: "JSON", ...params });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${BEA}?${qs}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`BEA HTTP ${res.status}`);
    const json = await res.json();
    const results = json.BEAAPI?.Results;
    const r = Array.isArray(results) ? results[0] : results;
    if (r?.Error) throw new Error(r.Error.APIErrorDescription);
    return r?.Data || [];
  } finally {
    clearTimeout(timer);
  }
}

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

function num(row) {
  return Number((row.DataValue || "").replace(/,/g, ""));
}

const years = Number(argValue("--years", "45"));
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `corporate-profits-vs-wages-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

console.log("  Fetching BEA NIPA Table 1.12 (National Income by Type of Income)...");
const data = await bea({ method: "GetData", datasetname: "NIPA", TableName: "T11200", Frequency: "A", Year: "ALL" });
if (!data.length) throw new Error("No data returned from BEA NIPA Table 1.12");

const byLine = (ln) => data.filter((r) => r.LineNumber === ln).sort((a, b) => a.TimePeriod.localeCompare(b.TimePeriod));
const niRows = byLine("1");         // National income
const compRows = byLine("2");       // Compensation of employees
const profitRows = byLine("13");    // Corporate profits with IVA and CCAdj
if (!niRows.length || !compRows.length || !profitRows.length) throw new Error("Expected line items (1, 2, 13) not found in BEA response");

const latestYear = Number(niRows[niRows.length - 1].TimePeriod);
const startYear = latestYear - years + 1;

function shareSeries(rows) {
  return rows
    .filter((r) => Number(r.TimePeriod) >= startYear)
    .map((r) => {
      const ni = niRows.find((n) => n.TimePeriod === r.TimePeriod);
      return { year: Number(r.TimePeriod), pct: (num(r) / num(ni)) * 100 };
    });
}

const compShare = shareSeries(compRows);
const profitShare = shareSeries(profitRows);

const compFirst = compShare[0], compLast = compShare[compShare.length - 1];
const profitFirst = profitShare[0], profitLast = profitShare[profitShare.length - 1];
const profitPeak = profitShare.reduce((a, b) => (b.pct > a.pct ? b : a));
const compTrough = compShare.reduce((a, b) => (b.pct < a.pct ? b : a));

const chartSeries = [
  { color: C.s1, points: compShare.map((p) => ({ label: String(p.year), v: p.pct })), endLabel: (v) => v },
  { color: C.s2, points: profitShare.map((p) => ({ label: String(p.year), v: p.pct })), endLabel: (v) => v },
];
const chartSVG = lineChart(chartSeries, { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => `${v.toFixed(1)}%`, labelStep: Math.max(2, Math.round(years / 12)), yLabel: "Share of national income" });
const legendHTML = legend([
  { name: "Workers' compensation", color: C.s1 },
  { name: "Corporate profits", color: C.s2 },
]);

const html = cardHTML({
  kicker: "Corporate profits vs. wages check",
  title: `Shares of US national income, ${compFirst.year}-${compLast.year}`,
  hero: `${profitLast.pct.toFixed(1)}%`,
  heroLabel: `corporate profits' share of national income · ${profitLast.year}`,
  chartSVG,
  legendHTML,
  source: "BEA, National Income and Product Accounts (Table 1.12)",
  vintage: `${compLast.year}`,
});

const facebook = [
  "Corporate profits vs. wages check:",
  "",
  `Workers' compensation (wages, salaries, and benefits) made up ${compLast.pct.toFixed(1)}% of total US national income in ${compLast.year}, down from ${compFirst.pct.toFixed(1)}% in ${compFirst.year}.`,
  `Corporate profits made up ${profitLast.pct.toFixed(1)}% in ${compLast.year}, up from ${profitFirst.pct.toFixed(1)}% in ${profitFirst.year} — and peaked at ${profitPeak.pct.toFixed(1)}% in ${profitPeak.year}.`,
  "",
  `Compensation's share bottomed out at ${compTrough.pct.toFixed(1)}% in ${compTrough.year} over this window.`,
  "",
  "Note: \"national income\" here is BEA's total (compensation + business profits + proprietors' income + rent + net interest + taxes on production, etc.) — close to but not identical to GDP. \"Corporate profits\" includes profits companies reinvest, not just what's paid out to shareholders. Why the shares moved is genuinely debated among economists (automation, globalization, market concentration, and industry mix are all cited) — these are just the measured shares, not a claim about the cause.",
  "",
  "Real numbers, real source — BEA National Income and Product Accounts:",
  "https://apps.bea.gov/iTable/?reqid=19&step=2&isuri=1&categories=survey#eyJhcHBpZCI6MTksInN0ZXBzIjpbMSwyLDNdLCJkYXRhIjpbWyJjYXRlZ29yaWVzIiwiU3VydmV5Il0sWyJOSVBBX1RhYmxlX0xpc3QiLCIzMyJdXX0=",
];

const lines = [
  `Corporate profits vs. wages check (${stamp})`,
  "",
  `Compensation share, ${compLast.year}: ${compLast.pct.toFixed(1)}% (was ${compFirst.pct.toFixed(1)}% in ${compFirst.year})`,
  `Corporate profits share, ${profitLast.year}: ${profitLast.pct.toFixed(1)}% (was ${profitFirst.pct.toFixed(1)}% in ${profitFirst.year}; peak ${profitPeak.pct.toFixed(1)}% in ${profitPeak.year})`,
  "",
  "Year | Compensation share | Corporate profits share",
  "---:|---:|---:",
  ...compShare.map((p, i) => `${p.year} | ${p.pct.toFixed(1)}% | ${profitShare[i].pct.toFixed(1)}%`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["year", "compensation_share_pct", "corporate_profits_share_pct"],
  compShare.map((p, i) => [p.year, p.pct, profitShare[i].pct])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
