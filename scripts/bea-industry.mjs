#!/usr/bin/env node
// bea-industry.mjs — U.S. GDP broken down by industry sector (BEA GDPbyIndustry).
// Shows value added by industry: top industries by size, fastest/slowest growth,
// and a broad sector summary.
//
// Run:  node scripts/bea-industry.mjs
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
  const json = await res.json();
  const results = json.BEAAPI?.Results;
  // GDPbyIndustry returns Results as an array (one entry per table)
  if (Array.isArray(results)) {
    if (results[0]?.Error) throw new Error(results[0].Error.APIErrorDescription);
    return results[0]?.Data || [];
  }
  if (results?.Error) throw new Error(results.Error.APIErrorDescription);
  return results?.Data || [];
}

// DataValue is in billions of current dollars (no UNIT_MULT in this dataset)
function val(row) {
  return Number((row.DataValue || "").replace(/,/g, "")) * 1e9;
}

// ── Formatters ────────────────────────────────────────────────────────────────
function T(n) {
  if (!n || !isFinite(n)) return "-";
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9)  return `${s}$${(a / 1e9).toFixed(1)}B`;
  return `${s}$${Math.round(a / 1e6)}M`;
}

function G(n) {
  if (!isFinite(n)) return "    -";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function pct(part, whole) {
  if (!whole || !isFinite(part / whole)) return "   -";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

// ── Summary-level industry codes ──────────────────────────────────────────────
// These are the NAICS-based 2-digit (or equivalent) codes that represent
// distinct industry segments without double-counting. Excludes aggregates like
// PVT, PSERV, PGOOD, FIRE, ICT, PROF, HS, ORE which are cross-cutting subtotals.
const SUMMARY_CODES = new Set([
  "11",    // Agriculture, forestry, fishing, and hunting
  "21",    // Mining
  "22",    // Utilities
  "23",    // Construction
  "31G",   // Manufacturing (total)
  "42",    // Wholesale trade
  "44RT",  // Retail trade
  "48TW",  // Transportation and warehousing
  "51",    // Information
  "52",    // Finance and insurance
  "53",    // Real estate and rental and leasing
  "54",    // Professional, scientific, and technical services
  "55",    // Management of companies and enterprises
  "56",    // Administrative and waste management services
  "6",     // Educational services, health care, and social assistance
  "7",     // Arts, entertainment, recreation, accommodation, and food services
  "81",    // Other services, except government
  "G",     // Government (total)
]);

// ── Sector groupings ──────────────────────────────────────────────────────────
const SECTORS = [
  { label: "Technology / Information", codes: ["51"] },
  { label: "Finance & Insurance",      codes: ["52"] },
  { label: "Real Estate",              codes: ["53"] },
  { label: "Health & Social Svcs",     codes: ["6"] },
  { label: "Manufacturing",            codes: ["31G"] },
  { label: "Government",               codes: ["G"] },
  { label: "Wholesale & Retail Trade", codes: ["42", "44RT"] },
  { label: "Prof. & Business Svcs",    codes: ["54", "55", "56"] },
  { label: "Transportation & Wrhsg",   codes: ["48TW"] },
  { label: "Arts, Ent. & Hospitality", codes: ["7"] },
  { label: "Construction",             codes: ["23"] },
  { label: "Mining",                   codes: ["21"] },
  { label: "Utilities",                codes: ["22"] },
  { label: "Agriculture",              codes: ["11"] },
  { label: "Other Services",           codes: ["81"] },
];

(async () => {
  console.log("\n  Loading BEA GDPbyIndustry data (2 API calls)...");

  // Fetch two consecutive years so we can compute YoY growth
  const [rows24, rows23] = await Promise.all([
    bea({ method: "GetData", DataSetName: "GDPbyIndustry", TableID: "1", Frequency: "A", Year: "2024", Industry: "ALL" }),
    bea({ method: "GetData", DataSetName: "GDPbyIndustry", TableID: "1", Frequency: "A", Year: "2023", Industry: "ALL" }),
  ]);

  // Determine which year is actually available (BEA may lag)
  const latestYear = rows24.length > 0 ? "2024" : "2023";
  const priorYear  = latestYear === "2024" ? "2023" : "2022";
  const latestRows = latestYear === "2024" ? rows24 : rows23;
  const priorRows  = latestYear === "2024" ? rows23 : null;

  // If we need 2022 as the prior year, fetch it
  let priorData = priorRows;
  if (!priorData) {
    priorData = await bea({ method: "GetData", DataSetName: "GDPbyIndustry", TableID: "1", Frequency: "A", Year: priorYear, Industry: "ALL" });
  }

  // Index rows by Industry code
  function indexRows(rows) {
    const m = {};
    for (const r of rows) m[r.Industry] = r;
    return m;
  }

  const latest = indexRows(latestRows);
  const prior  = indexRows(priorData);

  // Total GDP
  const gdpRow  = latest["GDP"];
  const gdpVal  = gdpRow ? val(gdpRow) : NaN;
  const gdpPrior = prior["GDP"] ? val(prior["GDP"]) : NaN;
  const gdpGrowth = gdpVal && gdpPrior ? (gdpVal / gdpPrior - 1) * 100 : NaN;

  // Build summary-level industry list
  const industries = [...SUMMARY_CODES]
    .map(code => {
      const row = latest[code];
      if (!row) return null;
      const v  = val(row);
      const vp = prior[code] ? val(prior[code]) : NaN;
      const growth = v && vp ? (v / vp - 1) * 100 : NaN;
      return { code, desc: row.IndustrYDescription, value: v, prior: vp, growth };
    })
    .filter(Boolean)
    .filter(d => d.value > 0);

  // Sort by size descending
  const bySize = [...industries].sort((a, b) => b.value - a.value);

  // ── Header ──────────────────────────────────────────────────────────────────
  console.log(`\n  U.S. GDP by Industry — ${latestYear}`);
  console.log(`  GDP: ${T(gdpVal)}   YoY growth: ${G(gdpGrowth)}   Source: BEA GDPbyIndustry Table 1\n`);

  // ── Section 1: Top industries by size ───────────────────────────────────────
  console.log("  ── Top Industries by Value Added (current $) ─────────────────────────────────────");
  console.log("  Industry                                      Value Added    % of GDP   YoY%");
  console.log("  ─────────────────────────────────────────── ─────────────  ────────   ──────");

  for (const ind of bySize) {
    const desc = ind.desc.length > 43 ? ind.desc.slice(0, 40) + "..." : ind.desc;
    console.log(
      `  ${desc.padEnd(43)}  ${T(ind.value).padStart(11)}   ${pct(ind.value, gdpVal).padStart(6)}   ${G(ind.growth).padStart(6)}`
    );
  }

  // ── Section 2: Fastest and slowest growing ───────────────────────────────────
  const withGrowth = industries.filter(d => isFinite(d.growth));
  const byGrowth   = [...withGrowth].sort((a, b) => b.growth - a.growth);

  console.log(`\n  ── Fastest Growing Industries (${priorYear}→${latestYear} YoY) ────────────────────────────`);
  console.log("  Industry                                      Value Added    YoY%");
  console.log("  ─────────────────────────────────────────── ─────────────  ──────");
  for (const ind of byGrowth.slice(0, 10)) {
    const desc = ind.desc.length > 43 ? ind.desc.slice(0, 40) + "..." : ind.desc;
    console.log(`  ${desc.padEnd(43)}  ${T(ind.value).padStart(11)}   ${G(ind.growth).padStart(6)}`);
  }

  console.log(`\n  ── Slowest / Shrinking Industries ──────────────────────────────────────────────`);
  console.log("  Industry                                      Value Added    YoY%");
  console.log("  ─────────────────────────────────────────── ─────────────  ──────");
  for (const ind of byGrowth.slice(-5).reverse()) {
    const desc = ind.desc.length > 43 ? ind.desc.slice(0, 40) + "..." : ind.desc;
    console.log(`  ${desc.padEnd(43)}  ${T(ind.value).padStart(11)}   ${G(ind.growth).padStart(6)}`);
  }

  // ── Section 3: Sector summary ────────────────────────────────────────────────
  console.log(`\n  ── Broad Sector Summary ────────────────────────────────────────────────────────`);
  console.log("  Sector                         Value Added    % of GDP   YoY%");
  console.log("  ──────────────────────────── ─────────────  ────────   ──────");

  const sectorRows = SECTORS.map(s => {
    let totalVal = 0, totalPrior = 0, hasPrior = true;
    for (const code of s.codes) {
      const ind = industries.find(d => d.code === code);
      if (!ind) continue;
      totalVal += ind.value;
      if (isFinite(ind.prior)) totalPrior += ind.prior;
      else hasPrior = false;
    }
    const growth = hasPrior && totalPrior > 0 ? (totalVal / totalPrior - 1) * 100 : NaN;
    return { label: s.label, value: totalVal, growth };
  }).filter(s => s.value > 0);

  // Sort sectors by value descending
  sectorRows.sort((a, b) => b.value - a.value);

  for (const s of sectorRows) {
    console.log(
      `  ${s.label.padEnd(30)}  ${T(s.value).padStart(11)}   ${pct(s.value, gdpVal).padStart(6)}   ${G(s.growth).padStart(6)}`
    );
  }

  // Verify totals
  const sectorSum = sectorRows.reduce((acc, s) => acc + s.value, 0);
  console.log("  " + "─".repeat(69));
  console.log(
    `  ${"Sector total (excl. overlaps)".padEnd(30)}  ${T(sectorSum).padStart(11)}   ${pct(sectorSum, gdpVal).padStart(6)}`
  );

  console.log(`\n  Note: Values in current dollars. "6" includes Education + Health + Social`);
  console.log(`  Assistance combined. Government includes federal, state, and local.\n`);
})().catch(err => {
  console.error("\n  Error:", err.message);
  process.exit(1);
});
