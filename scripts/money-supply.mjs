#!/usr/bin/env node
// money-supply.mjs — pull U.S. money-supply figures from FRED (St. Louis Fed)
// and show how much money was "printed" during the 2020–2021 expansion.
//
// Run:  node scripts/money-supply.mjs
// Data source: FRED (fred.stlouisfed.org) — uses the keyless fredgraph CSV export.
// Scope: UNITED STATES ONLY (USD money supply). There is no single global figure.

// Fetch a FRED series as [{ ym: 'YYYY-MM', value: Number }], oldest -> newest.
async function fredSeries(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${id}`);
  const text = await res.text();
  return text
    .trim()
    .split("\n")
    .slice(1) // drop header row
    .map((line) => {
      const [date, raw] = line.split(",");
      return { ym: date.slice(0, 7), value: Number(raw) };
    })
    .filter((r) => Number.isFinite(r.value)); // FRED uses "." for missing
}

const at = (rows, ym) => rows.find((r) => r.ym === ym)?.value;
const last = (rows) => rows[rows.length - 1];
const T = (billions) => `$${(billions / 1000).toFixed(2)}T`;

(async () => {
  try {
    const [m2, cash] = await Promise.all([fredSeries("M2SL"), fredSeries("CURRCIR")]);

    const m2Now = last(m2);
    const cashNow = last(cash);

    // The 2020–2021 expansion: pre-pandemic (Feb 2020) vs end of 2021.
    const base = at(m2, "2020-02"); // pre-COVID baseline
    const end = at(m2, "2021-12"); // after the surge
    const printed = end - base;
    const growthVsBefore = (printed / base) * 100; // "M2 grew BY x%"
    const shareOfEnd = (printed / end) * 100; // "x% of all dollars then existing"

    console.log("\n  U.S. MONEY SUPPLY  (source: FRED / Federal Reserve — USA only)\n");
    console.log(`  M2 money supply ............ ${T(m2Now.value)}   (as of ${m2Now.ym})`);
    console.log(`  Physical cash in circ. ..... ${T(cashNow.value)}   (as of ${cashNow.ym})`);
    console.log(`    └ most "money" is digital, not printed bills\n`);

    console.log("  The 2020–2021 money printing:");
    console.log(`    M2 in Feb 2020 ........... ${T(base)}`);
    console.log(`    M2 in Dec 2021 ........... ${T(end)}`);
    console.log(`    Created in ~22 months .... ${T(printed)}`);
    console.log(`    = M2 grew by .............. ${growthVsBefore.toFixed(0)}%  (the famous "~40%")`);
    console.log(`    = share of all dollars then ${shareOfEnd.toFixed(0)}%  (same fact, other denominator)\n`);
  } catch (err) {
    console.error("Failed to fetch money-supply data:", err.message);
    process.exit(1);
  }
})();
