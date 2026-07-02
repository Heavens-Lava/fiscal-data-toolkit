#!/usr/bin/env node
// spending-by-category.mjs — federal spending broken down by budget function
// (Social Security, Medicare, Defense, Net Interest, Health, …), ranked biggest
// first. From the USAspending.gov API — no key required.
//
// Run:  node scripts/spending-by-category.mjs           (latest complete FY)
//       node scripts/spending-by-category.mjs 2024
// Data source: https://www.usaspending.gov/  (Spending Explorer API)
//
// NOTE: these are GROSS budget-function totals — they sum higher than the ~$7T
// net budget because they include intragovernmental transfers (e.g. gross
// Medicare ~$1.8T vs ~$870B net of premiums). Great for RANKING categories;
// for net dollar levels see fiscal-snapshot.mjs / the MTS.

const FY = process.argv[2] || "2025";

const money = (n) => `$${(n / 1e9).toFixed(1)}B`;

(async () => {
  try {
    const res = await fetch("https://api.usaspending.gov/api/v2/spending/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "budget_function", filters: { fy: String(FY), quarter: "4" } }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const rows = ((await res.json()).results || [])
      .map((r) => ({ name: r.name, amount: Number(r.amount) || 0 }))
      .filter((r) => r.name !== "Unreported Data" && r.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    if (!rows.length) throw new Error(`no data for FY${FY} (try a completed fiscal year)`);
    const total = rows.reduce((s, r) => s + r.amount, 0);

    console.log(`\n  FEDERAL SPENDING BY CATEGORY — FY${FY}  (gross, ranked)`);
    console.log("  source: USAspending.gov (budget function)\n");
    console.log("  #   Category                                   Amount     Share");
    console.log("  ──  ─────────────────────────────────────────  ─────────  ─────");
    rows.forEach((r, i) => {
      const bar = "█".repeat(Math.round((r.amount / rows[0].amount) * 14));
      console.log(
        `  ${String(i + 1).padStart(2)}  ${r.name.slice(0, 42).padEnd(42)}  ${money(r.amount).padStart(9)}  ${(r.amount / total * 100).toFixed(1).padStart(4)}%  ${bar}`
      );
    });
    console.log(`\n  Total (gross): ${money(total)}`);
    console.log("  Top 4 categories are the mandatory + interest core that no budget easily cuts.\n");
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();
