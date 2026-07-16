#!/usr/bin/env node
// ssa-trust-fund-watch.mjs - Social Security's combined trust fund reserves
// and whether the program is running a surplus or deficit. Scraped from SSA's
// own Office of the Chief Actuary page (no clean JSON API exists for this;
// SSA's ArcGIS-hosted "open data" beneficiary datasets are abandoned since
// ~2015, so this uses their actively-maintained actuarial reporting page
// instead, which updates quarterly). No API key required.
//
// Run:  node scripts/ssa-trust-fund-watch.mjs
//       node scripts/ssa-trust-fund-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const PAGE_URL = "https://www.ssa.gov/oact/progdata/assets.html";
const PROJECTION_URL = "https://www.ssa.gov/oact/TRSUM/index.html";

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function moneyB(billions) {
  const a = Math.abs(billions);
  return a >= 1000 ? `$${(billions / 1000).toFixed(2)}T` : `$${billions.toFixed(1)}B`;
}

function num(s) {
  return Number(String(s).replace(/,/g, ""));
}

const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `ssa-trust-fund-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

async function fetchClean(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (fiscal-data-toolkit)" } });
    if (!res.ok) throw new Error(`SSA page HTTP ${res.status}`);
    const text = await res.text();
    return text
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&hellip;/g, "...")
      .replace(/&ntilde;/g, "n")
      .replace(/\s+/g, " ");
  } finally {
    clearTimeout(timer);
  }
}

console.log("  Fetching Social Security trust fund data from SSA OACT...");
const clean = await fetchClean(PAGE_URL);

const peakMatch = clean.match(/grew from about \$[\d,]+ billion at the end of (\w+ \d{4}) to about \$([\d,]+) billion \(\$([\d.]+) trillion\) by the end of (\w+ \d{4})/);
const currentMatch = clean.match(/asset reserves have declined slightly to about \$([\d,]+) billion \(\$([\d.]+) trillion\) by the end of (\w+ \d{4})/)
  || clean.match(/asset reserves have (?:grown|increased) (?:slightly |further )?to about \$([\d,]+) billion \(\$([\d.]+) trillion\) by the end of (\w+ \d{4})/);
const fyMatch = clean.match(/Operations in fiscal year (\d{4})[^[]*\[In billions\] Income \$([\d,.]+) Cost ([\d,.]+) Difference (-?[\d,.]+)/);
const cyMatch = clean.match(/Operations in calendar year (\d{4})[^[]*\[In billions\] Income \$([\d,.]+) Cost ([\d,.]+) Difference (-?[\d,.]+)/);
const qMatch = clean.match(/Operations in quarter ending ([\w\s\d,]+?) \[In billions\] Income \$([\d,.]+) Cost ([\d,.]+) Difference (-?[\d,.]+)/);

if (!peakMatch || !currentMatch || !fyMatch || !qMatch) {
  throw new Error(
    "Could not parse expected figures from the SSA trust fund page — its wording may have changed. " +
    `Found: peak=${!!peakMatch} current=${!!currentMatch} fy=${!!fyMatch} cy=${!!cyMatch} quarter=${!!qMatch}. ` +
    `Check ${PAGE_URL} manually.`
  );
}

// Regex groups: [1] = series START date (e.g. Dec 1987), [2]/[3] = the PEAK
// dollar value, [4] = the PEAK's own date (e.g. Dec 2020) — NOT the start date.
const peak = { startDate: peakMatch[1], billions: num(peakMatch[2]), trillions: num(peakMatch[3]), date: peakMatch[4] };
const current = { billions: num(currentMatch[1]), trillions: num(currentMatch[2]), asOf: currentMatch[3] };
const fy = { year: peakMatch ? Number(fyMatch[1]) : null, income: num(fyMatch[2]), cost: num(fyMatch[3]), diff: num(fyMatch[4]) };
const quarter = { endDate: qMatch[1], income: num(qMatch[2]), cost: num(qMatch[3]), diff: num(qMatch[4]) };
const declineFromPeak = current.billions - peak.billions;

// Best-effort: pull the "will it run out" depletion-date projections from the
// Trustees Report summary. Not fatal if SSA changes the wording — the rest of
// the post (actual reserves/income/cost) still stands without it.
let depletion = null;
try {
  const projClean = await fetchClean(PROJECTION_URL);
  const oasiMatch = projClean.match(/Old-Age and Survivors Insurance \(OASI\) Trust Fund will be able to pay 100 percent of total scheduled benefits until the ([\w\s]+?) of (\d{4})[^.]*\.\s*At that time,[^.]*sufficient to pay (\d+) percent of total scheduled benefits/i);
  const combinedMatch = projClean.match(/designated OASDI\) would be able to pay 100 percent of total scheduled benefits until the ([\w\s]+?) of (\d{4})[^.]*\.\s*At that time,[^.]*sufficient to pay (\d+) percent of scheduled benefits/i);
  if (oasiMatch && combinedMatch) {
    depletion = {
      oasiWhen: `${oasiMatch[1]} of ${oasiMatch[2]}`,
      oasiYear: Number(oasiMatch[2]),
      oasiPct: Number(oasiMatch[3]),
      combinedWhen: `${combinedMatch[1]} of ${combinedMatch[2]}`,
      combinedYear: Number(combinedMatch[2]),
      combinedPct: Number(combinedMatch[3]),
    };
  }
} catch (err) {
  console.error(`  (skipping depletion projection — ${err.message})`);
}

const chartSVG = horizontalBarChart(
  [
    { label: `FY${fy.year} income`, v: fy.income, color: C.s2 },
    { label: `FY${fy.year} cost`, v: fy.cost, color: C.neg },
  ],
  { fmtTick: (v) => `$${(v / 1000).toFixed(1)}T`, fmtVal: (v) => moneyB(v) }
);

const html = cardHTML({
  kicker: "Social Security check",
  title: "Is Social Security taking in more than it pays out?",
  hero: moneyB(current.billions),
  heroLabel: `combined trust fund reserves · end of ${current.asOf}`,
  chartSVG,
  source: "SSA Office of the Chief Actuary",
  vintage: current.asOf,
});

const facebook = [
  "Social Security check:",
  "",
  `The combined Social Security trust funds (retirement + disability) held ${moneyB(current.billions)} in reserves as of the end of ${current.asOf}.`,
  "",
  `That's down from a peak of ${moneyB(peak.billions)} at the end of ${peak.date} — a decline of ${moneyB(Math.abs(declineFromPeak))} in ${current.asOf.split(" ")[1] - peak.date.split(" ")[1]} years, because the program has been paying out more than it collects.`,
  "",
  `In fiscal year ${fy.year}: income was ${moneyB(fy.income)}, cost was ${moneyB(fy.cost)} — a shortfall of ${moneyB(Math.abs(fy.diff))} covered by drawing down reserves. Most recent quarter (ending ${quarter.endDate}): income ${moneyB(quarter.income)}, cost ${moneyB(quarter.cost)}, difference ${moneyB(quarter.diff)}.`,
  "",
  ...(depletion ? [
    `Will Social Security actually "run out"? No — by law it can't pay out more than it takes in once reserves hit zero, so it can't disappear entirely. But without Congress acting, benefits get an automatic cut. Per the Trustees' latest projection: the retirement (OASI) fund alone runs dry by the ${depletion.oasiWhen} — at that point ongoing payroll tax income covers only ${depletion.oasiPct}% of scheduled benefits, a ${100 - depletion.oasiPct}% cut for everyone drawing retirement benefits. Combined with disability insurance (which stays solvent on its own), that combined depletion date pushes to the ${depletion.combinedWhen}, covering ${depletion.combinedPct}% of benefits.`,
    "",
  ] : []),
  "Note: \"income\" here includes both payroll tax revenue and interest earned on the trust funds' Treasury securities — it is not just tax collections. This does not include Supplemental Security Income (SSI), which is a separate, general-revenue-funded program.",
  "",
  "Real numbers, real source — SSA Office of the Chief Actuary, trust fund data, and the Trustees Report summary:",
  PAGE_URL,
  ...(depletion ? [PROJECTION_URL] : []),
];

const lines = [
  `Social Security check (${stamp})`,
  "",
  `Combined trust fund reserves: ${moneyB(current.billions)} (end of ${current.asOf})`,
  `Peak reserves: ${moneyB(peak.billions)} (end of ${peak.date})`,
  `Change since peak: ${moneyB(declineFromPeak)}`,
  "",
  `FY${fy.year}: Income ${moneyB(fy.income)} | Cost ${moneyB(fy.cost)} | Difference ${moneyB(fy.diff)}`,
  ...(cyMatch ? [`CY${cyMatch[1]}: Income ${moneyB(num(cyMatch[2]))} | Cost ${moneyB(num(cyMatch[3]))} | Difference ${moneyB(num(cyMatch[4]))}`] : []),
  `Quarter ending ${quarter.endDate}: Income ${moneyB(quarter.income)} | Cost ${moneyB(quarter.cost)} | Difference ${moneyB(quarter.diff)}`,
  ...(depletion ? [
    "",
    `OASI (retirement) depletion: ${depletion.oasiWhen} — ${depletion.oasiPct}% of benefits payable after`,
    `Combined OASDI depletion: ${depletion.combinedWhen} — ${depletion.combinedPct}% of benefits payable after`,
  ] : []),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["metric", "value", "unit"],
  [
    ["current_reserves", current.billions, "billions_usd"],
    ["peak_reserves", peak.billions, "billions_usd"],
    [`fy${fy.year}_income`, fy.income, "billions_usd"],
    [`fy${fy.year}_cost`, fy.cost, "billions_usd"],
    [`fy${fy.year}_difference`, fy.diff, "billions_usd"],
    ...(depletion ? [
      ["oasi_depletion_year", depletion.oasiYear, "year"],
      ["oasi_pct_payable_after_depletion", depletion.oasiPct, "percent"],
      ["combined_depletion_year", depletion.combinedYear, "year"],
      ["combined_pct_payable_after_depletion", depletion.combinedPct, "percent"],
    ] : []),
  ]
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
