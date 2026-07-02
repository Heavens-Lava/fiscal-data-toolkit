#!/usr/bin/env node
// inflation.mjs — U.S. inflation broken down by category, using FRED data.
// Shows CPI/PCE headline numbers, category breakdown, and short-run trend.
//
// Run:  node scripts/inflation.mjs
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

// Find the entry whose date is closest to a target date string (YYYY-MM-DD).
function closest(series, targetDate) {
  const ts = new Date(targetDate).getTime();
  return series.reduce((best, cur) => {
    const diff = Math.abs(new Date(cur.d).getTime() - ts);
    const bestDiff = Math.abs(new Date(best.d).getTime() - ts);
    return diff < bestDiff ? cur : best;
  });
}

// Shift a YYYY-MM-DD date back by approximately n months (via JS Date arithmetic).
function monthsAgo(dateStr, n) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

// YoY % from index series: find value ~12 months before latest, compute rate.
function yoy(series) {
  const now = last(series);
  const ago = closest(series, monthsAgo(now.d, 12));
  return ((now.v / ago.v) - 1) * 100;
}

// Annualized rate over n months.
function annualized(series, n) {
  const now = last(series);
  const ago = closest(series, monthsAgo(now.d, n));
  return (Math.pow(now.v / ago.v, 12 / n) - 1) * 100;
}

// Format a percent with leading sign.
function pct(v) {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

// Mini ASCII bar: scale so 10% = full bar (20 chars).
function bar(v, maxPct = 10, width = 20) {
  const filled = Math.round(Math.min(Math.abs(v) / maxPct, 1) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// Fixed-width right-pad / left-pad helpers.
const rpad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

(async () => {
  try {
    const [
      cpi,      // CPIAUCSL   — Headline CPI All Items
      cpiCore,  // CPILFESL   — Core CPI (ex food & energy)
      shelter,  // CUSR0000SAH1 — Shelter
      foodHome, // CUSR0000SAF11 — Food at home (groceries)
      foodAway, // CUSR0000SEFV — Food away from home (restaurants)
      gas,      // CUSR0000SETB01 — Gasoline
      medical,  // CPIMEDSL   — Medical care
      services, // CUSR0000SAS — Services ex energy services
      pce,      // PCEPI      — PCE
      pceCore,  // PCEPILFE   — Core PCE
    ] = await Promise.all([
      fred("CPIAUCSL"),
      fred("CPILFESL"),
      fred("CUSR0000SAH1"),
      fred("CUSR0000SAF11"),
      fred("CUSR0000SEFV"),
      fred("CUSR0000SETB01"),
      fred("CPIMEDSL"),
      fred("CUSR0000SAS"),
      fred("PCEPI"),
      fred("PCEPILFE"),
    ]);

    const cpiDate  = last(cpi).d.slice(0, 7);
    const pceDate  = last(pce).d.slice(0, 7);
    const TARGET   = 2.0;

    // ── compute rates ────────────────────────────────────────────────────────
    const rCpi      = yoy(cpi);
    const rCpiCore  = yoy(cpiCore);
    const rPce      = yoy(pce);
    const rPceCore  = yoy(pceCore);

    const rShelter  = yoy(shelter);
    const rFoodHome = yoy(foodHome);
    const rFoodAway = yoy(foodAway);
    const rGas      = yoy(gas);
    const rMedical  = yoy(medical);
    const rServices = yoy(services);

    const cpi6m  = annualized(cpi, 6);
    const cpi3m  = annualized(cpi, 3);

    // ── Section 1: Headline numbers ──────────────────────────────────────────
    console.log("\n  U.S. INFLATION SNAPSHOT  (source: FRED / BLS / BEA — no key)\n");

    const vs = (v) => v > TARGET ? "above target" : "below target";

    console.log("  ┌─ HEADLINE MEASURES ─────────────────────────────────────────────┐");
    console.log(`  │  Headline CPI   ${lpad(pct(rCpi), 6)}   (as of ${cpiDate})  ${vs(rCpi).padEnd(13)}  │`);
    console.log(`  │  Core CPI       ${lpad(pct(rCpiCore), 6)}   (ex food & energy)  ${vs(rCpiCore).padEnd(13)}  │`);
    console.log(`  │  PCE            ${lpad(pct(rPce), 6)}   (as of ${pceDate})  ${vs(rPce).padEnd(13)}  │`);
    console.log(`  │  Core PCE       ${lpad(pct(rPceCore), 6)}   (Fed's preferred)    ${vs(rPceCore).padEnd(13)}  │`);
    console.log(`  │  Fed target      +2.0%                                           │`);
    console.log("  └─────────────────────────────────────────────────────────────────┘\n");

    // ── Section 2: CPI breakdown by category ────────────────────────────────
    const categories = [
      { name: "Shelter",                  rate: rShelter  },
      { name: "Food at home (groceries)", rate: rFoodHome },
      { name: "Food away from home",      rate: rFoodAway },
      { name: "Gasoline",                 rate: rGas      },
      { name: "Medical care",             rate: rMedical  },
      { name: "Services (ex energy)",     rate: rServices },
    ].sort((a, b) => b.rate - a.rate);

    console.log("  CPI BREAKDOWN BY CATEGORY  (YoY, highest to lowest)\n");
    console.log(`  ${"Category".padEnd(28)} ${"YoY%".padStart(6)}   ${"bar (each █ ≈ 0.5%)".padEnd(22)}`);
    console.log(`  ${"─".repeat(28)} ${"─".repeat(6)}   ${"─".repeat(22)}`);
    for (const { name, rate } of categories) {
      console.log(`  ${rpad(name, 28)} ${lpad(pct(rate), 6)}   ${bar(rate)}`);
    }
    console.log("");

    // ── Section 3: Trend (headline CPI) ─────────────────────────────────────
    console.log("  HEADLINE CPI TREND (annualized rates — is inflation speeding up?)\n");

    const arrow = (short, long) => {
      if (short > long + 0.3) return "accelerating ↑";
      if (short < long - 0.3) return "decelerating ↓";
      return "roughly stable →";
    };

    console.log(`  YoY  (12-month)  ${lpad(pct(rCpi), 6)}`);
    console.log(`  6-month annlzd   ${lpad(pct(cpi6m), 6)}`);
    console.log(`  3-month annlzd   ${lpad(pct(cpi3m), 6)}   ← most recent pulse`);
    console.log("");
    console.log(`  Trend vs year-ago pace: ${arrow(cpi3m, rCpi)}`);
    if (cpi3m < rCpi - 0.3) {
      console.log("  (3-month rate below YoY → recent months are pulling the average down)");
    } else if (cpi3m > rCpi + 0.3) {
      console.log("  (3-month rate above YoY → recent months are pushing the average up)");
    }
    console.log("");

  } catch (err) {
    console.error("Failed to fetch inflation data:", err.message);
    process.exit(1);
  }
})();
