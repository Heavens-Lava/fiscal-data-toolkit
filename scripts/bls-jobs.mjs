#!/usr/bin/env node
// bls-jobs.mjs — U.S. employment by industry sector using FRED data (mirrors BLS CES).
// No API key required.
//
// Run:  node scripts/bls-jobs.mjs
// Data source: https://fred.stlouisfed.org/  (keyless fredgraph CSV)

async function fred(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!res.ok) return [];   // skip missing series gracefully
  return (await res.text())
    .trim().split("\n").slice(1)
    .map((l) => { const [d, v] = l.split(","); return { d, v: Number(v) }; })
    .filter((x) => Number.isFinite(x.v));
}

const last = (a) => a[a.length - 1];

function closest(series, targetDate) {
  const ms = Date.parse(targetDate);
  return series.reduce((best, pt) =>
    Math.abs(Date.parse(pt.d) - ms) < Math.abs(Date.parse(best.d) - ms) ? pt : best
  );
}

function oneYearAgo(series) {
  const latestMs = Date.parse(last(series).d);
  return closest(series, new Date(latestMs - 365 * 86_400_000).toISOString().slice(0, 10));
}

// Format thousands as "XX.XM" or "X,XXXk" depending on size
function fmtJobs(thousands) {
  if (thousands >= 10_000) return `${(thousands / 1000).toFixed(1)}M`;
  return `${Math.round(thousands).toLocaleString("en-US")}k`;
}

// Format a signed change in thousands (e.g. +234 or -12)
function fmtChg(thousands) {
  const sign = thousands >= 0 ? "+" : "";
  return `${sign}${Math.round(thousands).toLocaleString("en-US")}k`;
}

const rpad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

(async () => {
  try {
    const [
      payems,      // Total nonfarm payrolls
      usmine,      // Mining and logging
      uscons,      // Construction
      manemp,      // Manufacturing (total)
      durable,     // Durable goods manufacturing
      nondurable,  // Nondurable goods manufacturing
      ustrade,     // Trade, transportation, and utilities
      usinfo,      // Information
      usfire,      // Financial activities
      uspbs,       // Professional and business services
      usehs,       // Education and health services
      uslah,       // Leisure and hospitality
      othersvc,    // Other services
      usgovt,      // Government (total)
      fedgov,      // Federal government
      stategov,    // State government
      localgov,    // Local government
      // Avg hourly earnings by sector
      ahePrivate,  // All private employees
      aheMfg,      // Manufacturing
      ahePbs,      // Professional and business services
      aheEhs,      // Education and health services
      aheLah,      // Leisure and hospitality
    ] = await Promise.all([
      fred("PAYEMS"),
      fred("USMINE"),
      fred("USCONS"),
      fred("MANEMP"),
      fred("CEU3100000001"),
      fred("CEU3200000001"),
      fred("USTRADE"),
      fred("USINFO"),
      fred("USFIRE"),
      fred("USPBS"),
      fred("USEHS"),
      fred("USLAH"),
      fred("CEU8000000001"),
      fred("USGOVT"),
      fred("CES9091000001"),
      fred("CES9092000001"),
      fred("CES9093000001"),
      fred("CES0500000003"),
      fred("CES3000000003"),
      fred("CES6000000003"),
      fred("CES6500000003"),
      fred("CES7000000003"),
    ]);

    const asOf = last(payems).d.slice(0, 7);
    console.log(`\n  U.S. EMPLOYMENT BY INDUSTRY SECTOR  (source: FRED / BLS CES — no key)\n  Data as of: ${asOf}\n`);

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 1 — SECTOR EMPLOYMENT TABLE
    // ══════════════════════════════════════════════════════════════════════

    const totalNow  = last(payems).v;
    const totalPrev = payems[payems.length - 2].v;
    const totalAgo  = oneYearAgo(payems).v;

    // Build sector rows. indent = true marks sub-sectors (shown indented, not sorted separately).
    const sectors = [
      { name: "Total nonfarm",               series: payems,    sub: false },
      { name: "Government (total)",           series: usgovt,    sub: false },
      { name: "  Federal",                   series: fedgov,    sub: true  },
      { name: "  State",                     series: stategov,  sub: true  },
      { name: "  Local",                     series: localgov,  sub: true  },
      { name: "Trade, transport & utilities", series: ustrade,   sub: false },
      { name: "Education & health",           series: usehs,     sub: false },
      { name: "Professional & business svc", series: uspbs,     sub: false },
      { name: "Leisure & hospitality",        series: uslah,     sub: false },
      { name: "Manufacturing (total)",        series: manemp,    sub: false },
      { name: "  Durable goods",             series: durable,   sub: true  },
      { name: "  Nondurable goods",          series: nondurable,sub: true  },
      { name: "Financial activities",         series: usfire,    sub: false },
      { name: "Construction",                 series: uscons,    sub: false },
      { name: "Other services",               series: othersvc,  sub: false },
      { name: "Information",                  series: usinfo,    sub: false },
      { name: "Mining & logging",             series: usmine,    sub: false },
    ];

    // Compute stats for each sector
    const rows = sectors.map(({ name, series, sub }) => {
      const now  = last(series).v;
      const prev = series[series.length - 2].v;
      const ago  = oneYearAgo(series).v;
      const mom  = now - prev;
      const yoy  = now - ago;
      const yoyPct = (yoy / ago) * 100;
      const share = (now / totalNow) * 100;
      return { name, now, mom, yoy, yoyPct, share, sub };
    });

    // Sort top-level sectors by size (sub-sectors stay after their parent)
    // We'll print in a custom order: total first, then top-level sorted by size, sub-sectors inline
    const topLevel = rows.filter(r => !r.sub && r.name !== "Total nonfarm")
                         .sort((a, b) => b.now - a.now);
    const totalRow = rows.find(r => r.name === "Total nonfarm");

    // Map from top-level name to its sub-sector rows
    const subMap = {
      "Government (total)":    rows.filter(r => ["  Federal","  State","  Local"].includes(r.name)),
      "Manufacturing (total)": rows.filter(r => ["  Durable goods","  Nondurable goods"].includes(r.name)),
    };

    const printRow = (r) => {
      const jobs   = fmtJobs(r.now).padStart(7);
      const mom    = fmtChg(r.mom).padStart(8);
      const yoy    = fmtChg(r.yoy).padStart(9);
      const yoyp   = `${r.yoyPct >= 0 ? "+" : ""}${r.yoyPct.toFixed(1)}%`.padStart(6);
      const share  = `${r.share.toFixed(1)}%`.padStart(6);
      console.log(`  ${rpad(r.name, 30)} ${jobs}  ${mom}  ${yoy}  ${yoyp}  ${share}`);
    };

    console.log("  ── 1. SECTOR EMPLOYMENT ────────────────────────────────────────────────\n");
    console.log(`  ${"Sector".padEnd(30)} ${"Jobs".padStart(7)}  ${"MoM Chg".padStart(8)}  ${"YoY Chg".padStart(9)}  ${"YoY%".padStart(6)}  ${"Share".padStart(6)}`);
    console.log(`  ${"─".repeat(30)} ${"─".repeat(7)}  ${"─".repeat(8)}  ${"─".repeat(9)}  ${"─".repeat(6)}  ${"─".repeat(6)}`);

    // Print total nonfarm first
    printRow(totalRow);
    console.log(`  ${"─".repeat(30)} ${"─".repeat(7)}  ${"─".repeat(8)}  ${"─".repeat(9)}  ${"─".repeat(6)}  ${"─".repeat(6)}`);

    for (const r of topLevel) {
      printRow(r);
      const subs = subMap[r.name];
      if (subs) {
        for (const s of subs) printRow(s);
      }
    }

    console.log("\n  Jobs in thousands (000s). Seasonally adjusted. SA = seasonally adjusted.");

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 2 — JOB GAINS/LOSSES OVER LAST 3 MONTHS
    // ══════════════════════════════════════════════════════════════════════

    console.log("\n  ── 2. JOB GAINS / LOSSES — LAST 3 MONTHS (total nonfarm) ──────────────\n");

    const n = payems.length;
    const last3 = [
      { d: payems[n-1].d, chg: (payems[n-1].v - payems[n-2].v) * 1_000 },
      { d: payems[n-2].d, chg: (payems[n-2].v - payems[n-3].v) * 1_000 },
      { d: payems[n-3].d, chg: (payems[n-3].v - payems[n-4].v) * 1_000 },
    ];

    const monthName = (dateStr) => {
      const [yr, mo] = dateStr.split("-");
      const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${names[parseInt(mo,10)-1]} ${yr}`;
    };

    for (const m of last3) {
      const sign = m.chg >= 0 ? "+" : "";
      const fmtd = `${sign}${Math.round(m.chg).toLocaleString("en-US")}`;
      const bar  = m.chg >= 150_000 ? " ✓ healthy" : m.chg >= 0 ? " — below healthy pace" : " ✗ job loss";
      console.log(`  ${monthName(m.d).padEnd(10)}  ${fmtd.padStart(10)} jobs${bar}`);
    }

    console.log("\n  Normal healthy pace: ~150,000–200,000/month (keeps up with population growth).");

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 3 — WAGE SNAPSHOT
    // ══════════════════════════════════════════════════════════════════════

    console.log("\n  ── 3. WAGE SNAPSHOT (avg hourly earnings) ──────────────────────────────\n");

    const wageRows = [
      { name: "All private employees",        series: ahePrivate },
      { name: "Professional & business svc",  series: ahePbs     },
      { name: "Education & health",            series: aheEhs     },
      { name: "Manufacturing",                 series: aheMfg     },
      { name: "Leisure & hospitality",         series: aheLah     },
    ].map(({ name, series }) => {
      const now = last(series).v;
      const ago = oneYearAgo(series).v;
      const yoyPct = ((now - ago) / ago) * 100;
      return { name, now, yoyPct };
    }).sort((a, b) => b.now - a.now);

    console.log(`  ${"Sector".padEnd(30)} ${"$/hr".padStart(6)}   ${"YoY%".padStart(6)}`);
    console.log(`  ${"─".repeat(30)} ${"─".repeat(6)}   ${"─".repeat(6)}`);

    for (const r of wageRows) {
      const wage = `$${r.now.toFixed(2)}`.padStart(6);
      const pct  = `${r.yoyPct >= 0 ? "+" : ""}${r.yoyPct.toFixed(1)}%`.padStart(6);
      console.log(`  ${rpad(r.name, 30)} ${wage}   ${pct}`);
    }

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 4 — RECOVERY FROM COVID (vs Feb 2020 pre-COVID peak)
    // ══════════════════════════════════════════════════════════════════════

    console.log("\n  ── 4. RECOVERY FROM COVID  (current vs Feb 2020 pre-COVID peak) ────────\n");

    const covidRef = "2020-02-01";

    const recoveryRows = [
      { name: "Total nonfarm",               series: payems    },
      { name: "Trade, transport & utilities", series: ustrade   },
      { name: "Education & health",           series: usehs     },
      { name: "Professional & business svc", series: uspbs     },
      { name: "Leisure & hospitality",        series: uslah     },
      { name: "Manufacturing (total)",        series: manemp    },
      { name: "Government (total)",           series: usgovt    },
      { name: "Construction",                 series: uscons    },
      { name: "Financial activities",         series: usfire    },
      { name: "Other services",               series: othersvc  },
      { name: "Information",                  series: usinfo    },
      { name: "Mining & logging",             series: usmine    },
    ].map(({ name, series }) => {
      const now   = last(series).v;
      const feb20 = closest(series, covidRef).v;
      const chg   = now - feb20;
      const pct   = (chg / feb20) * 100;
      return { name, now, feb20, chg, pct };
    }).sort((a, b) => b.pct - a.pct);

    console.log(`  ${"Sector".padEnd(30)} ${"Now".padStart(7)}  ${"Feb 2020".padStart(8)}  ${"Change".padStart(9)}  ${"Chg%".padStart(6)}  Status`);
    console.log(`  ${"─".repeat(30)} ${"─".repeat(7)}  ${"─".repeat(8)}  ${"─".repeat(9)}  ${"─".repeat(6)}  ${"─".repeat(14)}`);

    for (const r of recoveryRows) {
      const nowFmt  = fmtJobs(r.now).padStart(7);
      const feb20Fmt= fmtJobs(r.feb20).padStart(8);
      const chgFmt  = fmtChg(r.chg).padStart(9);
      const pctFmt  = `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}%`.padStart(6);
      const status  = r.chg >= 0 ? "RECOVERED" : `still down ${fmtJobs(Math.abs(r.chg))}`;
      console.log(`  ${rpad(r.name, 30)} ${nowFmt}  ${feb20Fmt}  ${chgFmt}  ${pctFmt}  ${status}`);
    }

    console.log("\n  Sectors above Feb 2020 have fully recovered from COVID disruption.");
    console.log("  Persistent deficits suggest structural/permanent job displacement.\n");

  } catch (err) {
    console.error("Failed to fetch employment data:", err.message);
    process.exit(1);
  }
})();
