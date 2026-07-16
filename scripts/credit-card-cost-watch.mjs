#!/usr/bin/env node
// credit-card-cost-watch.mjs - what carrying a credit-card balance actually
// costs the average US household per month, at today's interest rate. All
// FRED series, no API key required.
//
// Run:  node scripts/credit-card-cost-watch.mjs
//       node scripts/credit-card-cost-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, closest, fred, horizontalBarChart, last, oneYearBefore, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function money(n) {
  const s = n < 0 ? "-" : "", a = Math.abs(n);
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
  return `${s}$${Math.round(a).toLocaleString("en-US")}`;
}
function usd0(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
function monthlyInterest(balance, aprPct) {
  return (balance * (aprPct / 100)) / 12;
}

const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `credit-card-cost-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

console.log("  Fetching revolving credit, credit-card APR, and household count from FRED...");
const [revolving, apr, households] = await Promise.all([
  fred("REVOLSL"),          // total revolving consumer credit, $ millions, SA
  fred("TERMCBCCALLNS"),    // avg credit-card interest rate, accounts assessed interest, %
  fred("TTLHH"),             // total US households, thousands
]);

const revNow = last(revolving);
const hhNow = closest(households, revNow.d);
const totalRevolvingDollars = revNow.v * 1e6;
const householdCount = hhNow.v * 1e3;
const avgBalance = totalRevolvingDollars / householdCount;

const aprNow = last(apr);
const apr1yr = closest(apr, oneYearBefore(aprNow.d));
const aprPeak = apr.reduce((a, b) => (b.v > a.v ? b : a));

const costNow = monthlyInterest(avgBalance, aprNow.v);
const cost1yr = monthlyInterest(avgBalance, apr1yr.v);
const costPeak = monthlyInterest(avgBalance, aprPeak.v);

const rev1yr = closest(revolving, oneYearBefore(revNow.d));
const revGrowth = totalRevolvingDollars - rev1yr.v * 1e6;

const aggregateMonthlyInterest = totalRevolvingDollars * (aprNow.v / 100) / 12;

const chartSVG = horizontalBarChart(
  [
    { label: `1yr ago (${apr1yr.v.toFixed(2)}% APR, ${apr1yr.d})`, v: cost1yr, color: C.s1 },
    { label: `Now (${aprNow.v.toFixed(2)}% APR, ${aprNow.d})`, v: costNow, color: C.neg },
    { label: `Historic high (${aprPeak.v.toFixed(2)}% APR, ${aprPeak.d})`, v: costPeak, color: C.s1 },
  ],
  { fmtTick: (v) => `$${Math.round(v)}`, fmtVal: (v) => `${usd0(v)}/mo` }
);

const html = cardHTML({
  kicker: "Credit card cost check",
  title: "What does carrying a credit-card balance cost you right now?",
  hero: `${usd0(costNow)}/mo`,
  heroLabel: `interest only, on the average household's revolving balance · ${aprNow.d}`,
  chartSVG,
  source: "Federal Reserve via FRED",
  vintage: aprNow.d,
});

const facebook = [
  "Credit card cost check:",
  "",
  `Total US revolving consumer credit (mostly credit cards) was ${money(totalRevolvingDollars)} as of ${revNow.d}, spread across an estimated ${(householdCount / 1e6).toFixed(1)}M households — an average of about ${usd0(avgBalance)} per household.`,
  "",
  `At today's average credit-card interest rate of ${aprNow.v.toFixed(2)}% (${aprNow.d}, accounts that carry a balance), just the INTEREST on that average balance runs about ${usd0(costNow)}/month — before a single dollar of principal gets paid down.`,
  "",
  `A year ago (${apr1yr.d}) the rate was ${apr1yr.v.toFixed(2)}%, meaning the same balance cost about ${usd0(cost1yr)}/month in interest — a difference of ${usd0(Math.abs(costNow - cost1yr))}/month from the rate move alone. The all-time high in this series was ${aprPeak.v.toFixed(2)}% (${aprPeak.d}), which would run ${usd0(costPeak)}/month on the same balance.`,
  "",
  `Zoom out: total revolving credit is up ${money(Math.abs(revGrowth))} from a year ago, and across all US households, that adds up to roughly ${money(aggregateMonthlyInterest)}/month in credit-card interest paid collectively — not principal, just interest.`,
  "",
  "Caveat: this is an aggregate average (total revolving credit ÷ all US households), not the average balance among people who actually carry one — many households carry $0. It's meant to show what the interest RATE costs on a representative balance, not a precise per-cardholder figure. \"Revolving credit\" also includes some non-card retail credit lines, though credit cards are the large majority.",
  "",
  "Real numbers, real source — Federal Reserve via FRED:",
  "https://fred.stlouisfed.org/series/REVOLSL",
  "https://fred.stlouisfed.org/series/TERMCBCCALLNS",
];

const lines = [
  `Credit card cost check (${stamp})`,
  "",
  `Total revolving consumer credit: ${money(totalRevolvingDollars)} (${revNow.d})`,
  `Estimated US households: ${(householdCount / 1e6).toFixed(1)}M (${hhNow.d})`,
  `Average balance per household: ${usd0(avgBalance)}`,
  "",
  `Current APR: ${aprNow.v.toFixed(2)}% (${aprNow.d}) -> ${usd0(costNow)}/mo interest`,
  `1yr-ago APR: ${apr1yr.v.toFixed(2)}% (${apr1yr.d}) -> ${usd0(cost1yr)}/mo interest`,
  `Historic-high APR: ${aprPeak.v.toFixed(2)}% (${aprPeak.d}) -> ${usd0(costPeak)}/mo interest`,
  "",
  `Aggregate monthly interest, all US households: ${money(aggregateMonthlyInterest)}`,
  `Revolving credit growth vs 1yr ago: ${money(revGrowth)}`,
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["metric", "value", "unit"],
  [
    ["total_revolving_credit", totalRevolvingDollars, "usd"],
    ["households", householdCount, "count"],
    ["avg_balance_per_household", avgBalance, "usd"],
    ["apr_now", aprNow.v, "percent"],
    ["apr_1yr_ago", apr1yr.v, "percent"],
    ["apr_historic_high", aprPeak.v, "percent"],
    ["monthly_interest_now", costNow, "usd"],
    ["monthly_interest_1yr_ago", cost1yr, "usd"],
    ["monthly_interest_historic_high", costPeak, "usd"],
    ["aggregate_monthly_interest_all_households", aggregateMonthlyInterest, "usd"],
  ]
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
