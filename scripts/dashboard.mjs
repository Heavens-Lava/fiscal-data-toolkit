#!/usr/bin/env node
// dashboard.mjs — the whole U.S. macro picture in one command: government
// finances, trade, money supply, and the banking sector. All live, no API keys.
//
// Run:  node scripts/dashboard.mjs

import { fiscal, trade, money, banking, markets } from "../lib/data.mjs";

const T = (n) => { const a = Math.abs(n), s = n < 0 ? "-" : ""; return a >= 1e12 ? `${s}$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${s}$${(a / 1e9).toFixed(0)}B` : `${s}$${(a / 1e6).toFixed(0)}M`; };
const pct = (n) => `${n.toFixed(1)}%`;

(async () => {
  try {
    console.log("\n  ════════════ U.S. MACRO DASHBOARD ════════════");
    console.log("  live from Treasury · BEA/FRED · FDIC — no API keys\n");
    const [f, t, m, b, k] = await Promise.all([fiscal(), trade(), money(), banking(), markets()]);

    console.log("  GOVERNMENT  (FY" + f.fy + " through " + f.asOf + ")");
    console.log(`    National debt ........ ${T(f.debt)}   (as of ${f.debtDate})`);
    console.log(`    Receipts (taxes) ..... ${T(f.receipts)}`);
    console.log(`    Outlays (spending) ... ${T(f.outlays)}`);
    console.log(`    Deficit .............. ${T(f.deficit)}   (borrowed $${(f.deficit / f.outlays).toFixed(2)} per $1 spent)`);
    console.log(`    Interest so far ...... ${T(f.interestFytd)}   (${pct(f.interestFytd / f.receipts * 100)} of taxes)`);

    console.log("\n  TRADE & WORLD");
    console.log(`    Current account ...... ${T(t.currentAccount)}/qtr   (${pct(t.caPctGdp)} of GDP)`);
    console.log(`    Trade balance ........ ${T(t.tradeBalance)}/mo`);
    console.log(`    Net invest. position . ${T(t.niip)}   (what the world owns of US, net)`);

    console.log("\n  MONEY");
    console.log(`    M2 money supply ...... ${T(m.m2)}   (as of ${m.m2Date})`);
    console.log(`    Cash in circulation .. ${T(m.cash)}`);
    console.log(`    Printed 2020-21 ...... ${T(m.printed2020_21)}   (+${m.printedPct.toFixed(0)}%)`);

    console.log("\n  BANKS  (" + b.quarter + ", " + b.banks.toLocaleString() + " institutions)");
    console.log(`    Total assets ......... ${T(b.assets)}`);
    console.log(`    Deposits ............. ${T(b.deposits)}`);
    console.log(`    Securities held ...... ${T(b.securities)}   (mostly govt debt)`);
    console.log(`    Equity cushion ....... ${T(b.equity)}   (${pct(b.equity / b.assets * 100)} of assets)`);

    console.log("\n  MARKETS");
    console.log(`    S&P 500 .............. ${k.sp500.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`    10-yr Treasury ....... ${k.tenYear.toFixed(2)}%   (drives mortgage rates)`);
    console.log(`    30-yr mortgage ....... ${k.mortgage30.toFixed(2)}%`);
    console.log("\n  ══════════════════════════════════════════════\n");
  } catch (err) {
    console.error("Dashboard failed:", err.message);
    process.exit(1);
  }
})();
