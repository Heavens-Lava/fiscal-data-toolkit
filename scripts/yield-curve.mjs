#!/usr/bin/env node
// yield-curve.mjs — U.S. Treasury yield curve snapshot and recession spread indicators.
// Pulls from FRED (St. Louis Fed) — no API key required.
//
// Run:  node scripts/yield-curve.mjs
// Data source: https://fred.stlouisfed.org/  (keyless fredgraph CSV)

async function fred(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!res.ok) throw new Error(`${res.status} for ${id}`);
  return (await res.text())
    .trim().split("\n").slice(1)
    .map((l) => { const [d, v] = l.split(","); return { d, v: Number(v) }; })
    .filter((x) => Number.isFinite(x.v) && x.v !== 0);
}
const last = (a) => a[a.length - 1];
const pct = (v) => `${v.toFixed(2)}%`;
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

function closest(series, targetMs) {
  return series.reduce((best, pt) => {
    const d = Math.abs(Date.parse(pt.d) - targetMs);
    return d < Math.abs(Date.parse(best.d) - targetMs) ? pt : best;
  });
}

(async () => {
  try {
    const [m1, m3, m6, y1, y2, y5, y10, y20, y30, sp10y2y, sp10y3m] = await Promise.all([
      fred("DGS1MO"), fred("DGS3MO"), fred("DGS6MO"),
      fred("DGS1"),   fred("DGS2"),   fred("DGS5"),
      fred("DGS10"),  fred("DGS20"),  fred("DGS30"),
      fred("T10Y2Y"), fred("T10Y3M"),
    ]);

    const maturities = [
      { label: "1-Month",  series: m1  },
      { label: "3-Month",  series: m3  },
      { label: "6-Month",  series: m6  },
      { label: "1-Year",   series: y1  },
      { label: "2-Year",   series: y2  },
      { label: "5-Year",   series: y5  },
      { label: "10-Year",  series: y10 },
      { label: "20-Year",  series: y20 },
      { label: "30-Year",  series: y30 },
    ];

    const latestDate  = last(y10).d;
    const latestMs    = Date.parse(latestDate);
    const ago1yrMs    = latestMs - 365 * 86_400_000;
    const ago2yrMs    = latestMs - 730 * 86_400_000;

    console.log("\n  U.S. TREASURY YIELD CURVE  (source: FRED — no key)\n");
    console.log(`  As of: ${latestDate}\n`);

    console.log(`  ${pad("Maturity", 10)} ${lpad("Now", 7)} ${lpad("1yr ago", 7)} ${lpad("2yr ago", 7)} ${lpad("Chg 1yr", 7)}`);
    console.log(`  ${"-".repeat(46)}`);

    for (const { label, series } of maturities) {
      const now   = last(series).v;
      const y1ago = closest(series, ago1yrMs).v;
      const y2ago = closest(series, ago2yrMs).v;
      const chg   = now - y1ago;
      const sign  = chg >= 0 ? "+" : "";
      console.log(`  ${pad(label, 10)} ${lpad(pct(now), 7)} ${lpad(pct(y1ago), 7)} ${lpad(pct(y2ago), 7)} ${lpad(sign + pct(chg), 8)}`);
    }

    // Section 2 — spread / inversion
    const cur10y2y = last(sp10y2y).v;
    const cur10y3m = last(sp10y3m).v;

    const inv10y2y = sp10y2y.filter((p) => p.v < 0);
    let consec10y2y = 0;
    for (let i = sp10y2y.length - 1; i >= 0; i--) {
      if (sp10y2y[i].v < 0) consec10y2y++;
      else break;
    }

    const inv10y3m = sp10y3m.filter((p) => p.v < 0);
    let consec10y3m = 0;
    for (let i = sp10y3m.length - 1; i >= 0; i--) {
      if (sp10y3m[i].v < 0) consec10y3m++;
      else break;
    }

    const invertedFlag = (v) => v < 0 ? " ⚠ INVERTED" : "";
    const consecStr = (days) => days > 0 ? `${days} days inverted` : "not inverted";

    console.log(`\n  SPREAD / INVERSION STATUS\n`);
    console.log(`  ${pad("Spread", 14)} ${lpad("Value", 8)}   Status`);
    console.log(`  ${"-".repeat(50)}`);
    console.log(`  ${pad("10Y minus 2Y", 14)} ${lpad(pct(cur10y2y), 8)}   ${consecStr(consec10y2y)}${invertedFlag(cur10y2y)}`);
    console.log(`  ${pad("10Y minus 3M", 14)} ${lpad(pct(cur10y3m), 8)}   ${consecStr(consec10y3m)}${invertedFlag(cur10y3m)}`);

    // Section 3 — historical context (10Y last 5 years)
    const fiveYrMs = latestMs - 5 * 365 * 86_400_000;
    const y10recent = y10.filter((p) => Date.parse(p.d) >= fiveYrMs);
    const peak10y   = y10recent.reduce((a, b) => b.v > a.v ? b : a);
    const trough10y = y10recent.reduce((a, b) => b.v < a.v ? b : a);

    console.log(`\n  10-YEAR YIELD — LAST 5 YEARS\n`);
    console.log(`  Peak  : ${pct(peak10y.v)}  (${peak10y.d})`);
    console.log(`  Trough: ${pct(trough10y.v)}  (${trough10y.d})`);
    console.log(`  Now   : ${pct(last(y10).v)}\n`);

  } catch (err) {
    console.error("Failed to fetch yield-curve data:", err.message);
    process.exit(1);
  }
})();
