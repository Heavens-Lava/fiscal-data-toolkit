#!/usr/bin/env node
// tax-dollar-detail.mjs - detailed federal spending dollar by budget subfunction.
// Source: USAspending.gov Spending Explorer API. No API key required.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  C,
  cardHTML,
  horizontalBarChart,
  screenshot,
  toCSV,
} from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function fiscalYearDefault() {
  const now = new Date();
  return now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

function money(n) {
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function cents(v, total) {
  return (v / total) * 100;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

async function spendingSubfunctions(fy) {
  const res = await fetch("https://api.usaspending.gov/api/v2/spending/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "budget_subfunction", filters: { fy: String(fy), quarter: "4" } }),
  });
  if (!res.ok) throw new Error(`USAspending HTTP ${res.status}`);
  const json = await res.json();
  const rows = (json.results || [])
    .map((r) => ({ code: r.code, name: r.name, amount: Number(r.amount) || 0 }))
    .filter((r) => r.name !== "Unreported Data" && r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  if (!rows.length) throw new Error(`No USAspending rows returned for FY${fy}`);
  return { rows, total: Number(json.total) || rows.reduce((s, r) => s + r.amount, 0), endDate: json.end_date?.slice(0, 10) || `FY${fy}` };
}

const fy = Number(argValue("--fy", process.argv.find((a) => /^\d{4}$/.test(a)) || fiscalYearDefault()));
const noImage = process.argv.includes("--no-image");
const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, `tax-dollar-detail-${fy}-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const { rows, total, endDate } = await spendingSubfunctions(fy);
const top = rows.slice(0, 12);
const topFour = top.slice(0, 4);
const topFourCents = topFour.reduce((s, r) => s + cents(r.amount, total), 0);

const chartSVG = horizontalBarChart(
  top.map((r, i) => ({
    label: r.name.length > 34 ? `${r.name.slice(0, 31)}...` : r.name,
    v: cents(r.amount, total),
    color: i < 4 ? C.s2 : C.s1,
  })),
  { fmtTick: (v) => `${Math.round(v)}c`, fmtVal: (v) => `${v.toFixed(1)}c` }
);

const html = cardHTML({
  kicker: "Tax-dollar detail",
  title: "Where does a federal spending dollar go?",
  hero: `${topFourCents.toFixed(0)}c`,
  heroLabel: "of every $1 goes to the top 4 detailed buckets",
  chartSVG,
  source: "USAspending.gov budget subfunctions",
  vintage: `FY${fy}`,
});

const lead = top[0];
const lines = [
  `Tax-dollar detail (FY${fy})`,
  "",
  `The largest detailed bucket was ${lead.name}: ${money(lead.amount)}, or ${cents(lead.amount, total).toFixed(1)}c of every gross federal spending dollar.`,
  `The top 4 detailed buckets were about ${topFourCents.toFixed(1)}c of every $1.`,
  "",
  "Facebook post",
  "-------------",
  `Where does a federal spending dollar go? Here is the more detailed view for FY${fy}.`,
  "",
  ...top.slice(0, 8).map((r) => `${cents(r.amount, total).toFixed(1)}c - ${r.name} (${money(r.amount)})`),
  "",
  `Together, the top 4 detailed buckets account for about ${topFourCents.toFixed(1)}c of every $1 in this USAspending gross-spending view.`,
  "",
  "Important caveat: USAspending budget-function totals are gross spending categories, so they are best for showing relative buckets and rankings. Net federal outlays are lower after offsets and accounting adjustments.",
  "",
  "Source: USAspending.gov Spending Explorer API, budget subfunctions.",
  "",
  "Data table",
  "----------",
  "Rank | Budget subfunction | Amount | Cents per $1",
  "---:|---|---:|---:",
  ...rows.map((r, i) => `${i + 1} | ${r.name} | ${money(r.amount)} | ${cents(r.amount, total).toFixed(2)}c`),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "budget_subfunction", "amount", "cents_per_dollar"],
  rows.map((r, i) => [i + 1, r.name, r.amount, cents(r.amount, total).toFixed(4)])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
console.log(`Data through ${endDate}`);
