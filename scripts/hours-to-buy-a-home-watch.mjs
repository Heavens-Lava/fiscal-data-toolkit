#!/usr/bin/env node
// hours-to-buy-a-home-watch.mjs — how many hours of work at the average
// private-sector hourly wage would it take to buy the median-priced home,
// in 1980 versus today? Census/HUD median new-home sales price (MSPUS) vs.
// BLS average hourly earnings, production & nonsupervisory employees, total
// private (CEU0500000008/AHETPI) -- both via FRED, no key required. Both
// series run annual averages so a single volatile month doesn't skew either
// side of the comparison.
//
// Run:  node scripts/hours-to-buy-a-home-watch.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, fred, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, money, rel } from "./lib/data-common.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `hours-to-buy-a-home-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

function annualAverage(series, year) {
  const rows = series.filter((r) => r.d.startsWith(`${year}-`));
  if (!rows.length) return null;
  return rows.reduce((sum, r) => sum + r.v, 0) / rows.length;
}

const [priceSeries, wageSeries] = await Promise.all([fred("MSPUS"), fred("CEU0500000008")]);

const BASE_YEAR = 1980;
const priceBase = annualAverage(priceSeries, BASE_YEAR);
const wageBase = annualAverage(wageSeries, BASE_YEAR);
if (!priceBase || !wageBase) throw new Error(`Missing ${BASE_YEAR} data in one of the FRED series.`);

const latestYearWithWage = Number(wageSeries[wageSeries.length - 1].d.slice(0, 4));
const priceLatest = annualAverage(priceSeries, latestYearWithWage) ?? priceSeries[priceSeries.length - 1].v;
const wageLatest = annualAverage(wageSeries, latestYearWithWage);

const hoursBase = priceBase / wageBase;
const hoursLatest = priceLatest / wageLatest;
const yearsBase = hoursBase / 2000; // 2,000 hrs = a conventional full-time work-year
const yearsLatest = hoursLatest / 2000;
const multiple = hoursLatest / hoursBase;

const rows = [
  { label: `${BASE_YEAR}`, hours: hoursBase, price: priceBase, wage: wageBase },
  { label: `${latestYearWithWage}`, hours: hoursLatest, price: priceLatest, wage: wageLatest },
];

const chartSVG = horizontalBarChart(
  rows.map((r) => ({ label: r.label, v: r.hours, color: r.label === `${latestYearWithWage}` ? C.neg : C.s1 })),
  { fmtTick: (v) => `${Math.round(v / 1000)}k hrs`, fmtVal: (v) => `${Math.round(v).toLocaleString()} hrs` }
);

const html = cardHTML({
  kicker: "Hours-to-buy-a-home check",
  title: "How many hours of work does it take to buy the median home?",
  hero: `${multiple.toFixed(1)}x`,
  heroLabel: `more work-hours to buy the median home today than in ${BASE_YEAR}`,
  chartSVG, source: "Census/HUD (MSPUS) & BLS (CEU0500000008), via FRED", vintage: String(latestYearWithWage),
});

const facebook = [
  `At the average hourly wage, buying the median-priced home took about ${Math.round(hoursBase).toLocaleString()} hours of work in ${BASE_YEAR} (roughly ${yearsBase.toFixed(1)} years of full-time work). In ${latestYearWithWage}, it takes about ${Math.round(hoursLatest).toLocaleString()} hours -- roughly ${yearsLatest.toFixed(1)} years -- ${multiple.toFixed(1)}x as much.`,
  "",
  `Method: median new-home sales price (Census/HUD) divided by the average hourly wage for production & nonsupervisory employees (BLS), both as annual averages. A work-year is treated as 2,000 hours (40 hrs/week x 50 weeks).`,
  "",
  `${BASE_YEAR}: ${money(priceBase)} median home / $${wageBase.toFixed(2)}/hr = ${Math.round(hoursBase).toLocaleString()} hours (${yearsBase.toFixed(1)} work-years)`,
  `${latestYearWithWage}: ${money(priceLatest)} median home / $${wageLatest.toFixed(2)}/hr = ${Math.round(hoursLatest).toLocaleString()} hours (${yearsLatest.toFixed(1)} work-years)`,
  "",
  "This uses the median price of a NEW home (Census/HUD doesn't run an equally long official series for existing homes) and a broad average hourly wage, not any one occupation's -- it doesn't account for a down payment vs. financing the rest, mortgage interest, taxes, or that home sizes and features have changed since 1980.",
  "",
  "Sources: U.S. Census Bureau/HUD Median Sales Price of Houses Sold (MSPUS); U.S. Bureau of Labor Statistics Average Hourly Earnings, Production & Nonsupervisory Employees, Total Private (CEU0500000008); both via FRED.",
];

const lines = [
  `Hours to buy a home watch (${STAMP})`, "",
  "Year | Median home price | Avg hourly wage | Hours of work to buy",
  "---:|---:|---:|---:",
  ...rows.map((r) => `${r.label} | ${money(r.price)} | $${r.wage.toFixed(2)} | ${Math.round(r.hours).toLocaleString()}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["year", "median_home_price_usd", "avg_hourly_wage_usd", "hours_of_work"],
  rows.map((r) => [r.label, r.price.toFixed(0), r.wage.toFixed(2), r.hours.toFixed(0)])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
