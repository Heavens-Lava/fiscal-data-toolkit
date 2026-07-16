#!/usr/bin/env node
// bea-regional.mjs — State economic rankings from the BEA Regional dataset.
// Shows real GDP size + growth, nominal GDP, per capita income, cost of living
// (regional price parity), and employment for every U.S. state + DC.
//
// Run:  node scripts/bea-regional.mjs
// Key:  free registration at apps.bea.gov/API/signup/ → store in .env as BEA_API_KEY

import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { C, cardHTML, engagementCTA, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

// Load .env from project root
const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");
const SOCIAL = join(ROOT, "social");
const rel = (f) => relative(ROOT, f).replace(/\\/g, "/");
const stamp = () => new Date().toISOString().slice(0, 10);
const noImage = process.argv.includes("--no-image");
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

  // ── social post: purchasing-power-adjusted income ("nominal income lies") ──
  // Nominal per-capita income makes California/DC/NY look like the winners.
  // Adjust for cost of living and the ranking reshuffles — that reshuffle,
  // not any single state, is the actual story here.
  const byNominalPc = [...states].filter((s) => isFinite(s.pcInc)).sort((a, b) => b.pcInc - a.pcInc);
  const nominalRank = new Map(byNominalPc.map((s, i) => [s.fips, i + 1]));
  const adjRank = new Map(byAdj.map((s, i) => [s.fips, i + 1]));

  // The state with the biggest rank DROP going from nominal -> adjusted is
  // the sharpest illustration of "high paycheck, high cost of living" —
  // pick it dynamically rather than assuming it's always California.
  const biggestDrop = states
    .filter((s) => nominalRank.has(s.fips) && adjRank.has(s.fips))
    .map((s) => ({ ...s, nominalRank: nominalRank.get(s.fips), adjRank: adjRank.get(s.fips) }))
    .reduce((a, b) => (b.adjRank - b.nominalRank > a.adjRank - a.nominalRank ? b : a));

  const top10Adj = byAdj.slice(0, 10);
  const chartStates = top10Adj.some((s) => s.fips === biggestDrop.fips)
    ? top10Adj
    : [...top10Adj, biggestDrop];

  const chartSVG = horizontalBarChart(
    chartStates.map((s) => ({
      label: s.name,
      v: s.adjInc,
      color: s.fips === biggestDrop.fips ? C.neg : C.s1,
    })),
    { fmtTick: (v) => `$${Math.round(v / 1000)}k`, fmtVal: D }
  );

  const html = cardHTML({
    kicker: "State economics · purchasing power",
    title: "Nominal income vs. what your paycheck actually buys",
    hero: `#${biggestDrop.nominalRank} → #${biggestDrop.adjRank}`,
    heroLabel: `${biggestDrop.name}: nominal income rank → cost-of-living-adjusted rank`,
    chartSVG,
    source: "BEA Regional (SASUMMARY): per capita income + Regional Price Parity",
    vintage: yr,
  });

  const facebook = [
    `${biggestDrop.name} ranks #${biggestDrop.nominalRank} in the country for nominal per-capita income (${D(biggestDrop.pcInc)}) — but its cost of living is ${biggestDrop.prPar.toFixed(1)} (100 = U.S. average). Adjust for that, and its real purchasing power ranks just #${biggestDrop.adjRank}.`,
    "",
    `Once you adjust every state for its own cost of living, the top of the list isn't the states with the biggest paychecks — it's ${byAdj.slice(0, 3).map((s) => s.name).join(", ")}, states where a merely-good income goes a lot further.`,
    "",
    `Adjusted income leaders: ${top10Adj.map((s) => `${s.name} ${D(s.adjInc)}`).join(", ")}.`,
    "",
    "Source: Bureau of Economic Analysis, Regional Economic Accounts (SASUMMARY: per capita income, Regional Price Parity).",
    "",
    engagementCTA("ranking", `bea-purchasing-power-${stamp()}`),
  ];

  const lines = [
    `State purchasing power check (${stamp()})`,
    "",
    "Facebook post",
    "-------------",
    facebook.join("\n"),
    "",
    "Data table",
    "----------",
    "State | Nominal per capita | Nominal rank | Cost of living (RPP) | Adjusted income | Adjusted rank",
    "---|---:|---:|---:|---:|---:",
    ...states
      .filter((s) => nominalRank.has(s.fips) && adjRank.has(s.fips))
      .sort((a, b) => adjRank.get(a.fips) - adjRank.get(b.fips))
      .map((s) => `${s.name} | ${D(s.pcInc)} | ${nominalRank.get(s.fips)} | ${s.prPar.toFixed(1)} | ${D(s.adjInc)} | ${adjRank.get(s.fips)}`),
    "",
    "Source: BEA Regional (SASUMMARY).",
  ];

  mkdirSync(SOCIAL, { recursive: true });
  const outBase = join(SOCIAL, `purchasing-power-income-${stamp()}`);
  writeFileSync(`${outBase}.txt`, lines.join("\n"));
  writeFileSync(`${outBase}.csv`, toCSV(
    ["state", "nominal_per_capita", "nominal_rank", "cost_of_living_rpp", "adjusted_income", "adjusted_rank"],
    states
      .filter((s) => nominalRank.has(s.fips) && adjRank.has(s.fips))
      .map((s) => [s.name, s.pcInc, nominalRank.get(s.fips), s.prPar, s.adjInc, adjRank.get(s.fips)])
  ));
  writeFileSync(`${outBase}.html`, html);
  if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

  console.log("\n" + lines.join("\n"));
  const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
  console.log(`\nFiles: ${files.join(" / ")}`);
})();
