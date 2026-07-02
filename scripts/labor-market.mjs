#!/usr/bin/env node
// labor-market.mjs — U.S. labor market snapshot from FRED (no API key required).
//
// Run:  node scripts/labor-market.mjs
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

// Find the data point closest to a target date string "YYYY-MM-DD"
function nearest(series, targetDate) {
  return series.reduce((best, x) =>
    Math.abs(new Date(x.d) - new Date(targetDate)) <
    Math.abs(new Date(best.d) - new Date(targetDate)) ? x : best
  );
}

// Return the entry ~12 months before the last point
function oneYearAgo(series) {
  const latestMs = new Date(last(series).d).getTime();
  const targetMs = latestMs - 365 * 24 * 60 * 60 * 1000;
  return nearest(series, new Date(targetMs).toISOString().slice(0, 10));
}

const arrow = (now, then) => now > then ? "▲" : now < then ? "▼" : "–";
const fmt1  = (n) => n.toFixed(1);
const fmt2  = (n) => n.toFixed(2);

(async () => {
  try {
    const [unrate, u6, civpart, primepart, ahe, payems, jolts_open, jolts_quit, jolts_lay] =
      await Promise.all([
        fred("UNRATE"),       // U-3 headline unemployment %
        fred("U6RATE"),       // U-6 broad unemployment %
        fred("CIVPART"),      // civilian labor force participation %
        fred("LNS11300060"),  // prime-age (25-54) participation %
        fred("CES0500000003"),// avg hourly earnings, private sector ($)
        fred("PAYEMS"),       // total nonfarm payrolls (thousands)
        fred("JTSJOL"),       // JOLTS job openings (thousands)
        fred("JTSQUL"),       // JOLTS quits (thousands)
        fred("JTSLDL"),       // JOLTS layoffs & discharges (thousands)
      ]);

    // -- averages
    const avg5yr = (series) => {
      const cutoff = new Date(last(series).d);
      cutoff.setFullYear(cutoff.getFullYear() - 5);
      const slice = series.filter(x => new Date(x.d) >= cutoff);
      return slice.reduce((s, x) => s + x.v, 0) / slice.length;
    };

    // ── SECTION 1: UNEMPLOYMENT ──────────────────────────────────────────────

    const u3Now  = last(unrate);
    const u3Ago  = oneYearAgo(unrate);
    const u3Avg5 = avg5yr(unrate);

    const u6Now  = last(u6);
    const u6Ago  = oneYearAgo(u6);
    const u6Avg5 = avg5yr(u6);

    const u3Trend = u3Now.v < u3Ago.v ? "improving" : u3Now.v > u3Ago.v ? "deteriorating" : "flat";

    console.log("\n  U.S. LABOR MARKET SNAPSHOT  (source: FRED / BLS — no key required)\n");

    console.log("  ── 1. UNEMPLOYMENT ─────────────────────────────────────────────────────");
    console.log(`  U-3 (headline)     ${fmt1(u3Now.v)}%   ${arrow(u3Now.v, u3Ago.v)} vs 1yr ago: ${fmt1(u3Ago.v)}%   5yr avg: ${fmt1(u3Avg5)}%   (${u3Now.d.slice(0,7)})`);
    console.log(`  U-6 (broad)        ${fmt1(u6Now.v)}%   ${arrow(u6Now.v, u6Ago.v)} vs 1yr ago: ${fmt1(u6Ago.v)}%   5yr avg: ${fmt1(u6Avg5)}%`);
    console.log(`  Trend: ${u3Trend}  (U-6 includes discouraged workers + involuntary part-time)`);

    // ── SECTION 2: PARTICIPATION ─────────────────────────────────────────────

    const cpNow  = last(civpart);
    const cpAgo  = oneYearAgo(civpart);
    const cpFeb20 = nearest(civpart, "2020-02-01");

    const ppNow  = last(primepart);
    const ppAgo  = oneYearAgo(primepart);
    const ppFeb20 = nearest(primepart, "2020-02-01");

    console.log("\n  ── 2. LABOR FORCE PARTICIPATION ────────────────────────────────────────");
    console.log(`  Overall (16+)      ${fmt1(cpNow.v)}%   ${arrow(cpNow.v, cpAgo.v)} vs 1yr ago: ${fmt1(cpAgo.v)}%   pre-COVID (Feb 2020): ${fmt1(cpFeb20.v)}%`);
    console.log(`  Prime-age (25-54)  ${fmt1(ppNow.v)}%   ${arrow(ppNow.v, ppAgo.v)} vs 1yr ago: ${fmt1(ppAgo.v)}%   pre-COVID (Feb 2020): ${fmt1(ppFeb20.v)}%`);
    console.log("  Prime-age is the cleanest gauge — it strips out aging/retirement distortions.");

    // ── SECTION 3: WAGES ─────────────────────────────────────────────────────

    const aheNow = last(ahe);
    const aheAgo = oneYearAgo(ahe);
    const aheYoY = ((aheNow.v - aheAgo.v) / aheAgo.v) * 100;
    const realNote = aheYoY > 3.5
      ? "above ~3% inflation — real wages growing"
      : aheYoY > 2.0
      ? "near ~2–3% inflation — roughly flat real wages"
      : "below ~2% target inflation — purchasing power lagging";

    console.log("\n  ── 3. WAGES ─────────────────────────────────────────────────────────────");
    console.log(`  Avg hourly earnings   $${fmt2(aheNow.v)}/hr   (${aheNow.d.slice(0,7)})`);
    console.log(`  YoY wage growth       +${fmt1(aheYoY)}%   (vs $${fmt2(aheAgo.v)}/hr a year ago)`);
    console.log(`  Context: ${realNote}`);

    // ── SECTION 4: JOLTS ─────────────────────────────────────────────────────

    const joNow  = last(jolts_open);
    const joAgo  = oneYearAgo(jolts_open);
    const joPeak = jolts_open.reduce((best, x) => x.v > best.v ? x : best);

    const jqNow  = last(jolts_quit);
    const jqAgo  = oneYearAgo(jolts_quit);

    const jlNow  = last(jolts_lay);
    const jlAgo  = oneYearAgo(jolts_lay);

    const toM = (thousands) => (thousands / 1000).toFixed(2); // thousands -> millions

    console.log("\n  ── 4. JOB MARKET HEALTH (JOLTS) ────────────────────────────────────────");
    console.log(`  Job openings   ${toM(joNow.v)}M   ${arrow(joNow.v, joAgo.v)} vs 1yr ago: ${toM(joAgo.v)}M   (${joNow.d.slice(0,7)})`);
    console.log(`    Peak: ${toM(joPeak.v)}M (${joPeak.d.slice(0,7)}) — openings have cooled significantly since 2022`);
    console.log(`  Quits          ${toM(jqNow.v)}M   ${arrow(jqNow.v, jqAgo.v)} vs 1yr ago: ${toM(jqAgo.v)}M   (workers confident enough to leave)`);
    console.log(`  Layoffs        ${toM(jlNow.v)}M   ${arrow(jlNow.v, jlAgo.v)} vs 1yr ago: ${toM(jlAgo.v)}M`);
    console.log("  High quits = workers confident. Rising layoffs = stress signal.");

    // ── SECTION 5: PAYROLL MOMENTUM ──────────────────────────────────────────

    const n = payems.length;
    const lastThree = [
      { d: payems[n-1].d, jobs: (payems[n-1].v - payems[n-2].v) * 1000 },
      { d: payems[n-2].d, jobs: (payems[n-2].v - payems[n-3].v) * 1000 },
      { d: payems[n-3].d, jobs: (payems[n-3].v - payems[n-4].v) * 1000 },
    ];
    const fmtJobs = (j) => {
      const sign = j >= 0 ? "+" : "";
      return `${sign}${j.toLocaleString()}`;
    };

    console.log("\n  ── 5. PAYROLL MOMENTUM (monthly job gains) ─────────────────────────────");
    for (const m of lastThree) {
      console.log(`  ${m.d.slice(0,7)}   ${fmtJobs(m.jobs).padStart(8)} jobs`);
    }
    console.log("  Healthy pace: ~150,000–200,000/month (keeps up with population growth).");

    console.log("");
  } catch (err) {
    console.error("Failed to fetch labor market data:", err.message);
    process.exit(1);
  }
})();
