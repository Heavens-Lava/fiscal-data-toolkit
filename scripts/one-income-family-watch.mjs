#!/usr/bin/env node
// one-income-family-watch.mjs — single sentence this post proves: does one
// full-time median income cover what the average married-couple-with-
// children household actually spends in a year? BLS median usual weekly
// earnings (full-time wage & salary workers, LES1252881500Q) vs. BLS
// Consumer Expenditure Survey average annual expenditures for married
// couple with children households (CXUTOTALEXPLB0604M) -- both via FRED,
// no key required, both official BLS series, same reference year.
//
// Run:  node scripts/one-income-family-watch.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, fred, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, money, rel } from "./lib/data-common.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `one-income-family-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const [earningsSeries, expSeries] = await Promise.all([fred("LES1252881500Q"), fred("CXUTOTALEXPLB0604M")]);

// Use the most recent year with a complete 4-quarter earnings average AND
// a published expenditure figure, so both sides describe the same year.
const expByYear = new Map(expSeries.map((r) => [r.d.slice(0, 4), r.v]));
const earningsByYearQ = new Map();
for (const r of earningsSeries) {
  const y = r.d.slice(0, 4);
  if (!earningsByYearQ.has(y)) earningsByYearQ.set(y, []);
  earningsByYearQ.get(y).push(r.v);
}
const candidateYears = [...expByYear.keys()].filter((y) => (earningsByYearQ.get(y) || []).length === 4).sort();
const YEAR = candidateYears[candidateYears.length - 1];
if (!YEAR) throw new Error("No year with both a complete 4-quarter earnings average and a published expenditure figure.");

const avgWeeklyEarnings = earningsByYearQ.get(YEAR).reduce((a, b) => a + b, 0) / 4;
const annualEarnings = avgWeeklyEarnings * 52;
const familyExpenditure = expByYear.get(YEAR);
const shortfall = familyExpenditure - annualEarnings;
const coveragePct = (annualEarnings / familyExpenditure) * 100;

const rows = [
  { label: "One full-time median income", v: annualEarnings },
  { label: "Avg. family spending (married w/ kids)", v: familyExpenditure },
];

const chartSVG = horizontalBarChart(
  [
    { label: "One full-time median income", v: annualEarnings, color: C.s1 },
    { label: "Avg. family spending (married w/ kids)", v: familyExpenditure, color: C.neg },
  ],
  { fmtTick: (v) => `$${Math.round(v / 1000)}k`, fmtVal: (v) => money(v) }
);

const html = cardHTML({
  kicker: "One-income check",
  title: "Does one full-time income cover what a family actually spends?",
  hero: `${coveragePct.toFixed(0)}%`,
  heroLabel: `of average married-couple-with-children spending covered by one full-time median income, ${YEAR}`,
  chartSVG, source: "U.S. Bureau of Labor Statistics (CPS earnings & Consumer Expenditure Survey), via FRED", vintage: YEAR,
});

const facebook = [
  `In ${YEAR}, one full-time worker earning the median wage brought home ${money(annualEarnings)}/year -- covering about ${coveragePct.toFixed(0)}% of the ${money(familyExpenditure)} the average married-couple-with-children household actually spent that year. That's a ${money(shortfall)} gap a single income alone didn't close.`,
  "",
  "Method: BLS median usual weekly earnings for full-time wage and salary workers, averaged across the year's four quarters and annualized (x52), compared to the BLS Consumer Expenditure Survey's average annual total expenditure for married-couple-with-children consumer units in the same year.",
  "",
  `One full-time median income: ${money(annualEarnings)}/year`,
  `Average married-couple-with-children household spending: ${money(familyExpenditure)}/year`,
  `Gap: ${money(shortfall)}`,
  "",
  "This compares one individual's median earnings to a household's average total spending, not to that same household's actual income (many of these households have two earners, investment income, or spend above or below the average) -- it shows what a single income alone would need to cover, not what any specific family actually experiences.",
  "",
  "Sources: U.S. Bureau of Labor Statistics, Current Population Survey (median usual weekly earnings, LES1252881500Q) and Consumer Expenditure Survey (CXUTOTALEXPLB0604M), via FRED.",
];

const lines = [
  `One income vs. family spending watch (${STAMP})`, "",
  `${YEAR}: one full-time median income vs. average married-couple-with-children household spending.`, "",
  "Measure | Annual amount",
  "---|---:",
  ...rows.map((r) => `${r.label.replace(/\n/g, " ")} | ${money(r.v)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["measure", "annual_amount_usd"],
  rows.map((r) => [r.label.replace(/\n/g, " "), r.v.toFixed(0)])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
