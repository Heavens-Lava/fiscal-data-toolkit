#!/usr/bin/env node
// Mortgage rates, then vs. now — translated into what it actually costs, not
// just a percentage. Freddie Mac's PMMS 30-year fixed rate, via FRED —
// no key required.
//
// Run:  node scripts/mortgage-rates-then-now.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, fred, horizontalBarChart, last, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, money, rel } from "./lib/data-common.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `mortgage-rates-then-now-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const LOAN = 400_000; // a fixed, disclosed illustrative loan amount so every era is directly comparable
function monthlyPayment(annualRatePct, principal = LOAN, years = 30) {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

const rows = await fred("MORTGAGE30US");
const current = last(rows);
const peak = rows.reduce((a, b) => (b.v > a.v ? b : a));
const trough = rows.reduce((a, b) => (b.v < a.v ? b : a));

function nearestToDate(targetIso) {
  return rows.reduce((best, r) =>
    Math.abs(Date.parse(r.d) - Date.parse(targetIso)) < Math.abs(Date.parse(best.d) - Date.parse(targetIso)) ? r : best
  );
}

const MILESTONES = [
  { label: `Oct 1981 (all-time high)`, point: peak },
  { label: "Dec 2000", point: nearestToDate("2000-12-15") },
  { label: "Dec 2008", point: nearestToDate("2008-12-15") },
  { label: `Jan 2021 (all-time low)`, point: trough },
  { label: "Today", point: current },
];

const rowsOut = MILESTONES.map((m) => ({
  label: m.label, rate: m.point.v, date: m.point.d, payment: monthlyPayment(m.point.v),
}));

const today = rowsOut[rowsOut.length - 1];
const low2021 = rowsOut.find((r) => r.label.startsWith("Jan 2021"));
const extraVsLow = today.payment - low2021.payment;

const chartSVG = horizontalBarChart(
  rowsOut.map((r) => ({ label: `${r.label} (${r.rate.toFixed(2)}%)`, v: r.payment, color: r.label === "Today" ? C.neg : C.s1 })),
  { fmtTick: (v) => `$${Math.round(v / 1000)}k`, fmtVal: (v) => money(v) }
);

const html = cardHTML({
  kicker: "Mortgage rate check",
  title: `What a $${(LOAN / 1000).toFixed(0)}k mortgage actually costs, then vs. now`,
  hero: money(today.payment),
  heroLabel: `monthly principal + interest today, at ${today.rate.toFixed(2)}%`,
  chartSVG, source: "Freddie Mac Primary Mortgage Market Survey, via FRED", vintage: today.date,
});

const facebook = [
  `A $${(LOAN / 1000).toFixed(0)}k mortgage costs ${money(extraVsLow)}/month more today than it did at the 2021 low — same loan, same house price, just a different interest rate.`,
  "",
  `30-year fixed mortgage rate (Freddie Mac PMMS), and what it means for the monthly payment on a $${(LOAN / 1000).toFixed(0)}k loan:`,
  "",
  ...rowsOut.map((r) => `${r.label}: ${r.rate.toFixed(2)}% -> ${money(r.payment)}/month`),
  "",
  `Today's rate (${today.rate.toFixed(2)}%) is far below the 1981 peak of ${peak.v.toFixed(2)}% — but well above the January 2021 low of ${trough.v.toFixed(2)}%, which is the era most current homebuyers are mentally comparing against.`,
  "",
  "This is principal and interest only on a fixed $400,000 loan amount — it doesn't include property tax, insurance, or PMI, and it holds the loan amount constant so only the rate's effect is being compared (actual home prices have also risen substantially since 2021).",
  "",
  "Source: Freddie Mac Primary Mortgage Market Survey (PMMS), via FRED.",
].filter(Boolean);

const lines = [
  `Mortgage rates then vs now (${STAMP})`, "", `Freddie Mac PMMS 30-year fixed rate; payment on a fixed $${LOAN} loan.`, "",
  "Milestone | Rate | Monthly payment",
  "---|---:|---:",
  ...rowsOut.map((r) => `${r.label} | ${r.rate.toFixed(2)}% | ${money(r.payment)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["milestone", "date", "rate_pct", "monthly_payment_usd"], rowsOut.map((r) => [r.label, r.date, r.rate, r.payment.toFixed(2)])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
