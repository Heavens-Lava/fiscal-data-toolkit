#!/usr/bin/env node
// housing.mjs — U.S. housing market snapshot using FRED data (no API key required).
// Covers home prices, mortgage rates, supply indicators, and homeownership rate.
//
// Run:  node scripts/housing.mjs
// Data source: FRED (fred.stlouisfed.org) — keyless fredgraph CSV export.

async function fred(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!res.ok) throw new Error(`${res.status} for ${id}`);
  return (await res.text())
    .trim().split("\n").slice(1)
    .map((l) => { const [d, v] = l.split(","); return { d, v: Number(v) }; })
    .filter((x) => Number.isFinite(x.v));
}

const last  = (a) => a[a.length - 1];
const pad   = (s, n) => String(s).padEnd(n);
const lpad  = (s, n) => String(s).padStart(n);
const pct   = (v, d = 2) => `${v.toFixed(d)}%`;
const sign  = (v) => (v >= 0 ? "+" : "") + v.toFixed(2);

/** Find the data point closest to a given date string (YYYY-MM-DD). */
function closest(series, targetDate) {
  const ms = Date.parse(targetDate);
  return series.reduce((best, pt) =>
    Math.abs(Date.parse(pt.d) - ms) < Math.abs(Date.parse(best.d) - ms) ? pt : best
  );
}

/** Monthly payment on a fixed mortgage: principal * r/12 / (1 - (1+r/12)^-360) */
function monthlyPayment(principal, annualRatePct) {
  const r = annualRatePct / 100;
  const m = r / 12;
  if (m === 0) return principal / 360;
  return principal * m / (1 - Math.pow(1 + m, -360));
}

function fmtUSD(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtThousands(n) {
  // e.g. 1423.0 -> "1,423k"
  return `${Math.round(n).toLocaleString("en-US")}k`;
}

(async () => {
  try {
    const [
      csHPI,       // Case-Shiller National HPI (monthly, 2000=100)
      mort30,      // 30-year fixed mortgage rate (weekly %)
      mort15,      // 15-year fixed mortgage rate (weekly %)
      starts,      // Housing starts, SAAR (thousands)
      permits,     // Building permits, SAAR (thousands)
      supply,      // Monthly supply of new houses (months)
      medPrice,    // Median sales price of new houses (quarterly, dollars)
      ownership,   // Homeownership rate (quarterly %)
    ] = await Promise.all([
      fred("CSUSHPINSA"),
      fred("MORTGAGE30US"),
      fred("MORTGAGE15US"),
      fred("HOUST"),
      fred("PERMIT"),
      fred("MSACSR"),
      fred("MSPUS"),
      fred("RHORUSQ156N"),
    ]);

    // ── reference timestamps ───────────────────────────────────────────────
    const nowMs     = Date.now();
    const ago1yrMs  = nowMs - 365   * 86_400_000;
    const ago2yrMs  = nowMs - 730   * 86_400_000;

    // COVID low for Case-Shiller: trough around March–April 2020
    const covidLowDate = "2020-03-01";

    console.log("\n  U.S. HOUSING MARKET SNAPSHOT  (source: FRED / St. Louis Fed — no key)\n");

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 1 — HOME PRICES (Case-Shiller National HPI)
    // ══════════════════════════════════════════════════════════════════════
    const hpiNow      = last(csHPI);
    const hpi1yrAgo   = closest(csHPI, new Date(ago1yrMs).toISOString().slice(0, 10));
    const hpiCovidLow = closest(csHPI, covidLowDate);
    const hpiPeak     = csHPI.reduce((a, b) => b.v > a.v ? b : a);

    const hpiYoY        = ((hpiNow.v - hpi1yrAgo.v) / hpi1yrAgo.v) * 100;
    const hpiSinceCovid = ((hpiNow.v - hpiCovidLow.v) / hpiCovidLow.v) * 100;

    // Historical average of the full series for context
    const hpiAvg = csHPI.reduce((s, p) => s + p.v, 0) / csHPI.length;

    console.log("  ── HOME PRICES (Case-Shiller National HPI, 2000=100) ──────────────────\n");
    console.log(`  Current index .......... ${hpiNow.v.toFixed(2)}   (as of ${hpiNow.d})`);
    console.log(`  1-year change .......... ${sign(hpiYoY)}%`);
    console.log(`  Since COVID low ........ +${hpiSinceCovid.toFixed(1)}%  (low: ${hpiCovidLow.v.toFixed(2)} on ${hpiCovidLow.d})`);
    console.log(`  All-time peak .......... ${hpiPeak.v.toFixed(2)}  (${hpiPeak.d})`);
    console.log(`  Series avg (${csHPI[0].d.slice(0,7)}–now) ${hpiAvg.toFixed(2)}`);
    const premiumVsAvg = ((hpiNow.v - hpiAvg) / hpiAvg) * 100;
    console.log(`  Current vs avg ......... ${sign(premiumVsAvg)}%  ${premiumVsAvg > 20 ? "(well above long-run trend)" : premiumVsAvg > 0 ? "(above long-run trend)" : "(below long-run trend)"}`);

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 2 — MORTGAGE RATES
    // ══════════════════════════════════════════════════════════════════════
    const r30now    = last(mort30).v;
    const r15now    = last(mort15).v;
    const r30date   = last(mort30).d;

    const r30_1yr   = closest(mort30, new Date(ago1yrMs).toISOString().slice(0, 10)).v;
    const r30_2yr   = closest(mort30, new Date(ago2yrMs).toISOString().slice(0, 10)).v;

    const r30covidLow = mort30.reduce((a, b) => b.v < a.v ? b : a);
    const r15covidLow = mort15.reduce((a, b) => b.v < a.v ? b : a);

    const principal = 400_000;
    const pmtNow    = monthlyPayment(principal, r30now);
    const pmt1yr    = monthlyPayment(principal, r30_1yr);
    const pmtCovid  = monthlyPayment(principal, r30covidLow.v);

    console.log("\n  ── MORTGAGE RATES ─────────────────────────────────────────────────────\n");
    console.log(`  30-yr fixed (current) .. ${pct(r30now)}   (as of ${r30date})`);
    console.log(`  15-yr fixed (current) .. ${pct(r15now)}`);
    console.log(`  30-yr 1yr ago .......... ${pct(r30_1yr)}   (chg: ${sign(r30now - r30_1yr)}%)`);
    console.log(`  30-yr 2yr ago .......... ${pct(r30_2yr)}   (chg: ${sign(r30now - r30_2yr)}%)`);
    console.log(`  30-yr COVID-era low .... ${pct(r30covidLow.v)}  (${r30covidLow.d})`);
    console.log(`  15-yr COVID-era low .... ${pct(r15covidLow.v)}  (${r15covidLow.d})`);
    console.log(`\n  Monthly payment on a $400,000 loan (30-yr fixed):`);
    console.log(`  ${pad("At current rate " + pct(r30now), 34)} ${fmtUSD(pmtNow)}/mo`);
    console.log(`  ${pad("At 1yr-ago rate " + pct(r30_1yr), 34)} ${fmtUSD(pmt1yr)}/mo  (diff: ${fmtUSD(Math.abs(pmtNow - pmt1yr))}/mo)`);
    console.log(`  ${pad("At COVID-low rate " + pct(r30covidLow.v), 34)} ${fmtUSD(pmtCovid)}/mo  (diff: ${fmtUSD(Math.abs(pmtNow - pmtCovid))}/mo)`);

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 3 — SUPPLY (starts, permits, months of supply)
    // ══════════════════════════════════════════════════════════════════════
    const startsNow   = last(starts);
    const permitsNow  = last(permits);
    const supplyNow   = last(supply);
    const medNow      = last(medPrice);

    const starts1yr   = closest(starts,  new Date(ago1yrMs).toISOString().slice(0, 10));
    const permits1yr  = closest(permits, new Date(ago1yrMs).toISOString().slice(0, 10));

    const supplyLabel =
      supplyNow.v < 4 ? "seller's market (<4 months)" :
      supplyNow.v > 6 ? "buyer's market (>6 months)" :
                        "balanced market (4–6 months)";

    console.log("\n  ── SUPPLY ─────────────────────────────────────────────────────────────\n");
    console.log(`  Housing starts ......... ${fmtThousands(startsNow.v)} SAAR  (as of ${startsNow.d})`);
    console.log(`    1yr ago .............. ${fmtThousands(starts1yr.v)} SAAR  (chg: ${sign(startsNow.v - starts1yr.v)}k)`);
    console.log(`  Building permits ....... ${fmtThousands(permitsNow.v)} SAAR  (as of ${permitsNow.d})`);
    console.log(`    1yr ago .............. ${fmtThousands(permits1yr.v)} SAAR  (chg: ${sign(permitsNow.v - permits1yr.v)}k)`);
    console.log(`  Months of supply ....... ${supplyNow.v.toFixed(1)} months  →  ${supplyLabel}`);
    console.log(`  Median new-home price .. ${fmtUSD(medNow.v)}  (as of ${medNow.d})`);

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 4 — HOMEOWNERSHIP RATE
    // ══════════════════════════════════════════════════════════════════════
    const ownNow  = last(ownership);
    const own1yr  = closest(ownership, new Date(ago1yrMs).toISOString().slice(0, 10));

    // Pre-COVID 2019 average: filter all quarters where date starts with "2019"
    const preCovid2019 = ownership.filter((p) => p.d.startsWith("2019"));
    const own2019avg   = preCovid2019.length
      ? preCovid2019.reduce((s, p) => s + p.v, 0) / preCovid2019.length
      : null;

    console.log("\n  ── HOMEOWNERSHIP RATE ─────────────────────────────────────────────────\n");
    console.log(`  Current rate ........... ${pct(ownNow.v)}  (as of ${ownNow.d})`);
    console.log(`  1yr ago ................ ${pct(own1yr.v)}  (chg: ${sign(ownNow.v - own1yr.v)}pp)`);
    if (own2019avg !== null) {
      console.log(`  2019 avg (pre-COVID) ... ${pct(own2019avg)}  (chg vs now: ${sign(ownNow.v - own2019avg)}pp)`);
    }

    console.log("");
  } catch (err) {
    console.error("Failed to fetch housing data:", err.message);
    process.exit(1);
  }
})();
