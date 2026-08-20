#!/usr/bin/env node
// mortgage-rate-sensitivity-watch.mjs — the same $400k mortgage at a set of
// round illustrative rates (3/4/5/6%) plus today's actual rate, so someone
// shopping right now can see what a rate change would mean for their
// payment, not just what it meant historically. Freddie Mac PMMS 30-year
// fixed rate via FRED for the "today" data point -- no key required.
//
// Run:  node scripts/mortgage-rate-sensitivity-watch.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, fred, horizontalBarChart, last, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, money, rel } from "./lib/data-common.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `mortgage-rate-sensitivity-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const LOAN = 400_000; // fixed, disclosed illustrative loan amount
function monthlyPayment(annualRatePct, principal = LOAN, years = 30) {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

const series = await fred("MORTGAGE30US");
const current = last(series);

const ILLUSTRATIVE_RATES = [3, 4, 5, 6];
const rows = ILLUSTRATIVE_RATES.map((rate) => ({ label: `${rate}%`, rate, isToday: false, payment: monthlyPayment(rate) }));
rows.push({ label: `Today (${current.v.toFixed(2)}%)`, rate: current.v, isToday: true, payment: monthlyPayment(current.v) });
rows.sort((a, b) => a.rate - b.rate);

const cheapest = rows[0];
const mostExpensive = rows[rows.length - 1];
const todayRow = rows.find((r) => r.isToday);
const swing3to6 = monthlyPayment(6) - monthlyPayment(3);

const chartSVG = horizontalBarChart(
  rows.map((r) => ({ label: r.label, v: r.payment, color: r.isToday ? C.neg : C.s1 })),
  { fmtTick: (v) => `$${Math.round(v / 1000)}k`, fmtVal: (v) => money(v) }
);

const html = cardHTML({
  kicker: "Mortgage rate sensitivity check",
  title: `What a $${(LOAN / 1000).toFixed(0)}k mortgage costs at different rates`,
  hero: money(todayRow.payment),
  heroLabel: `monthly principal + interest today, at ${todayRow.rate.toFixed(2)}%`,
  chartSVG, source: "Freddie Mac Primary Mortgage Market Survey, via FRED", vintage: current.d,
});

const facebook = [
  `The same $${(LOAN / 1000).toFixed(0)}k mortgage costs ${money(swing3to6)}/month more at 6% than at 3% -- same loan, same house, just a different interest rate. As of ${current.d}, the actual rate (${todayRow.rate.toFixed(2)}%) puts the payment at ${money(todayRow.payment)}/month.`,
  "",
  `30-year fixed, $${(LOAN / 1000).toFixed(0)}k loan, principal + interest only:`,
  "",
  ...rows.map((r) => `${r.label}: ${money(r.payment)}/month`),
  "",
  "This is principal and interest only on a fixed $400,000 loan amount -- it doesn't include property tax, insurance, or PMI. The illustrative rates (3/4/5/6%) are round numbers for comparison, not a forecast of where rates are headed.",
  "",
  "Source: Freddie Mac Primary Mortgage Market Survey (PMMS), via FRED.",
];

const lines = [
  `Mortgage rate sensitivity watch (${STAMP})`, "", `Freddie Mac PMMS 30-year fixed rate (today's data point); payment on a fixed $${LOAN} loan.`, "",
  "Rate | Monthly payment",
  "---:|---:",
  ...rows.map((r) => `${r.label} | ${money(r.payment)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rate_label", "rate_pct", "monthly_payment_usd"], rows.map((r) => [r.label, r.rate.toFixed(2), r.payment.toFixed(2)])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
