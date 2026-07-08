#!/usr/bin/env node
// money-debt-cash.mjs - compare U.S. money supply, physical cash, and debt.
// Sources: FRED/Federal Reserve, Treasury FiscalData, and FDIC BankFind.
// No API keys required.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  C,
  cardHTML,
  fiscal,
  fred,
  horizontalBarChart,
  last,
  screenshot,
  toCSV,
} from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const FDIC = "https://api.fdic.gov/banks/financials";

function arg(name) {
  return process.argv.includes(name);
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function money(n) {
  const s = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${Math.round(a).toLocaleString("en-US")}`;
}

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fdicDeposits() {
  const latest = (await json(`${FDIC}?fields=REPDTE&sort_by=REPDTE&sort_order=DESC&limit=1&format=json`))
    .data[0].data.REPDTE;
  const rows = (await json(`${FDIC}?filters=REPDTE:${latest}&fields=DEP&limit=10000&format=json`)).data;
  const deposits = rows.reduce((sum, row) => sum + (Number(row.data.DEP) || 0), 0) * 1000;
  const quarter = `${latest.slice(0, 4)}-Q${Math.ceil(Number(latest.slice(4, 6)) / 3)}`;
  return { deposits, quarter, banks: rows.length };
}

async function treasuryDebt() {
  const data = await fiscal("/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1");
  const row = data.data[0];
  return { debt: Number(row.tot_pub_debt_out_amt), date: row.record_date };
}

const noImage = arg("--no-image");
const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, `money-debt-cash-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const [m2Rows, cashRows, householdRows, federal, bank] = await Promise.all([
  fred("M2SL"),
  fred("CURRCIR"),
  fred("CMDEBT"),
  treasuryDebt(),
  fdicDeposits(),
]);

const m2 = last(m2Rows);
const cash = last(cashRows);
const household = last(householdRows);

const points = [
  {
    label: "Federal public debt",
    value: federal.debt,
    date: federal.date,
    source: "Treasury FiscalData",
    color: C.neg,
  },
  {
    label: "M2 money supply",
    value: m2.v * 1e9,
    date: m2.d,
    source: "FRED M2SL",
    color: C.s2,
  },
  {
    label: "Household/nonprofit debt",
    value: household.v * 1e6,
    date: household.d,
    source: "FRED CMDEBT",
    color: C.s1,
  },
  {
    label: "FDIC bank deposits",
    value: bank.deposits,
    date: bank.quarter,
    source: "FDIC BankFind financials",
    color: "#6f6b63",
  },
  {
    label: "Physical cash",
    value: cash.v * 1e9,
    date: cash.d,
    source: "FRED CURRCIR",
    color: "#9c6b2f",
  },
];

const cashShare = (cash.v / m2.v) * 100;
const depositsShare = (bank.deposits / (m2.v * 1e9)) * 100;
const debtToM2 = federal.debt / (m2.v * 1e9);
const totalDebt = federal.debt + household.v * 1e6;

const chartSVG = horizontalBarChart(
  points.map((p) => ({ label: p.label, v: p.value, color: p.color })),
  { fmtTick: money, fmtVal: money }
);

const html = cardHTML({
  kicker: "Money, cash, and debt",
  title: "Most U.S. money is digital; debt is larger than the money supply",
  hero: `${debtToM2.toFixed(1)}x`,
  heroLabel: "federal debt vs. M2 money supply",
  chartSVG,
  source: "FRED, Treasury FiscalData, FDIC",
  vintage: stamp,
});

const facebook = [
  "Money check:",
  "",
  `The U.S. M2 money supply is about ${money(m2.v * 1e9)} (${m2.d}). That is the broad bucket people usually mean by \"money in circulation\": cash, checking deposits, savings deposits, money-market funds, and similar liquid money.`,
  "",
  `But actual physical cash is only ${money(cash.v * 1e9)} (${cash.d}) - about ${cashShare.toFixed(1)}% of M2. Most money is digital bank balances, not paper bills.`,
  "",
  `For scale: federal public debt is ${money(federal.debt)} (${federal.date}), and household/nonprofit debt is ${money(household.v * 1e6)} (${household.d}). Combined, those two are about ${money(totalDebt)}.`,
  "",
  `FDIC-insured banks held ${money(bank.deposits)} in deposits in ${bank.quarter} across ${bank.banks.toLocaleString("en-US")} institutions, equal to about ${depositsShare.toFixed(0)}% of M2.`,
  "",
  "Important caveat: M2 is not total wealth, and debt is not the same thing as money. This is a scale check: how much liquid money exists, how much is physical cash, and how that compares with major debt buckets.",
  "",
  "Sources: FRED/Federal Reserve (M2SL, CURRCIR, CMDEBT), Treasury FiscalData, FDIC BankFind financials.",
];

const lines = [
  `Money, debt, and cash check (${stamp})`,
  "",
  `M2 money supply: ${money(m2.v * 1e9)} (${m2.d})`,
  `Physical cash in circulation: ${money(cash.v * 1e9)} (${cash.d})`,
  `Federal public debt: ${money(federal.debt)} (${federal.date})`,
  `Household/nonprofit debt: ${money(household.v * 1e6)} (${household.d})`,
  `FDIC bank deposits: ${money(bank.deposits)} (${bank.quarter})`,
  "",
  `Physical cash is ${cashShare.toFixed(1)}% of M2.`,
  `Federal debt is ${debtToM2.toFixed(1)}x M2.`,
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
  "",
  "Data table",
  "----------",
  "Measure | Latest | Date | Source",
  "---|---:|---:|---",
  ...points.map((p) => `${p.label} | ${money(p.value)} | ${p.date} | ${p.source}`),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["measure", "value", "date", "source"],
  points.map((p) => [p.label, p.value, p.date, p.source])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
