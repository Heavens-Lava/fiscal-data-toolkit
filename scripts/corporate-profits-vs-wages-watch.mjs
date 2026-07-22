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
import { C, esc, fred, lineChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

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

function money(n) {
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
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

// Translate the abstract share shift into a concrete "what this means for
// you" number: if compensation had held its share of national income from
// the start of this window, how much more would it total today — and per
// worker (BLS total nonfarm payroll employment)? This is a hypothetical
// counterfactual (an aggregate pool split evenly, not a claim about any one
// individual's actual pay), not an estimate of "wages fell" — real
// compensation has grown; it just grew more slowly than the total pie.
console.log("  Fetching total nonfarm employment (FRED PAYEMS) for the per-worker translation...");
const niLastDollars = num(niRows.find((r) => r.TimePeriod === String(compLast.year))) * 1e6;
const compLastDollars = num(compRows.find((r) => r.TimePeriod === String(compLast.year))) * 1e6;
const hypCompDollars = niLastDollars * (compFirst.pct / 100);
const gapDollars = hypCompDollars - compLastDollars;
const payems = await fred("PAYEMS");
const workers = payems[payems.length - 1].v * 1000;
const gapPerWorker = gapDollars / workers;

const chartSeries = [
  { color: C.s1, points: compShare.map((p) => ({ label: String(p.year), v: p.pct })), endLabel: (v) => v },
  { color: C.s2, points: profitShare.map((p) => ({ label: String(p.year), v: p.pct })), endLabel: (v) => v },
];
const chartSVG = lineChart(chartSeries, { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => `${v.toFixed(1)}%`, labelStep: Math.max(2, Math.round(years / 12)), yLabel: "Share of national income" });

// Custom 3-panel + smaller trend-chart layout (not the shared cardHTML()
// kicker/hero/chart template) — the before/after comparison is the story;
// the multi-year line chart is supporting context underneath, shrunk to
// make room, not the primary visual.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
body { width:1200px; height:675px; background:${C.surface}; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.card { width:100%; height:100%; padding:36px 48px 28px; display:flex; flex-direction:column; }
.kicker { font-size:15px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:${C.muted}; }
h1 { font-size:28px; font-weight:650; color:${C.ink}; margin-top:6px; max-width:1100px; line-height:1.2; }
.panels { display:flex; gap:20px; margin-top:20px; }
.panel { flex:1; background:#f2f1ea; border-radius:8px; padding:16px 20px; }
.panel-label { font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:${C.muted}; display:flex; align-items:center; gap:7px; }
.panel-dot { width:9px; height:9px; border-radius:50%; display:inline-block; }
.panel-comp .panel-val { color:${C.s1}; }
.panel-profit .panel-val { color:${C.s2}; }
.panel-row { display:flex; align-items:baseline; gap:10px; margin-top:10px; }
.panel-year { font-size:14px; color:${C.muted}; width:44px; }
.panel-val { font-size:26px; font-weight:700; color:${C.ink}; }
.panel-arrow { font-size:13px; color:${C.muted}; margin:2px 0 2px 44px; }
.panel-big .panel-val { font-size:40px; color:${C.pos}; }
.panel-big .panel-sub { font-size:13px; color:${C.ink2}; margin-top:6px; line-height:1.3; }
.plot-mini { flex:1; margin-top:16px; min-height:0; }
.plot-mini svg { width:100%; height:100%; }
.foot { display:flex; justify-content:space-between; font-size:14px; color:${C.muted}; padding-top:8px; }
</style></head><body><div class="card">
  <div class="kicker">Corporate profits vs. wages check</div>
  <h1>If pay had kept its ${esc(compFirst.year)} share of the economy...</h1>
  <div class="panels">
    <div class="panel panel-comp">
      <div class="panel-label"><span class="panel-dot" style="background:${C.s1}"></span>Workers' Share</div>
      <div class="panel-row"><span class="panel-year">${esc(compFirst.year)}</span><span class="panel-val">${compFirst.pct.toFixed(1)}%</span></div>
      <div class="panel-arrow">↓</div>
      <div class="panel-row"><span class="panel-year">${esc(compLast.year)}</span><span class="panel-val">${compLast.pct.toFixed(1)}%</span></div>
    </div>
    <div class="panel panel-profit">
      <div class="panel-label"><span class="panel-dot" style="background:${C.s2}"></span>Corporate Profits</div>
      <div class="panel-row"><span class="panel-year">${esc(profitFirst.year)}</span><span class="panel-val">${profitFirst.pct.toFixed(1)}%</span></div>
      <div class="panel-arrow">↑</div>
      <div class="panel-row"><span class="panel-year">${esc(profitLast.year)}</span><span class="panel-val">${profitLast.pct.toFixed(1)}%</span></div>
    </div>
    <div class="panel panel-big">
      <div class="panel-label">Per Worker, ${esc(compLast.year)}</div>
      <div class="panel-val">+${money(gapPerWorker)}</div>
      <div class="panel-sub">Potential annual difference if compensation still held its ${esc(compFirst.year)} share of national income</div>
    </div>
  </div>
  <div class="plot-mini">${chartSVG}</div>
  <div class="foot"><span>Source: BEA, National Income and Product Accounts (Table 1.12) · Chart: Jeff Macy</span><span>Data through ${esc(compLast.year)}</span></div>
</div></body></html>`;

const facebook = [
  `If workers' pay had kept pace with the economy since ${compFirst.year}, the average US worker would be earning about ${money(gapPerWorker)} more per year, right now.`,
  "",
  `Here's the gap: workers' compensation (wages, salaries, and benefits) took home ${compFirst.pct.toFixed(1)}% of total US national income in ${compFirst.year}. By ${compLast.year}, that share had fallen to ${compLast.pct.toFixed(1)}% — even though the economy is far bigger today. Corporate profits went the other way: ${profitFirst.pct.toFixed(1)}% in ${profitFirst.year} to ${profitLast.pct.toFixed(1)}% in ${compLast.year}, an all-time high in this ${years}-year window (peaked at ${profitPeak.pct.toFixed(1)}% in ${profitPeak.year}).`,
  "",
  `That missing share works out to about ${money(gapDollars)} a year, split across roughly ${(workers / 1e6).toFixed(0)} million US workers — call it ${money(gapPerWorker)} per worker, on average.`,
  "",
  "To be clear about what this is and isn't: real (inflation-adjusted) wages have still grown since 1981 — this isn't a claim that pay fell. It's that pay grew slower than the total economic pie, while profits grew faster than the pie. This is a hypothetical, evenly-split average, not a claim about any one person's actual paycheck, and why the shares shifted is genuinely debated among economists (automation, globalization, market concentration, and industry mix are all cited).",
  "",
  "Real numbers, real source — BEA National Income and Product Accounts:",
  "https://apps.bea.gov/iTable/?reqid=19&step=2&isuri=1&categories=survey#eyJhcHBpZCI6MTksInN0ZXBzIjpbMSwyLDNdLCJkYXRhIjpbWyJjYXRlZ29yaWVzIiwiU3VydmV5Il0sWyJOSVBBX1RhYmxlX0xpc3QiLCIzMyJdXX0=",
];

const lines = [
  `Corporate profits vs. wages check (${stamp})`,
  "",
  `Compensation share, ${compLast.year}: ${compLast.pct.toFixed(1)}% (was ${compFirst.pct.toFixed(1)}% in ${compFirst.year})`,
  `Corporate profits share, ${profitLast.year}: ${profitLast.pct.toFixed(1)}% (was ${profitFirst.pct.toFixed(1)}% in ${profitFirst.year}; peak ${profitPeak.pct.toFixed(1)}% in ${profitPeak.year})`,
  `Gap if compensation held its ${compFirst.year} share: ${money(gapDollars)}/yr total, ${money(gapPerWorker)}/yr per worker (${(workers / 1e6).toFixed(1)}M workers, PAYEMS)`,
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
