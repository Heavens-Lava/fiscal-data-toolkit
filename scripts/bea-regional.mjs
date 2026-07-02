#!/usr/bin/env node
// bea-regional.mjs — State economic rankings from the BEA Regional dataset.
// Shows real GDP size + growth, nominal GDP, per capita income, cost of living
// (regional price parity), and employment for every U.S. state + DC.
//
// Run:  node scripts/bea-regional.mjs
// Key:  free registration at apps.bea.gov/API/signup/ → store in .env as BEA_API_KEY

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from project root
const __dir = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(join(__dir, "../.env"), "utf8").split("\n")) {
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

const BASE = "https://apps.bea.gov/api/data";

async function bea(params) {
  const qs = new URLSearchParams({ UserID: KEY, ResultFormat: "JSON", ...params });
  const res = await fetch(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = (await res.json()).BEAAPI;
  if (d.Results?.Error) throw new Error(d.Results.Error.APIErrorDescription);
  return d.Results?.Data || [];
}

// Build map: GeoFips -> { year -> value (in base units), _name }
// UNIT_MULT is the power-of-10 multiplier (6 = millions → multiply by 1e6 to get dollars).
function index(rows) {
  const m = {};
  for (const r of rows) {
    if (!m[r.GeoFips]) m[r.GeoFips] = {};
    const mult = Math.pow(10, Number(r.UNIT_MULT || 0));
    m[r.GeoFips][r.TimePeriod] = Number((r.DataValue || "").replace(/,/g, "")) * mult;
    if (!m[r.GeoFips]._name) m[r.GeoFips]._name = r.GeoName.replace(/ \*+$/, "");
  }
  return m;
}

function latestYr(m) {
  return Object.values(m)
    .flatMap(v => Object.keys(v).filter(k => /^\d{4}$/.test(k)))
    .reduce((a, b) => (a > b ? a : b), "2000");
}

// Most recent valid value for a given fips across all available years.
function latestVal(m, fips) {
  const entry = m[fips];
  if (!entry) return NaN;
  const years = Object.keys(entry).filter(k => /^\d{4}$/.test(k)).sort().reverse();
  for (const y of years) {
    const v = entry[y];
    if (v && isFinite(v)) return v;
  }
  return NaN;
}

const T = (n) => {
  if (!n || !isFinite(n)) return "-";
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9)  return `${s}$${(a / 1e9).toFixed(1)}B`;
  return `${s}$${Math.round(a / 1e6)}M`;
};
const D  = (n) => (!n || !isFinite(n) ? "-" : `$${Math.round(n).toLocaleString()}`);
const J  = (n) => (!n || !isFinite(n) ? "-" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`);
const G  = (n) => (!isFinite(n) ? "    -" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);

// SASUMMARY line codes:
//  1 = Real GDP (millions chained 2017$)          → ×1e6 = dollars
//  4 = Nominal GDP (millions current $)            → ×1e6 = dollars
// 10 = Per capita personal income (current $)      → ×1 = dollars
// 13 = Regional Price Parity index (100 = US avg)  → ×1 = index
// 15 = Total employment (number of jobs)            → ×1 = count

(async () => {
  console.log("\n  Loading BEA Regional data (5 API calls)...");

  const [rgRows, ngRows, pcRows, rppRows, empRows] = await Promise.all([
    bea({ method: "GetData", DataSetName: "Regional", TableName: "SASUMMARY", LineCode: 1,  GeoFips: "STATE", Year: "LAST5" }),
    bea({ method: "GetData", DataSetName: "Regional", TableName: "SASUMMARY", LineCode: 4,  GeoFips: "STATE", Year: "LAST5" }),
    bea({ method: "GetData", DataSetName: "Regional", TableName: "SASUMMARY", LineCode: 10, GeoFips: "STATE", Year: "LAST5" }),
    bea({ method: "GetData", DataSetName: "Regional", TableName: "SASUMMARY", LineCode: 13, GeoFips: "STATE", Year: "LAST5" }),
    bea({ method: "GetData", DataSetName: "Regional", TableName: "SASUMMARY", LineCode: 15, GeoFips: "STATE", Year: "LAST5" }),
  ]);

  const rg = index(rgRows), ng = index(ngRows), pc = index(pcRows);
  const rpp = index(rppRows), emp = index(empRows);

  const yr   = latestYr(rg);
  const yrP  = String(Number(yr) - 1);
  const usRg = rg["00000"]?.[yr];
  const usGr = rg["00000"]?.[yrP] ? (usRg / rg["00000"][yrP] - 1) * 100 : NaN;

  // State rows — skip US total (00000) and anything not a 5-digit state code
  const states = Object.keys(rg)
    .filter(f => f !== "00000" && /^\d{5}$/.test(f) && rg[f]._name)
    .map(f => {
      const rGdp   = rg[f][yr];
      const rGdpP  = rg[f][yrP];
      const growth = rGdp && rGdpP ? (rGdp / rGdpP - 1) * 100 : NaN;
      const pcInc  = latestVal(pc, f);
      const prPar  = latestVal(rpp, f);
      const adjInc = pcInc && prPar ? pcInc / (prPar / 100) : NaN;
      return { fips: f, name: rg[f]._name, rGdp, growth, nGdp: ng[f]?.[yr] ?? latestVal(ng, f), pcInc, prPar, adjInc, jobs: latestVal(emp, f) };
    })
    .filter(s => s.rGdp)
    .sort((a, b) => b.rGdp - a.rGdp);

  // ── Main table ────────────────────────────────────────────────────────────
  console.log(`\n  State Economic Rankings — ${yr}`);
  console.log(`  U.S. total: real GDP ${T(usRg)}  ·  YoY growth ${G(usGr)}  ·  source: BEA SASUMMARY\n`);

  console.log("  State                    Real GDP    YoY%    Nominal GDP  Per Capita  CostLiv   Jobs");
  console.log("  ─────────────────────── ─────────── ──────  ─────────── ──────────  ───────   ───────");

  for (const s of states) {
    const rppStr = s.prPar ? s.prPar.toFixed(1) : " -";
    console.log(
      `  ${s.name.slice(0, 23).padEnd(23)} ${T(s.rGdp).padStart(11)}  ${G(s.growth).padStart(5)}  ${T(s.nGdp).padStart(11)}  ${D(s.pcInc).padStart(9)}  ${rppStr.padStart(6)}    ${J(s.jobs).padStart(6)}`
    );
  }

  // ── Fastest / slowest growing ─────────────────────────────────────────────
  const byGrowth = [...states].filter(s => isFinite(s.growth)).sort((a, b) => b.growth - a.growth);
  console.log(`\n  ── Fastest growing states (${yr} real GDP YoY) ─────────────────────────────`);
  for (const s of byGrowth.slice(0, 8))
    console.log(`  ${s.name.padEnd(25)} ${G(s.growth).padStart(7)}   GDP ${T(s.rGdp)}`);
  console.log(`\n  ── Slowest / shrinking ───────────────────────────────────────────────────`);
  for (const s of byGrowth.slice(-5).reverse())
    console.log(`  ${s.name.padEnd(25)} ${G(s.growth).padStart(7)}   GDP ${T(s.rGdp)}`);

  // ── Cost-adjusted income (purchasing power) ───────────────────────────────
  const byAdj = [...states].filter(s => isFinite(s.adjInc)).sort((a, b) => b.adjInc - a.adjInc);
  console.log(`\n  ── Purchasing-power adjusted income (per capita ÷ price parity) ──────────`);
  console.log("  State                    Per Capita  CostLiv(100=US)  Adj Income");
  console.log("  ─────────────────────── ──────────  ───────────────  ──────────");
  for (const s of byAdj.slice(0, 12))
    console.log(`  ${s.name.slice(0, 23).padEnd(23)} ${D(s.pcInc).padStart(9)}  ${s.prPar.toFixed(1).padStart(14)}  ${D(s.adjInc).padStart(10)}`);

  // ── Most expensive states ─────────────────────────────────────────────────
  const byRPP = [...states].filter(s => s.prPar).sort((a, b) => b.prPar - a.prPar);
  console.log(`\n  ── Most expensive cost of living (RPP: 100 = US average) ────────────────`);
  for (const s of byRPP.slice(0, 8))
    console.log(`  ${s.name.padEnd(25)} ${s.prPar.toFixed(1).padStart(6)}   per capita ${D(s.pcInc)}`);
  console.log(`\n  ── Most affordable ───────────────────────────────────────────────────────`);
  for (const s of byRPP.slice(-5).reverse())
    console.log(`  ${s.name.padEnd(25)} ${s.prPar.toFixed(1).padStart(6)}   per capita ${D(s.pcInc)}`);

  console.log(`\n  CostLiv = Regional Price Parity index. 105 = 5% more expensive than US avg.`);
  console.log(`  Adj Income removes cost-of-living differences to show real purchasing power.\n`);
})();
