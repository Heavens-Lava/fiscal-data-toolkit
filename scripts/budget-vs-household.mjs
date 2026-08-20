#!/usr/bin/env node
// Scale federal finances to a household-sized income for intuition.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  C,
  cardHTML,
  fiscal,
  horizontalBarChart,
  screenshot,
} from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

async function fiscalRetry(pathq) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fiscal(pathq);
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastErr;
}

async function getDebt() {
  const row = (await fiscalRetry("/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1")).data[0];
  return { date: row.record_date, total: Number(row.tot_pub_debt_out_amt) };
}

async function getMTS() {
  const latest = (await fiscalRetry("/v1/accounting/mts/mts_table_1?sort=-record_date&page[size]=1")).data[0].record_date;
  const rows = (await fiscalRetry(`/v1/accounting/mts/mts_table_1?filter=record_date:eq:${latest}&page[size]=50`)).data
    .filter((r) => r.classification_desc === "Year-to-Date");
  const fy = Math.max(...rows.map((r) => Number(r.record_fiscal_year)));
  const row = rows.find((r) => Number(r.record_fiscal_year) === fy);
  return {
    date: latest,
    fy,
    receipts: Number(row.current_month_gross_rcpt_amt),
    outlays: Number(row.current_month_gross_outly_amt),
    deficit: Number(row.current_month_dfct_sur_amt),
  };
}

async function getInterest() {
  const latest = (await fiscalRetry("/v2/accounting/od/interest_expense?sort=-record_date&page[size]=1")).data[0].record_date;
  const rows = (await fiscalRetry(`/v2/accounting/od/interest_expense?filter=record_date:eq:${latest}&page[size]=100`)).data;
  return { date: latest, fytd: rows.reduce((sum, r) => sum + Number(r.fytd_expense_amt || 0), 0) };
}

function money(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function bigMoney(n) {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return money(n);
}

const income = Number(process.argv[process.argv.indexOf("--income") + 1]) || 100000;
const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, `budget-vs-household-${stamp}`);
const noImage = process.argv.includes("--no-image");

mkdirSync(SOCIAL, { recursive: true });

const [mts, debt, interest] = await Promise.all([getMTS(), getDebt(), getInterest()]);
const scale = income / mts.receipts;
const scaled = {
  income,
  spending: mts.outlays * scale,
  borrowing: mts.deficit * scale,
  debt: debt.total * scale,
  interest: interest.fytd * scale,
};

const chartSVG = horizontalBarChart(
  [
    { label: "Spending", v: scaled.spending, color: C.s1 },
    { label: "New borrowing", v: scaled.borrowing, color: C.neg },
    { label: "Interest paid", v: scaled.interest, color: C.neg },
    { label: "Existing debt", v: scaled.debt, color: C.ink2 },
  ],
  { fmtTick: money, fmtVal: money }
);

const html = cardHTML({
  kicker: "Federal budget check",
  title: `If federal receipts were ${money(income)} of household income`,
  hero: money(scaled.spending),
  heroLabel: `spending through FY${mts.fy} YTD`,
  chartSVG,
  source: "Treasury Fiscal Data",
  vintage: mts.date,
});

const facebook = [
  `If the federal government's finances this year were scaled down to a ${money(income)} household income, it would be spending ${money(scaled.spending)} — going ${money(scaled.borrowing)} further into debt this year alone, on top of ${money(scaled.debt)} it already owes.`,
  "",
  `Scale: FY${mts.fy} year-to-date federal receipts are treated like ${money(income)} of household income.`,
  "",
  `Income: ${money(scaled.income)}`,
  `Spending: ${money(scaled.spending)}`,
  `New borrowing: ${money(scaled.borrowing)}`,
  `Existing debt: ${money(scaled.debt)}`,
  `Interest paid so far this fiscal year: ${money(scaled.interest)}`,
  "",
  "This is a proportional illustration, not a literal household budget — a household can't print currency or borrow at sovereign rates, and this scaling doesn't capture the difference between deficit spending by a government and by a person.",
  "",
  "Actual federal figures (not scaled):",
  `Receipts: ${bigMoney(mts.receipts)} through ${mts.date}`,
  `Outlays: ${bigMoney(mts.outlays)}`,
  `Deficit: ${bigMoney(mts.deficit)}`,
  `Debt: ${bigMoney(debt.total)} as of ${debt.date}`,
  `Interest expense FYTD: ${bigMoney(interest.fytd)} as of ${interest.date}`,
  "",
  "Source: Treasury Fiscal Data API.",
];

const lines = [
  `Federal budget as a household budget (${stamp})`,
  "",
  `Scale: FY${mts.fy} year-to-date federal receipts are treated like ${money(income)} of household income.`,
  "",
  `Income: ${money(scaled.income)}`,
  `Spending: ${money(scaled.spending)}`,
  `New borrowing: ${money(scaled.borrowing)}`,
  `Existing debt: ${money(scaled.debt)}`,
  `Interest paid so far this fiscal year: ${money(scaled.interest)}`,
  "",
  "Actual federal figures:",
  `Receipts: ${bigMoney(mts.receipts)} through ${mts.date}`,
  `Outlays: ${bigMoney(mts.outlays)}`,
  `Deficit: ${bigMoney(mts.deficit)}`,
  `Debt: ${bigMoney(debt.total)} as of ${debt.date}`,
  `Interest expense FYTD: ${bigMoney(interest.fytd)} as of ${interest.date}`,
  "",
  "Source: Treasury Fiscal Data API.",
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

const csv = [
  "metric,actual,scaled_to_household_income",
  `receipts,${mts.receipts},${scaled.income}`,
  `outlays,${mts.outlays},${scaled.spending}`,
  `deficit,${mts.deficit},${scaled.borrowing}`,
  `debt,${debt.total},${scaled.debt}`,
  `interest_fytd,${interest.fytd},${scaled.interest}`,
].join("\n") + "\n";

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, csv);
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean)
  .map((ext) => path.relative(ROOT, `${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
