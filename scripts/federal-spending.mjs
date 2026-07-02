#!/usr/bin/env node
// federal-spending.mjs — U.S. federal spending by budget function and by state.
// Sources: Treasury Fiscal Data API (function breakdown) + USASpending.gov (states).
// No API keys required.
//
// Run:  node scripts/federal-spending.mjs           (defaults to most recently closed FY)
//       node scripts/federal-spending.mjs 2024

const TREASURY = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";
const USASPEND = "https://api.usaspending.gov/api/v2";
const UA_H = { "User-Agent": "fiscal-data-toolkit/1.0" };

// US fiscal year ends Sep 30. Default = most recently completed FY.
const now = new Date();
const FY = parseInt(process.argv[2] || (now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1));

async function getJSON(url) {
  const res = await fetch(url, { headers: UA_H });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...UA_H, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`); }
  return res.json();
}

const money = (n) => {
  const v = Number(n);
  if (!v || isNaN(v)) return "-";
  const s = v < 0 ? "-" : "", a = Math.abs(v);
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9)  return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6)  return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${a.toLocaleString()}`;
};

// Treasury MTS: try a table, returning { date, rows } or null.
async function fetchMTS(table) {
  const sep = `${FY}-09-30`;
  let date;
  try {
    const p = await getJSON(`${TREASURY}/v1/accounting/mts/${table}?filter=record_date:eq:${sep}&page[size]=1`);
    date = p.data?.length ? sep : null;
  } catch { date = null; }

  if (!date) {
    // Fall back to latest record within the target FY
    try {
      const p = await getJSON(
        `${TREASURY}/v1/accounting/mts/${table}?filter=record_fiscal_year:eq:${FY}&sort=-record_date&page[size]=1`
      );
      date = p.data?.[0]?.record_date;
    } catch { return null; }
  }
  if (!date) return null;

  const all = await getJSON(`${TREASURY}/v1/accounting/mts/${table}?filter=record_date:eq:${date}&page[size]=300`);
  return { date, rows: all.data || [] };
}

// Pick an outlay dollar field from the first row.
function pickAmtField(sample) {
  // Prefer FYTD net outlay fields; fall back to gross; last resort any outlay field.
  return (
    Object.keys(sample).find(k => /fytd.*net.*outly|net.*outly.*fytd/i.test(k)) ||
    Object.keys(sample).find(k => /fytd.*outly|outly.*fytd/i.test(k)) ||
    Object.keys(sample).find(k => /gross.*outly|outly.*gross/i.test(k)) ||
    Object.keys(sample).find(k => /outly/i.test(k) && k.includes("amt"))
  );
}

function pickDescField(sample) {
  return (
    Object.keys(sample).find(k => /classification_desc/i.test(k)) ||
    Object.keys(sample).find(k => /agency_nm|bureau_nm/i.test(k)) ||
    Object.keys(sample).find(k => /desc|name/i.test(k))
  );
}

// Spending by state from USASpending.gov
async function getStateSpending() {
  const fyStart = `${FY - 1}-10-01`;
  const fyEnd   = `${FY}-09-30`;
  return post(`${USASPEND}/search/spending_by_geography/`, {
    scope: "recipient_location",
    geo_layer: "state",
    filters: { time_period: [{ start_date: fyStart, end_date: fyEnd }] },
  });
}

// Census state populations for per-capita math.
async function getPopulation() {
  try {
    const rows = await getJSON(
      `https://api.census.gov/data/2023/pep/population?get=NAME,POP_2023&for=state:*`
    );
    const pop = {};
    for (const [name, p] of rows.slice(1)) pop[name] = parseInt(p);
    return pop;
  } catch { return {}; }
}

(async () => {
  console.log(`\n  U.S. Federal Spending — FY${FY}  (Oct ${FY - 1} → Sep ${FY})`);
  console.log("  Source: Treasury Fiscal Data API + USASpending.gov\n");

  // ── Section 1: By Budget Function/Agency ───────────────────────────────────
  // MTS Table 9 = Outlays by Agency and Bureau (FYTD through Sep = full year)
  // MTS Table 5 is a fallback in case table 9 isn't structured as expected.
  let funcPrinted = false;
  for (const table of ["mts_table_9", "mts_table_5"]) {
    if (funcPrinted) break;
    try {
      const d = await fetchMTS(table);
      if (!d?.rows?.length) continue;

      const { date, rows } = d;
      const sample = rows[0];
      const amtField  = pickAmtField(sample);
      const descField = pickDescField(sample);
      if (!amtField || !descField) continue;

      // Keep only positive outlay rows; skip grand-total / memo / offsetting lines.
      const skip = /^(total|subtotal|memo:|offsetting|undistrib|net interest|allowance)/i;
      const meaningful = rows
        .filter(r => {
          const desc = (r[descField] || "").trim();
          const amt  = Number(r[amtField]);
          return desc && amt >= 100_000_000 && !skip.test(desc);
        })
        .sort((a, b) => Number(b[amtField]) - Number(a[amtField]));

      if (!meaningful.length) continue;

      const total = meaningful.reduce((s, r) => s + Number(r[amtField]), 0);

      console.log(`  ── Spending by Budget Function / Agency  (through ${date}) ──────────────`);
      console.log("  Category                                          Amount       Share");
      console.log("  ────────────────────────────────────────────────  ──────────── ──────");
      for (const r of meaningful.slice(0, 35)) {
        const name  = (r[descField] || "").slice(0, 48);
        const amt   = Number(r[amtField]);
        const share = `${(amt / total * 100).toFixed(1)}%`;
        console.log(`  ${name.padEnd(48)}  ${money(amt).padStart(12)}  ${share.padStart(5)}`);
      }
      console.log(`  ${"  TOTAL".padEnd(48)}  ${money(total).padStart(12)}`);
      funcPrinted = true;
    } catch (err) {
      // try next table
    }
  }
  if (!funcPrinted) {
    console.log("  [budget function data unavailable — Treasury API may not have FY data yet]\n");
  }

  // ── Section 2: By State ────────────────────────────────────────────────────
  try {
    const [stateData, pop] = await Promise.all([getStateSpending(), getPopulation()]);
    const states = (stateData?.results || [])
      .filter(s => s.display_name && s.aggregated_amount > 0)
      .sort((a, b) => b.aggregated_amount - a.aggregated_amount);

    if (!states.length) throw new Error("no state results");

    const total  = states.reduce((s, r) => s + r.aggregated_amount, 0);
    const hasPop = Object.keys(pop).length > 0;

    console.log(`\n  ── Federal Spending by State  (FY${FY} — contracts, grants, direct payments) ─`);
    if (hasPop) {
      console.log("  State                          Amount        Share  Per Capita");
      console.log("  ────────────────────────────── ──────────── ──────  ──────────");
    } else {
      console.log("  State                          Amount        Share");
      console.log("  ────────────────────────────── ──────────── ──────");
    }

    for (const s of states) {
      const name     = s.display_name.slice(0, 30);
      const share    = `${(s.aggregated_amount / total * 100).toFixed(1)}%`;
      const statePop = pop[s.display_name];
      const perCap   = statePop ? `$${Math.round(s.aggregated_amount / statePop).toLocaleString()}` : "";
      const line     = `  ${name.padEnd(30)} ${money(s.aggregated_amount).padStart(12)}  ${share.padStart(5)}`;
      console.log(hasPop ? `${line}  ${perCap.padStart(9)}` : line);
    }
    console.log(`\n  Total: ${money(total)} across ${states.length} states/territories`);
    console.log("  Includes: contracts, grants, direct payments (Social Security, SNAP,");
    console.log("  Medicaid, etc.) routed to recipients in each state.");
  } catch (err) {
    console.log(`\n  [state breakdown unavailable: ${err.message}]`);
  }

  console.log();
})();
