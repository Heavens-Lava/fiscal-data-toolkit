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
// Pass a 4-digit year to pick the FY; pass --contractors for the top-companies view.
const now = new Date();
const ARGS = process.argv.slice(2);
const WANT_CONTRACTORS = ARGS.includes("--contractors");
const FY = parseInt(ARGS.find((a) => /^\d{4}$/.test(a)) || (now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1));

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

// Pick the FYTD dollar field and description field from a sample row.
function pickAmtField(sample) {
  return (
    Object.keys(sample).find(k => /current_fytd_rcpt_outly_amt/i.test(k)) ||
    Object.keys(sample).find(k => /fytd.*rcpt.*outly|fytd.*outly/i.test(k)) ||
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

// 2023 Census Bureau population estimates (hardcoded — avoids Census API key requirement).
function getPopulation() {
  return {
    "Alabama": 5108468, "Alaska": 733583, "Arizona": 7431344, "Arkansas": 3067732,
    "California": 38965193, "Colorado": 5877610, "Connecticut": 3617176, "Delaware": 1031890,
    "Florida": 22610726, "Georgia": 11029227, "Hawaii": 1435138, "Idaho": 1964726,
    "Illinois": 12549689, "Indiana": 6862199, "Iowa": 3207004, "Kansas": 2940865,
    "Kentucky": 4526154, "Louisiana": 4573749, "Maine": 1395722, "Maryland": 6180253,
    "Massachusetts": 7001399, "Michigan": 10037261, "Minnesota": 5737915, "Mississippi": 2939690,
    "Missouri": 6196156, "Montana": 1132812, "Nebraska": 1978379, "Nevada": 3194176,
    "New Hampshire": 1402054, "New Jersey": 9290841, "New Mexico": 2114371, "New York": 19571216,
    "North Carolina": 10835491, "North Dakota": 783926, "Ohio": 11785935, "Oklahoma": 4053824,
    "Oregon": 4233358, "Pennsylvania": 12961683, "Rhode Island": 1095962, "South Carolina": 5373555,
    "South Dakota": 919318, "Tennessee": 7126489, "Texas": 30503301, "Utah": 3417734,
    "Vermont": 647464, "Virginia": 8715698, "Washington": 7812880, "West Virginia": 1770071,
    "Wisconsin": 5892539, "Wyoming": 584057, "District Of Columbia": 678972, "Puerto Rico": 3205691,
  };
}

// Roll subsidiaries up to their parent conglomerate for a cleaner ranking.
function parentOf(name) {
  const n = (name || "").toUpperCase();
  const map = [
    [/LOCKHEED|SIKORSKY/, "Lockheed Martin"],
    [/GENERAL DYNAMICS|ELECTRIC BOAT|BATH IRON/, "General Dynamics"],
    [/RAYTHEON|\bRTX\b|COLLINS AEROSPACE|PRATT & WHITNEY/, "RTX (Raytheon)"],
    [/BOEING/, "Boeing"],
    [/NORTHROP/, "Northrop Grumman"],
    [/L3HARRIS|L-3|HARRIS CORP/, "L3Harris"],
    [/HUNTINGTON INGALLS/, "Huntington Ingalls"],
    [/BAE SYSTEMS/, "BAE Systems"],
    [/GENERAL ELECTRIC|GE AEROSPACE/, "GE Aerospace"],
    [/OPTUM|UNITEDHEALTH/, "Optum (UnitedHealth)"],
    [/HUMANA/, "Humana"],
    [/MCKESSON/, "McKesson"],
    [/AMERISOURCE|CENCORA/, "Cencora (AmerisourceBergen)"],
    [/TRIWEST/, "TriWest Healthcare"],
    [/BOOZ ALLEN/, "Booz Allen Hamilton"],
    [/SCIENCE APPLICATIONS|\bSAIC\b/, "SAIC"],
    [/LEIDOS/, "Leidos"],
    [/NATIONAL TECHNOLOGY & ENGINEERING|SANDIA/, "Sandia National Labs"],
    [/TRIAD NATIONAL|LOS ALAMOS/, "Los Alamos National Lab"],
  ];
  for (const [re, label] of map) if (re.test(n)) return label;
  return (name || "?").replace(/,/g, "").replace(/\b(CORPORATION|CORP|INCORPORATED|INC|COMPANY|LLC|LTD)\b\.?/gi, "").replace(/\s+/g, " ").trim();
}

// Top federal contractors (procurement award types A/B/C/D), rolled up by parent.
async function getContractors() {
  const data = await post(`${USASPEND}/search/spending_by_category/recipient/`, {
    filters: { time_period: [{ start_date: `${FY - 1}-10-01`, end_date: `${FY}-09-30` }], award_type_codes: ["A", "B", "C", "D"] },
    limit: 60,
  });
  const agg = {};
  for (const r of data.results || []) {
    const amt = Number(r.amount) || 0;
    if (amt <= 0) continue;
    const p = parentOf(r.name);
    agg[p] = (agg[p] || 0) + amt;
  }
  return Object.entries(agg).sort((a, b) => b[1] - a[1]);
}

(async () => {
  console.log(`\n  U.S. Federal Spending — FY${FY}  (Oct ${FY - 1} → Sep ${FY})`);
  console.log("  Source: Treasury Fiscal Data API + USASpending.gov\n");

  // ── Contractors view (--contractors): who the government buys from ─────────
  if (WANT_CONTRACTORS) {
    try {
      const rows = await getContractors();
      console.log("  ── Top Federal Contractors  (procurement, rolled up by parent) ─────────");
      console.log("  #   Company                                Amount");
      console.log("  ──  ─────────────────────────────────────  ─────────");
      rows.slice(0, 20).forEach(([name, amt], i) => {
        console.log(`  ${String(i + 1).padStart(2)}  ${name.slice(0, 38).padEnd(38)}  ${money(amt).padStart(9)}`);
      });
      console.log("\n  Procurement contracts only (the government buying goods/services) — separate");
      console.log("  from grants & direct payments (Social Security, Medicaid) to people/states.\n");
    } catch (err) {
      console.log(`  [contractor data unavailable: ${err.message}]\n`);
    }
    return;
  }

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

      // record_type_cd "F" = budget function (outlays), "RSG" = receipts, "SL" = subtotals.
      // Keep only function/outlay rows with a non-null amount.
      const validAmt = (r) => { const v = Number(r[amtField]); return isFinite(v) && v !== 0; };
      const outlayRows  = rows.filter(r => r.record_type_cd === "F"   && validAmt(r));
      const receiptRows = rows.filter(r => r.record_type_cd === "RSG" && validAmt(r));

      // If record_type_cd isn't available (different table), fall back to keyword filter.
      const useRows = outlayRows.length ? outlayRows : rows.filter(r => {
        const desc = (r[descField] || "").trim();
        const amt  = Number(r[amtField]);
        const skip = /^(total|subtotal|memo:|income tax|excise|estate|customs|miscellaneous receipt)/i;
        return desc && amt >= 100_000_000 && !skip.test(desc);
      });

      if (!useRows.length) continue;

      // Sort by amount descending; negative items (offsetting receipts) go to bottom.
      const sorted = [...useRows].sort((a, b) => Number(b[amtField]) - Number(a[amtField]));
      const grossTotal = sorted.filter(r => Number(r[amtField]) > 0).reduce((s, r) => s + Number(r[amtField]), 0);
      const netTotal   = sorted.reduce((s, r) => s + Number(r[amtField]), 0);

      console.log(`  ── Federal Spending by Budget Function  (FY${FY}, through ${date}) ────────`);
      console.log("  Function                                          Amount       Share of gross");
      console.log("  ────────────────────────────────────────────────  ──────────── ─────────────");
      for (const r of sorted) {
        const name  = (r[descField] || "").slice(0, 48);
        const amt   = Number(r[amtField]);
        const share = grossTotal && amt > 0 ? `${(amt / grossTotal * 100).toFixed(1)}%` : (amt < 0 ? "(offset)" : "-");
        console.log(`  ${name.padEnd(48)}  ${money(amt).padStart(12)}  ${share.padStart(13)}`);
      }
      console.log(`  ${"  Gross outlays".padEnd(48)}  ${money(grossTotal).padStart(12)}`);
      console.log(`  ${"  Net outlays (after offsets)".padEnd(48)}  ${money(netTotal).padStart(12)}`);

      // Show where the money comes from (receipts) in a compact block.
      if (receiptRows.length) {
        const recSorted = [...receiptRows].sort((a, b) => Number(b[amtField]) - Number(a[amtField]));
        const recTotal  = recSorted.reduce((s, r) => s + Number(r[amtField]), 0);
        console.log(`\n  ── Funded by (FY${FY} tax receipts) ─────────────────────────────────────`);
        for (const r of recSorted) {
          const name = (r[descField] || "").slice(0, 48);
          const amt  = Number(r[amtField]);
          console.log(`  ${name.padEnd(48)}  ${money(amt).padStart(12)}`);
        }
        console.log(`  ${"  Total receipts".padEnd(48)}  ${money(recTotal).padStart(12)}`);
        console.log(`  ${"  Deficit (borrowed)".padEnd(48)}  ${money(netTotal - recTotal).padStart(12)}`);
      }

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
    const [stateData] = await Promise.all([getStateSpending()]);
    const pop = getPopulation();
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
