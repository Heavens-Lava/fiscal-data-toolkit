#!/usr/bin/env node
// banking-snapshot.mjs — pull U.S. banking-sector totals from the FDIC API
// (no API key required) and print a clean snapshot of all FDIC-insured banks.
//
// Run:  node scripts/banking-snapshot.mjs
// Data source: https://banks.data.fdic.gov/  (api.fdic.gov/banks)
// Note: FDIC dollar figures are reported in THOUSANDS; we convert to dollars.

const BASE = "https://api.fdic.gov/banks";

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function money(n) {
  const v = Number(n);
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toLocaleString()}`;
}

(async () => {
  try {
    // 1) Find the latest reporting quarter (REPDTE, e.g. 20260331)
    const latest = (await getJSON(
      `${BASE}/financials?fields=REPDTE&sort_by=REPDTE&sort_order=DESC&limit=1&format=json`
    )).data[0].data.REPDTE;

    // 2) Pull every bank's key figures for that quarter (one call covers all ~4,400)
    const rows = (await getJSON(
      `${BASE}/financials?filters=REPDTE:${latest}` +
        `&fields=ASSET,DEP,SC,EQ,NETINC&limit=10000&format=json`
    )).data;

    // FDIC values are in $thousands -> multiply by 1,000 for dollars
    const sum = (k) => rows.reduce((s, r) => s + (Number(r.data[k]) || 0), 0) * 1000;
    const banks = rows.length;
    const assets = sum("ASSET");
    const deposits = sum("DEP");
    const securities = sum("SC"); // mostly Treasuries + gov't-backed mortgage bonds
    const equity = sum("EQ");
    const netIncome = sum("NETINC"); // for the quarter

    const q = `${latest.slice(0, 4)}-Q${Math.ceil(Number(latest.slice(4, 6)) / 3)}`;

    console.log("\n  U.S. BANKING SECTOR SNAPSHOT");
    console.log("  (source: FDIC API — all FDIC-insured institutions, no key required)\n");
    console.log(`  Reporting quarter .......... ${q}  (${banks.toLocaleString()} banks)`);
    console.log(`  Total assets ............... ${money(assets)}`);
    console.log(`  Total deposits (funding) ... ${money(deposits)}   (${(deposits / assets * 100).toFixed(0)}% of assets)`);
    console.log(`  Securities held ............ ${money(securities)}   (${(securities / assets * 100).toFixed(0)}% of assets)`);
    console.log(`    └ mostly U.S. Treasuries & gov't-backed mortgage bonds`);
    console.log(`  Equity capital (cushion) ... ${money(equity)}   (${(equity / assets * 100).toFixed(1)}% of assets)`);
    console.log(`  Net income (this quarter) .. ${money(netIncome)}`);
    console.log("");
    console.log("  How banks make money (the spread):");
    console.log("    They pay low interest on DEPOSITS and earn higher interest on");
    console.log("    LOANS + SECURITIES. The gap (net interest margin) is the profit.");
    console.log("");
  } catch (err) {
    console.error("Failed to fetch FDIC data:", err.message);
    process.exit(1);
  }
})();
