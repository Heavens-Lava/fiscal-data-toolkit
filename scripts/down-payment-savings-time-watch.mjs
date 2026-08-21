#!/usr/bin/env node
// down-payment-savings-time-watch.mjs — single sentence this post proves:
// how many years would it take a median-income household, saving at the
// national personal savings rate, to save a 20% down payment on the median
// home -- and how has that changed over time? Census/HUD median home price
// (MSPUS), Census nominal median household income (MEHOINUSA646N), and BEA
// personal saving rate (PSAVERT) -- all via FRED, no key required.
//
// Run:  node scripts/down-payment-savings-time-watch.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, fred, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, money, rel } from "./lib/data-common.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `down-payment-savings-time-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const [psave, income, price] = await Promise.all([fred("PSAVERT"), fred("MEHOINUSA646N"), fred("MSPUS")]);

function calc(year) {
  const yearPsave = psave.filter((r) => r.d.startsWith(String(year)));
  const inc = income.find((r) => r.d === `${year}-01-01`);
  const yearPrice = price.filter((r) => r.d.startsWith(String(year)));
  if (!yearPsave.length || !inc || !yearPrice.length) return null;
  const avgPsave = yearPsave.reduce((a, b) => a + b.v, 0) / yearPsave.length;
  const avgPrice = yearPrice.reduce((a, b) => a + b.v, 0) / yearPrice.length;
  const downPayment = avgPrice * 0.2;
  const annualSavings = inc.v * (avgPsave / 100);
  return { year, avgPsave, income: inc.v, avgPrice, downPayment, annualSavings, years: downPayment / annualSavings };
}

const latestIncomeYear = Number(income[income.length - 1].d.slice(0, 4));
const YEARS = [1990, 2000, 2010, latestIncomeYear];
const rows = YEARS.map(calc).filter(Boolean);
if (rows.length < 3) throw new Error("Not enough years with complete PSAVERT/income/price data to compare.");

const latest = rows[rows.length - 1];

const chartSVG = horizontalBarChart(
  rows.map((r) => ({ label: `${r.year}`, v: r.years, color: r === latest ? C.neg : C.s1 })),
  { fmtTick: (v) => `${v.toFixed(0)} yrs`, fmtVal: (v) => `${v.toFixed(1)} yrs` }
);

const html = cardHTML({
  kicker: "Down-payment savings-time check",
  title: "How long to save a 20% down payment on the median home?",
  hero: `${latest.years.toFixed(1)} yrs`,
  heroLabel: `at the median household income and the national personal savings rate, ${latest.year}`,
  chartSVG, source: "Census/HUD (MSPUS), Census (MEHOINUSA646N) & BEA (PSAVERT), via FRED", vintage: String(latest.year),
});

const facebook = [
  `At the median household income and the national personal savings rate, it would take about ${latest.years.toFixed(1)} years to save a 20% down payment on the median home in ${latest.year} -- up from ${rows[0].years.toFixed(1)} years in ${rows[0].year}, though the number hasn't moved in a straight line in between.`,
  "",
  "Method: 20% of the median home sale price (Census/HUD), divided by median household income (Census) times that year's personal saving rate (BEA) -- an estimate of how much a household saves per year if it saves at the national average rate.",
  "",
  ...rows.map((r) => `${r.year}: ${money(r.downPayment)} down payment (20% of ${money(r.avgPrice)} median home) / ${money(r.annualSavings)}/year saved (${money(r.income)} income x ${r.avgPsave.toFixed(1)}% savings rate) = ${r.years.toFixed(1)} years`),
  "",
  "This uses the NATIONAL personal savings rate, not what any specific household actually saves -- real households save more, less, zero, or negative amounts, and this doesn't account for saving toward a smaller down payment, employer or family assistance, or investment returns on savings.",
  "",
  "Sources: U.S. Census Bureau/HUD Median Sales Price of Houses Sold (MSPUS); U.S. Census Bureau Median Household Income (MEHOINUSA646N); U.S. Bureau of Economic Analysis Personal Saving Rate (PSAVERT); all via FRED.",
];

const lines = [
  `Down payment savings-time watch (${STAMP})`, "",
  "Year | Median home price | 20% down payment | Median income | Savings rate | Annual savings | Years to save",
  "---:|---:|---:|---:|---:|---:|---:",
  ...rows.map((r) => `${r.year} | ${money(r.avgPrice)} | ${money(r.downPayment)} | ${money(r.income)} | ${r.avgPsave.toFixed(1)}% | ${money(r.annualSavings)} | ${r.years.toFixed(1)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["year", "median_home_price_usd", "down_payment_20pct_usd", "median_household_income_usd", "personal_savings_rate_pct", "annual_savings_usd", "years_to_save"],
  rows.map((r) => [r.year, r.avgPrice.toFixed(0), r.downPayment.toFixed(0), r.income, r.avgPsave.toFixed(2), r.annualSavings.toFixed(0), r.years.toFixed(2)])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
