#!/usr/bin/env node
// tariff-revenue-watch.mjs - how much the federal government actually
// collects in customs duties (tariffs), and the year-over-year trend.
// Treasury Monthly Treasury Statement (MTS) Table 9. No API key required.
//
// Run:  node scripts/tariff-revenue-watch.mjs
//       node scripts/tariff-revenue-watch.mjs --no-image
//
// Note: individual-month figures in this MTS line item can swing wildly
// (including negative, likely refunds/reclassifications) — this script uses
// fiscal-year-to-date cumulative totals, which are far more stable, for the
// headline comparison rather than a single volatile month.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, lineChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const FISCAL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function money(n) {
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

async function fiscal(pathq) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${FISCAL}${pathq}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`FiscalData HTTP ${res.status} for ${pathq}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `tariff-revenue-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

console.log("  Fetching customs duties history from Treasury MTS...");
const data = (await fiscal(
  "/v1/accounting/mts/mts_table_9?filter=classification_desc:eq:Customs%20Duties&sort=-record_date&page[size]=200"
)).data;

if (!data.length) throw new Error("No customs duties rows returned from MTS table 9");

// One row per month; take the latest row per fiscal year for the FYTD total
// (each row's current_fytd_rcpt_outly_amt is already the cumulative total
// through that month within its fiscal year).
const byFY = new Map();
for (const r of data) {
  const fy = Number(r.record_fiscal_year);
  const existing = byFY.get(fy);
  if (!existing || r.record_date > existing.record_date) byFY.set(fy, r);
}

const years = [...byFY.values()]
  .map((r) => ({
    fy: Number(r.record_fiscal_year),
    date: r.record_date,
    fytd: Number(r.current_fytd_rcpt_outly_amt),
  }))
  .sort((a, b) => a.fy - b.fy);

const latest = years[years.length - 1];
const latestRow = byFY.get(latest.fy);
const priorFYTD = Number(latestRow.prior_fytd_rcpt_outly_amt);
const yoyChange = priorFYTD ? ((latest.fytd - priorFYTD) / priorFYTD) * 100 : null;

// US fiscal year runs Oct-Sep, so calendar month 10/11/12 = FY month 1/2/3,
// and calendar month 1-9 = FY month 4-12.
const calMonth = Number(latestRow.record_date.slice(5, 7));
const fyMonthsElapsed = calMonth >= 10 ? calMonth - 9 : calMonth + 3;
const isPartialYear = fyMonthsElapsed < 12;

// Flag the final point as partial-year so it can't be misread as a decline —
// it's the only year not yet complete, and comparing a partial year's total
// against prior FULL years understates it.
const pts = years.map((y, i) => ({
  label: i === years.length - 1 && isPartialYear ? `FY${y.fy}*` : `FY${y.fy}`,
  v: y.fytd / 1e9,
}));
const chartSVG = lineChart(
  [{ color: C.s1, points: pts, endLabel: (v) => v }],
  { fmtTick: (v) => `$${v.toFixed(0)}B`, fmtVal: (v) => `$${v.toFixed(1)}B`, labelStep: 1, yLabel: "Customs duties, FYTD ($B)" }
);

const html = cardHTML({
  kicker: "Tariff revenue check",
  title: "Federal customs duties collected, fiscal-year-to-date",
  hero: money(latest.fytd),
  heroLabel: `FY${latest.fy} YTD (partial year) · through ${latestRow.record_date}`,
  chartSVG,
  source: "US Treasury, Monthly Treasury Statement (Table 9)",
  vintage: latestRow.record_date,
});

// The strongest, cleanest comparison is two consecutive COMPLETE fiscal
// years (no partial-year asterisk needed) — surfaced as the lead hook,
// ahead of the current-year partial comparison.
const lastFullYear = isPartialYear ? years[years.length - 2] : years[years.length - 1];
const priorFullYear = years.find((y) => y.fy === lastFullYear?.fy - 1);
const fullYearMultiple = priorFullYear ? lastFullYear.fytd / priorFullYear.fytd : null;

const facebook = [
  fullYearMultiple != null
    ? `Tariff revenue nearly ${fullYearMultiple.toFixed(1)}x'd in a single year: the federal government collected ${money(lastFullYear.fytd)} in customs duties in FY${lastFullYear.fy}, up from ${money(priorFullYear.fytd)} in FY${priorFullYear.fy} — both complete fiscal years, no partial-year comparison needed.`
    : "Tariff revenue check:",
  "",
  `The federal government has collected ${money(latest.fytd)} in customs duties (tariffs) so far in FY${latest.fy}, through ${latestRow.record_date}.`,
  ...(yoyChange != null ? [`That's ${yoyChange >= 0 ? "up" : "down"} ${Math.abs(yoyChange).toFixed(0)}% from the same point last fiscal year (${money(priorFYTD)}) — a true apples-to-apples, same-point-in-the-fiscal-year comparison.`] : []),
  "",
  ...(isPartialYear ? [
    `Chart-reading note: the last point (FY${latest.fy}*) is only ${fyMonthsElapsed} months into the fiscal year, while every earlier point is a completed full year. Comparing it directly to FY${latest.fy - 1}'s full-year total makes it look like a decline — it isn't. The YoY comparison above (same point in both years) is the real trend.`,
    "",
  ] : []),
  `By fiscal year, cumulative customs duties collected: ${years.map((y) => `FY${y.fy} ${money(y.fytd)}`).join(", ")}.`,
  "",
  "Note: individual-month figures in this Treasury line item can swing sharply, including negative months (likely refunds or reclassifications) — this uses fiscal-year-to-date cumulative totals, which smooth that out, rather than a single month's number.",
  "",
  "Real numbers, real source — US Treasury Monthly Treasury Statement:",
  "https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/",
];

const lines = [
  `Tariff revenue check (${stamp})`,
  "",
  `Latest: FY${latest.fy} YTD customs duties = ${money(latest.fytd)} (through ${latestRow.record_date})`,
  ...(yoyChange != null ? [`Prior-year same period: ${money(priorFYTD)} — YoY change: ${yoyChange >= 0 ? "+" : ""}${yoyChange.toFixed(1)}%`] : []),
  "",
  "Fiscal Year | Cumulative Customs Duties (FYTD)",
  "---:|---:",
  ...years.map((y) => `FY${y.fy} | ${money(y.fytd)}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["fiscal_year", "fytd_customs_duties"], years.map((y) => [y.fy, y.fytd])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
