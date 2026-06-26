#!/usr/bin/env node
// trade-balance.mjs — the U.S. external picture: how much more the country
// consumes than it produces, and how much of America the world owns net.
// Pulls from FRED (St. Louis Fed, sourced from BEA) — no API key required.
//
// Run:  node scripts/trade-balance.mjs
// Data source: https://fred.stlouisfed.org/  (keyless fredgraph CSV)

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
const quarter = (d) => `Q${Math.ceil(+d.slice(5, 7) / 3)} ${d.slice(0, 4)}`;

(async () => {
  try {
    const [ca, trade, niip, gdp] = await Promise.all([
      fred("IEABC"),        // Balance on current account (quarterly, $M)
      fred("BOPGSTB"),      // Trade balance, goods + services (monthly, $M)
      fred("IIPUSNETIQ"),   // Net international investment position (quarterly, $M)
      fred("GDP"),          // Nominal GDP (quarterly, $B, annual rate)
    ]);

    const caL = last(ca), tradeL = last(trade), niipL = last(niip);
    const caAnnual = caL.v * 4;                       // quarterly flow -> annual run-rate
    const tradeAnnual = tradeL.v * 12;                // monthly flow -> annual run-rate
    const gdpM = last(gdp).v * 1000;                  // $B -> $M (already annual rate)
    const caPctGdp = (caAnnual / gdpM) * 100;

    console.log("\n  U.S. TRADE & EXTERNAL POSITION  (source: FRED / BEA — no key)\n");
    console.log(`  Current-account balance .... ${fmt(caL.v)}   (${quarter(caL.d)}; ~${fmt(caAnnual)}/yr)`);
    console.log(`     = ${caPctGdp.toFixed(1)}% of GDP   (broadest measure of trade with the world)`);
    console.log(`  Trade balance (goods+svcs) . ${fmt(tradeL.v)}/mo (${tradeL.d.slice(0, 7)}; ~${fmt(tradeAnnual)}/yr)`);
    console.log(`  Net int'l investment posn .. ${fmt(niipL.v)}   (${quarter(niipL.d)})`);
    console.log("");
    console.log("  Read it like this:");
    console.log("    Current account negative = the U.S. consumes more than it produces.");
    console.log("    That gap is financed by the world buying U.S. assets (Treasuries, stocks,");
    console.log("    real estate) — the reserve-currency privilege.");
    console.log(`    The cumulative tab is the net investment position: foreigners own ${fmt(-niipL.v)}`);
    console.log("    MORE of America than Americans own of the rest of the world.\n");
  } catch (err) {
    console.error("Failed to fetch trade data:", err.message);
    process.exit(1);
  }
})();
