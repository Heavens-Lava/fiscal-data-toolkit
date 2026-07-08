#!/usr/bin/env node
// trade-balance.mjs — the U.S. external picture: how much more the country
// consumes than it produces, what that gap is actually made of (goods vs
// services), who the top trading partners are, and how much of America the
// world owns net.
//
// Sections 1-4 pull from FRED (St. Louis Fed, sourced from BEA/Census) — no
// API key required. Section 5 (top trading partners) needs a free Census
// Bureau API key, since Census hard-requires one for its international trade
// API (confirmed: it 302-redirects to a "missing key" page otherwise) — the
// one exception to this toolkit's no-keys rule.
//
//   Get a free key:  https://api.census.gov/data/key_signup.html  (instant, by email)
//   Then either:     export CENSUS_API_KEY=xxxx        (shell)
//              or:    add a line  CENSUS_API_KEY=xxxx   to a .env file in the repo root
//                     (already gitignored — never committed)
//
// Run:  node scripts/trade-balance.mjs
// Data source: https://fred.stlouisfed.org/  (keyless fredgraph CSV)
//              https://api.census.gov/data/timeseries/intltrade/  (needs CENSUS_API_KEY)

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

function getCensusKey() {
  if (process.env.CENSUS_API_KEY) return process.env.CENSUS_API_KEY;
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^CENSUS_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

async function fred(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!res.ok) throw new Error(`${res.status} for ${id}`);
  return (await res.text())
    .trim().split("\n").slice(1)
    .map((l) => { const [d, v] = l.split(","); return { d, v: Number(v) }; })
    .filter((x) => Number.isFinite(x.v));
}
const last = (a) => a[a.length - 1];

// FRED reports these in MILLIONS of dollars.
const fmt = (millions) => {
  const v = millions * 1e6, s = v < 0 ? "-" : "", a = Math.abs(v);
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  return `${s}$${(a / 1e6).toFixed(0)}M`;
};
// Census country trade values are raw dollars, not FRED's dollars-in-millions.
const fmtRawDollars = (dollars) => {
  const s = dollars < 0 ? "-" : "", a = Math.abs(dollars);
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
  return `${s}$${Math.round(a).toLocaleString("en-US")}`;
};
// EXPGS/IMPGS (BEA NIPA) are already reported in BILLIONS, annual rate.
const fmtB = (billions) => fmt(billions * 1000);
const quarter = (d) => `Q${Math.ceil(+d.slice(5, 7) / 3)} ${d.slice(0, 4)}`;
const arrow = (now, then) => now > then ? "▲" : now < then ? "▼" : "–";

// Nearest point to ~365 days before the series' latest date (handles both
// quarterly and monthly series without needing to know the spacing).
function oneYearAgo(series) {
  const latestMs = new Date(last(series).d).getTime();
  const targetMs = latestMs - 365 * 24 * 60 * 60 * 1000;
  return series.reduce((best, x) =>
    Math.abs(new Date(x.d) - targetMs) < Math.abs(new Date(best.d) - targetMs) ? x : best
  );
}

// ── Census international trade (needs CENSUS_API_KEY — see header) ──────────
// Regional/bloc aggregates that ride along with real countries when CTY_CODE=*
// is queried (e.g. "European Union", "OPEC", "Total, All Countries"). Filtered
// by name — Census's own numeric code ranges for these aren't documented well
// enough to filter on reliably, but the names are consistent and readable.
const AGGREGATE_NAME_RE =
  /\b(TOTAL|OPEC|EUROPEAN UNION|EURO AREA|ASEAN|CAFTA|NAFTA|USMCA|APEC|COUNTRY GROUPINGS?|UNIDENTIFIED|SPECIAL CATEGOR|N\.E\.S\.?|NOT SPECIFIED|OTHER (COUNTRIES|ASIA|AFRICA|EUROPE|AMERICA))\b/i;

function isAggregateCensusCode(code) {
  const s = String(code);
  return s === "-" || s.includes("X") || Number(s) < 1000;
}

async function censusCountryTotals(key, direction, time) {
  const valueField = direction === "exports" ? "ALL_VAL_MO" : "GEN_VAL_MO";
  const url = `https://api.census.gov/data/timeseries/intltrade/${direction}/hs` +
    `?get=CTY_NAME,CTY_CODE,${valueField}&time=${time}&CTY_CODE=*&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Census ${direction} HTTP ${res.status}`);
  const rows = await res.json();
  const [header, ...data] = rows;
  const iName = header.indexOf("CTY_NAME"), iCode = header.indexOf("CTY_CODE"), iVal = header.indexOf(valueField);
  const out = new Map();
  for (const r of data) {
    const name = r[iName];
    if (isAggregateCensusCode(r[iCode]) || AGGREGATE_NAME_RE.test(name)) continue;
    out.set(r[iCode], { name, value: Number(r[iVal]) || 0 });
  }
  return out;
}

// Census trade data lags 1-2 months; probe backward from the current month
// for the newest one that actually has data, rather than assuming a fixed lag.
async function findLatestCensusMonth(key) {
  const d = new Date();
  for (let i = 0; i < 6; i++) {
    const time = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const url = `https://api.census.gov/data/timeseries/intltrade/exports/hs?get=CTY_NAME,ALL_VAL_MO&time=${time}&CTY_CODE=*&key=${key}`;
    const res = await fetch(url);
    if (res.ok) {
      const rows = await res.json().catch(() => null);
      if (Array.isArray(rows) && rows.length > 1) return time;
    }
    d.setMonth(d.getMonth() - 1);
  }
  throw new Error("Could not find a recent month with Census trade data");
}

async function topTradingPartners(key, n = 8) {
  const time = await findLatestCensusMonth(key);
  const [exp, imp] = await Promise.all([
    censusCountryTotals(key, "exports", time),
    censusCountryTotals(key, "imports", time),
  ]);
  const codes = new Set([...exp.keys(), ...imp.keys()]);
  const rows = [...codes].map((code) => {
    const e = exp.get(code)?.value || 0, i = imp.get(code)?.value || 0;
    return { name: exp.get(code)?.name || imp.get(code)?.name, exports: e, imports: i, balance: e - i, total: e + i };
  });
  return { time, rows: rows.sort((a, b) => b.total - a.total).slice(0, n) };
}

(async () => {
  try {
    const [ca, trade, niip, gdp, expgs, impgs, goodsBal, svcBal] = await Promise.all([
      fred("IEABC"),        // Balance on current account (quarterly, $M)
      fred("BOPGSTB"),      // Trade balance, goods + services, BOP basis (monthly, $M)
      fred("IIPUSNETIQ"),   // Net international investment position (quarterly, $M)
      fred("GDP"),          // Nominal GDP (quarterly, $B, annual rate)
      fred("EXPGS"),        // Exports of goods & services, NIPA basis (quarterly, $B, annual rate)
      fred("IMPGS"),        // Imports of goods & services, NIPA basis (quarterly, $B, annual rate)
      fred("BOPGTB"),       // Trade balance: goods only, BOP basis (monthly, $M)
      fred("BOPSTB"),       // Trade balance: services only, BOP basis (monthly, $M)
    ]);

    const caL = last(ca), tradeL = last(trade), niipL = last(niip);
    const caAnnual = caL.v * 4;                       // quarterly flow -> annual run-rate
    const tradeAnnual = tradeL.v * 12;                // monthly flow -> annual run-rate
    const gdpM = last(gdp).v * 1000;                  // $B -> $M (already annual rate)
    const caPctGdp = (caAnnual / gdpM) * 100;

    const caAgo = oneYearAgo(ca), tradeAgo = oneYearAgo(trade);

    const expL = last(expgs), impL = last(impgs);
    const goodsL = last(goodsBal), svcL = last(svcBal);

    console.log("\n  U.S. TRADE & EXTERNAL POSITION  (source: FRED / BEA; Census key for Section 5)\n");

    console.log("  ── 1. THE HEADLINE GAP ──────────────────────────────────────────────────");
    console.log(`  Current-account balance .... ${fmt(caL.v)}   (${quarter(caL.d)}; ~${fmt(caAnnual)}/yr)`);
    console.log(`     = ${caPctGdp.toFixed(1)}% of GDP   (broadest measure of trade with the world)`);
    console.log(`     ${arrow(caL.v, caAgo.v)} vs a year ago: ${fmt(caAgo.v)}  (${quarter(caAgo.d)})`);
    console.log(`  Trade balance (goods+svcs) . ${fmt(tradeL.v)}/mo (${tradeL.d.slice(0, 7)}; ~${fmt(tradeAnnual)}/yr)`);
    console.log(`     ${arrow(tradeL.v, tradeAgo.v)} vs a year ago: ${fmt(tradeAgo.v)}/mo  (${tradeAgo.d.slice(0, 7)})`);

    console.log("\n  ── 2. EXPORTS vs IMPORTS (goods+services, annual rate) ─────────────────");
    console.log(`  Exports ..................... ${fmtB(expL.v)}/yr   (${quarter(expL.d)})`);
    console.log(`  Imports ..................... ${fmtB(impL.v)}/yr   (${quarter(impL.d)})`);
    console.log(`  Gap (exports - imports) ..... ${fmtB(expL.v - impL.v)}/yr`);
    console.log("     The U.S. imports meaningfully more than it exports — that gap IS the");
    console.log("     trade deficit above. (NIPA/GDP-basis totals; may differ slightly from");
    console.log("     the BOP-basis monthly figure due to methodology, not a data error.)");

    console.log("\n  ── 3. WHAT MAKES UP THE GAP: GOODS vs SERVICES (monthly, BOP basis) ────");
    console.log(`  Goods balance ............... ${fmt(goodsL.v)}/mo   (~${fmt(goodsL.v * 12)}/yr)`);
    console.log(`  Services balance ............. ${fmt(svcL.v)}/mo   (~${fmt(svcL.v * 12)}/yr)`);
    console.log(`     (${goodsL.d.slice(0, 7)} / ${svcL.d.slice(0, 7)})`);
    console.log("     The entire trade deficit is in GOODS (cars, electronics, oil, etc.) —");
    console.log("     the U.S. actually runs a SERVICES surplus (software, finance, consulting,");
    console.log("     tourism, IP licensing). \"America doesn't make anything anymore\" undersells");
    console.log("     the services side of the ledger.");

    console.log("\n  ── 4. THE CUMULATIVE TAB ────────────────────────────────────────────────");
    console.log(`  Net int'l investment posn ... ${fmt(niipL.v)}   (${quarter(niipL.d)})`);
    console.log("     Current account negative = the U.S. consumes more than it produces.");
    console.log("     That gap is financed by the world buying U.S. assets (Treasuries, stocks,");
    console.log("     real estate) — the reserve-currency privilege.");
    console.log(`     The running total is the net investment position: foreigners own ${fmt(-niipL.v)}`);
    console.log("     MORE of America than Americans own of the rest of the world.");

    console.log("\n  ── 5. TOP TRADING PARTNERS (goods only — Census has no services-by-country) ──");
    const censusKey = getCensusKey();
    if (!censusKey) {
      console.log("     Skipped: needs a free Census API key (this is the one exception to");
      console.log("     this toolkit's no-keys rule — Census hard-requires one for country data).");
      console.log("     Get one: https://api.census.gov/data/key_signup.html");
      console.log("     Then:    export CENSUS_API_KEY=xxxx   (or add it to a .env file in the repo root)\n");
    } else {
      try {
        const { time, rows } = await topTradingPartners(censusKey);
        console.log(`     Goods trade, ${time} (Census Bureau, all commodities):\n`);
        console.log(`     ${"Country".padEnd(20)}  ${"Exports".padStart(9)}  ${"Imports".padStart(9)}  ${"Balance".padStart(10)}`);
        for (const r of rows) {
          console.log(`     ${r.name.slice(0, 20).padEnd(20)}  ${fmtRawDollars(r.exports).padStart(9)}  ${fmtRawDollars(r.imports).padStart(9)}  ${fmtRawDollars(r.balance).padStart(10)}`);
        }
        const biggestDeficit = rows.reduce((a, b) => (b.balance < a.balance ? b : a));
        console.log(`\n     Biggest single-country goods deficit: ${biggestDeficit.name} (${fmtRawDollars(biggestDeficit.balance)}).`);
        console.log("     Note: goods only — Census doesn't publish services trade by country,");
        console.log("     so a country here can show a goods deficit while the full (goods+");
        console.log("     services) picture with that partner looks different.\n");
      } catch (err) {
        console.log(`     Census request failed: ${err.message}`);
        console.log("     (If you just got your key, it can take a few minutes to activate.)\n");
      }
    }
  } catch (err) {
    console.error("Failed to fetch trade data:", err.message);
    process.exit(1);
  }
})();
