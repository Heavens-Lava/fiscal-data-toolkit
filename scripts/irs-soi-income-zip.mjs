#!/usr/bin/env node
// IRS SOI ZIP income rankings from the official all-states CSV.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const IRS_URL = "https://www.irs.gov/pub/irs-soi/22zpallagi.csv";
const METRICS = {
  agi: { label: "Average AGI", amount: "A00100", count: "N1", perReturn: true },
  wages: { label: "Average wages", amount: "A00200", count: "N00200", perReturn: true },
  dividends: { label: "Total dividends", amount: "A00600", count: "N00600", perReturn: false },
  interest: { label: "Total interest", amount: "A00300", count: "N00300", perReturn: false },
  capgains: { label: "Total net capital gains", amount: "A01000", count: "N01000", perReturn: false },
  charitable: { label: "Total charitable contributions", amount: "A19700", count: "N19700", perReturn: false },
};

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (quoted && ch === '"' && next === '"') {
      cell += '"'; i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (!quoted && ch === ",") {
      row.push(cell); cell = "";
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell); rows.push(row);
  }
  return rows;
}

function money(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function dollars(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

const state = argValue("--state", "AZ").toUpperCase();
const metricKey = argValue("--metric", "agi");
const metric = METRICS[metricKey];
if (!metric) {
  console.error(`Unknown --metric "${metricKey}". Options: ${Object.keys(METRICS).join(", ")}`);
  process.exit(1);
}
const minReturns = Number(argValue("--min-returns", "1000")) || 1000;
const noImage = process.argv.includes("--no-image");
const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, `irs-soi-income-zip-${state.toLowerCase()}-${metricKey}-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

const res = await fetch(IRS_URL);
if (!res.ok) throw new Error(`IRS SOI HTTP ${res.status}`);
const [header, ...rawRows] = parseCsv(await res.text());
const idx = Object.fromEntries(header.map((h, i) => [h, i]));

const byZip = new Map();
for (const row of rawRows) {
  if (row[idx.STATE] !== state) continue;
  const zip = row[idx.zipcode];
  if (!zip || zip === "00000" || zip === "99999") continue;
  const amount = Number(row[idx[metric.amount]]) * 1000; // SOI money fields are in thousands of dollars.
  const count = Number(row[idx[metric.count]]);
  const returns = Number(row[idx.N1]);
  if (!Number.isFinite(amount) || !Number.isFinite(count) || !Number.isFinite(returns)) continue;
  const acc = byZip.get(zip) || { zip, amount: 0, count: 0, returns: 0 };
  acc.amount += amount;
  acc.count += count;
  acc.returns += returns;
  byZip.set(zip, acc);
}

const rows = [...byZip.values()]
  .filter((r) => r.returns >= minReturns && r.amount > 0)
  .map((r) => ({ ...r, rankValue: metric.perReturn ? r.amount / r.returns : r.amount }))
  .sort((a, b) => b.rankValue - a.rankValue);

if (!rows.length) throw new Error(`No IRS SOI rows found for ${state}`);
const top = rows.slice(0, 10);
const chartSVG = horizontalBarChart(
  top.map((r, i) => ({ label: r.zip, v: r.rankValue, color: i === 0 ? C.s2 : C.s1 })),
  { fmtTick: (v) => metric.perReturn ? dollars(v) : money(v), fmtVal: (v) => metric.perReturn ? dollars(v) : money(v) }
);

const html = cardHTML({
  kicker: "IRS income check",
  title: `${metric.label} by ${state} ZIP code`,
  hero: metric.perReturn ? dollars(top[0].rankValue) : money(top[0].rankValue),
  heroLabel: `ZIP ${top[0].zip}; tax year 2022`,
  chartSVG,
  source: "IRS Statistics of Income ZIP Code data",
  vintage: "2022",
});

const lines = [
  `IRS income check (${stamp})`,
  "",
  `Metric: ${metric.label}. Minimum returns per ZIP: ${minReturns.toLocaleString("en-US")}.`,
  "",
  "ZIP | Value | Returns | Total amount | Count for item",
  "---|---:|---:|---:|---:",
  ...top.map((r) => `${r.zip} | ${metric.perReturn ? dollars(r.rankValue) : money(r.rankValue)} | ${Math.round(r.returns).toLocaleString("en-US")} | ${money(r.amount)} | ${Math.round(r.count).toLocaleString("en-US")}`),
  "",
  "Source: IRS Statistics of Income ZIP Code data, tax year 2022. Dollar amount fields are aggregated from IRS thousand-dollar fields.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["zip", "metric", "rank_value", "returns", "total_amount", "item_count", "tax_year"],
  rows.map((r) => [r.zip, metricKey, r.rankValue, r.returns, r.amount, r.count, 2022])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`)).join(" / ")}`);
