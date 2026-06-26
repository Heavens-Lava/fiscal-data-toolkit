#!/usr/bin/env node
// fiscal-snapshot.mjs — pull key U.S. federal finance numbers from the
// Treasury Fiscal Data API (no API key required) and print a clean snapshot.
//
// Run:  node scripts/fiscal-snapshot.mjs
// Data source: https://fiscaldata.treasury.gov/  (api.fiscaldata.treasury.gov)

const BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";

async function getJSON(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json();
}

// $39,320,508,743,100 -> "$39.32T" / "$5.23T" / "$628.2B"
function money(n) {
  const v = Number(n);
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toLocaleString()}`;
}

// 1) National debt — "Debt to the Penny" (latest day)
async function getDebt() {
  const d = (await getJSON(
    "/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1"
  )).data[0];
  return { date: d.record_date, total: Number(d.tot_pub_debt_out_amt) };
}

// 2) Receipts / outlays / deficit — MTS Table 1, fiscal-year-to-date totals.
//    Each snapshot carries the current FY and the prior (full) FY.
async function getMTS() {
  const latest = (await getJSON(
    "/v1/accounting/mts/mts_table_1?sort=-record_date&page[size]=1"
  )).data[0].record_date;

  const rows = (await getJSON(
    `/v1/accounting/mts/mts_table_1?filter=record_date:eq:${latest}&page[size]=50`
  )).data.filter((r) => r.classification_desc === "Year-to-Date");

  const byYear = (fy) => {
    const r = rows.find((x) => Number(x.record_fiscal_year) === fy);
    return r && {
      receipts: Number(r.current_month_gross_rcpt_amt),
      outlays: Number(r.current_month_gross_outly_amt),
      deficit: Number(r.current_month_dfct_sur_amt),
    };
  };

  const years = rows.map((r) => Number(r.record_fiscal_year));
  const curFY = Math.max(...years);
  return { asOf: latest, curFY, current: byYear(curFY), priorFY: curFY - 1, prior: byYear(curFY - 1) };
}

// 3) Interest expense on the public debt — sum of all security types, FYTD.
async function getInterest() {
  const latest = (await getJSON(
    "/v2/accounting/od/interest_expense?sort=-record_date&page[size]=1"
  )).data[0].record_date;

  const rows = (await getJSON(
    `/v2/accounting/od/interest_expense?filter=record_date:eq:${latest}&page[size]=100`
  )).data;

  const fytd = rows.reduce((s, r) => s + Number(r.fytd_expense_amt || 0), 0);
  return { asOf: latest, fytd };
}

function pct(part, whole) {
  return `${((part / whole) * 100).toFixed(1)}%`;
}

(async () => {
  try {
    const [debt, mts, interest] = await Promise.all([getDebt(), getMTS(), getInterest()]);

    console.log("\n  U.S. FEDERAL FISCAL SNAPSHOT");
    console.log("  (source: Treasury Fiscal Data API — no key required)\n");

    console.log(`  National debt .............. ${money(debt.total)}   (as of ${debt.date})`);

    if (mts.current) {
      const c = mts.current;
      console.log(`\n  FY${mts.curFY} so far (through ${mts.asOf}):`);
      console.log(`    Receipts (taxes in) ...... ${money(c.receipts)}`);
      console.log(`    Outlays (spending) ....... ${money(c.outlays)}`);
      console.log(`    Deficit .................. ${money(c.deficit)}`);
      console.log(`    Borrowed per $1 spent .... $${(c.deficit / c.outlays).toFixed(2)}`);
    }

    if (mts.prior) {
      const p = mts.prior;
      console.log(`\n  FY${mts.priorFY} (full year, final):`);
      console.log(`    Receipts ................. ${money(p.receipts)}`);
      console.log(`    Outlays .................. ${money(p.outlays)}`);
      console.log(`    Deficit .................. ${money(p.deficit)}`);
    }

    console.log(`\n  Interest on the debt (FY${interest.asOf.slice(0, 4)} to date): ${money(interest.fytd)}`);
    if (mts.current) {
      console.log(`    = ${pct(interest.fytd, mts.current.receipts)} of taxes collected so far`);
    }
    console.log("");
  } catch (err) {
    console.error("Failed to fetch fiscal data:", err.message);
    process.exit(1);
  }
})();
