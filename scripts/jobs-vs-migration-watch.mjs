#!/usr/bin/env node
// jobs-vs-migration-watch.mjs — single sentence this post proves: are people
// actually moving to the states where jobs are growing fastest? State total
// nonfarm payroll growth (BLS, via FRED's per-state series) vs. net domestic
// migration rate (U.S. Census Bureau Population Estimates Program) for the
// same most-recent year. No key required for either source.
//
// Run:  node scripts/jobs-vs-migration-watch.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, fred, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, rel } from "./lib/data-common.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `jobs-vs-migration-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

// ── Net domestic migration rate: Census Population Estimates Program,
// vintage 2025 (flat, well-documented ALLDATA CSV -- much safer to parse
// than the merged-header COMP.xlsx table). ──────────────────────────────
const csvUrl = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/state/totals/NST-EST2025-ALLDATA.csv";
const csvRes = await fetch(csvUrl, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
if (!csvRes.ok) throw new Error(`Census ALLDATA CSV HTTP ${csvRes.status}`);
const csvLines = (await csvRes.text()).trim().split("\n");
const header = csvLines[0].split(",");
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const MIG_YEAR = "2024"; // most recent full year (July 2023 - July 2024) with settled estimates
const migByFips = new Map(
  csvLines.slice(1).map((l) => l.split(","))
    .filter((r) => r[idx.SUMLEV] === "040")
    .map((r) => [r[idx.STATE], { rDomesticMig: Number(r[idx[`RDOMESTICMIG${MIG_YEAR}`]]), netDomesticMig: Number(r[idx[`DOMESTICMIG${MIG_YEAR}`]]) }])
);

// ── Job growth: state total nonfarm payroll employment, July-over-July
// (matching the Census migration-year window), via FRED's per-state series
// (pattern: {2-letter postal abbr}NA, e.g. CANA = California). ──────────
const jobRows = await Promise.all(STATES.map(async (s) => {
  const series = await fred(`${s.abbr}NA`);
  const jul2023 = series.find((r) => r.d === "2023-07-01");
  const jul2024 = series.find((r) => r.d === "2024-07-01");
  if (!jul2023 || !jul2024) return null;
  return { ...s, jobGrowthPct: ((jul2024.v - jul2023.v) / jul2023.v) * 100 };
}));

const rows = jobRows.filter(Boolean)
  .map((r) => {
    const mig = migByFips.get(r.fips);
    if (!mig || !Number.isFinite(mig.rDomesticMig)) return null;
    return { ...r, domesticMigRate: mig.rDomesticMig };
  })
  .filter(Boolean);
if (rows.length < 40) throw new Error(`Only matched ${rows.length} states between FRED jobs data and Census migration data -- too few for a reliable comparison.`);

// Pearson correlation between job growth rate and net domestic migration rate.
function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  return num / Math.sqrt(dx2 * dy2);
}
const r = pearson(rows.map((s) => s.jobGrowthPct), rows.map((s) => s.domesticMigRate));

const byJobGrowth = [...rows].sort((a, b) => b.jobGrowthPct - a.jobGrowthPct).map((s, i) => ({ ...s, jobRank: i + 1 }));
const jobRankByFips = new Map(byJobGrowth.map((s) => [s.fips, s.jobRank]));
const byMigration = [...rows].sort((a, b) => b.domesticMigRate - a.domesticMigRate).map((s, i) => ({ ...s, migRank: i + 1 }));
const ranked = byMigration.map((s) => ({ ...s, jobRank: jobRankByFips.get(s.fips), mismatch: jobRankByFips.get(s.fips) - s.migRank }));

// Mismatch: strong job growth (low jobRank number) but net OUTmigration --
// and the reverse, strong migration despite weak job growth. This is the
// more interesting story than a bare correlation coefficient.
const jobsUpPeopleLeaving = [...ranked].filter((s) => s.jobRank <= 15 && s.domesticMigRate < 0).sort((a, b) => a.domesticMigRate - b.domesticMigRate).slice(0, 3);
const peopleUpJobsWeak = [...ranked].filter((s) => s.jobRank > rows.length - 15).sort((a, b) => b.domesticMigRate - a.domesticMigRate).slice(0, 3);

const topJobGrowth = byJobGrowth.slice(0, 5);
const topMigration = byMigration.slice(0, 5);

const chartRows = [...topMigration.slice(0, 5)].map((s) => ({ label: s.name, v: s.domesticMigRate }));
const chartSVG = horizontalBarChart(
  chartRows.map((r2) => ({ ...r2, color: r2.v >= 0 ? C.s1 : C.neg })),
  { fmtTick: (v) => `${v.toFixed(0)}`, fmtVal: (v) => `${v.toFixed(1)}/1,000` }
);

const html = cardHTML({
  kicker: "Jobs vs. migration check",
  title: "Are people moving to the states where jobs are growing fastest?",
  hero: `r = ${r.toFixed(2)}`,
  heroLabel: "correlation between state job growth and net domestic migration rate",
  chartSVG, source: "BLS state payroll employment (via FRED) & U.S. Census Bureau Population Estimates", vintage: MIG_YEAR,
});

const mismatchLines = [];
if (jobsUpPeopleLeaving.length) {
  const s = jobsUpPeopleLeaving[0];
  mismatchLines.push(`${s.name} ranks #${s.jobRank} of ${rows.length} for job growth (${s.jobGrowthPct.toFixed(1)}%) but still had net domestic OUT-migration (${s.domesticMigRate.toFixed(1)} per 1,000 residents).`);
}
if (peopleUpJobsWeak.length) {
  const s = peopleUpJobsWeak[0];
  mismatchLines.push(`${s.name} had one of the strongest net in-migration rates (${s.domesticMigRate.toFixed(1)} per 1,000) despite ranking only #${s.jobRank} of ${rows.length} for job growth (${s.jobGrowthPct.toFixed(1)}%).`);
}

const facebook = [
  `Across the 50 states + DC, state job growth and net domestic migration rates are only ${Math.abs(r) < 0.3 ? "weakly" : Math.abs(r) < 0.6 ? "moderately" : "strongly"} correlated (r = ${r.toFixed(2)}) for ${MIG_YEAR}. ${mismatchLines.join(" ")}`,
  "",
  `Method: state total nonfarm payroll employment growth, July ${Number(MIG_YEAR) - 1} to July ${MIG_YEAR} (BLS, via FRED), compared to each state's net domestic migration rate for the same year (Census Bureau Population Estimates Program, per 1,000 residents).`,
  "",
  "Fastest job growth:", ...topJobGrowth.map((s) => `#${s.jobRank} ${s.name}: ${s.jobGrowthPct.toFixed(1)}% job growth, ${s.domesticMigRate >= 0 ? "+" : ""}${s.domesticMigRate.toFixed(1)}/1,000 net domestic migration`), "",
  "Strongest net in-migration:", ...topMigration.map((s) => `#${s.migRank} ${s.name}: ${s.domesticMigRate >= 0 ? "+" : ""}${s.domesticMigRate.toFixed(1)}/1,000 net domestic migration, ${s.jobGrowthPct.toFixed(1)}% job growth`), "",
  "This compares job growth to migration WITHIN the same state, not to each other directly -- it can't establish that people moved BECAUSE of jobs (or the reverse). Net domestic migration nets out everyone moving in and out for any reason (housing costs, retirement, family, climate), not just job-seekers, and international migration isn't included.",
  "",
  "Sources: U.S. Bureau of Labor Statistics state total nonfarm payroll employment (via FRED); U.S. Census Bureau Population Estimates Program, Vintage 2025.",
];

const lines = [
  `Jobs vs. migration watch (${STAMP})`, "",
  `Job growth (Jul ${Number(MIG_YEAR) - 1}-Jul ${MIG_YEAR}) vs. net domestic migration rate (${MIG_YEAR}), by state. Correlation r = ${r.toFixed(3)}.`, "",
  "State | Job growth rank | Job growth % | Net domestic migration rank | Net domestic migration (per 1,000)",
  "---|---:|---:|---:|---:",
  ...ranked.map((s) => `${s.name} | ${s.jobRank} | ${s.jobGrowthPct.toFixed(2)} | ${s.migRank} | ${s.domesticMigRate.toFixed(2)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["state", "job_growth_rank", "job_growth_pct", "migration_rank", "net_domestic_migration_per_1000"],
  ranked.map((s) => [s.name, s.jobRank, s.jobGrowthPct.toFixed(2), s.migRank, s.domesticMigRate.toFixed(2)])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
