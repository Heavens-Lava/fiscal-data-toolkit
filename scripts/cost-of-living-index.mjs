#!/usr/bin/env node
// Cost-of-living snapshot using keyless FRED CSV series.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  C,
  cardHTML,
  closest,
  fred,
  horizontalBarChart,
  oneYearBefore,
  printTable,
  screenshot,
  toCSV,
} from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

const SERIES = [
  { id: "CPIAUCSL", label: "Overall CPI", unit: "index" },
  { id: "CUSR0000SAF11", label: "Food at home", unit: "index" },
  { id: "CUSR0000SEHA", label: "Rent of primary residence", unit: "index" },
  { id: "GASREGW", label: "Regular gas", unit: "dollars/gal" },
  { id: "CES0500000003", label: "Avg hourly earnings", unit: "dollars/hour" },
  { id: "MSPUS", label: "Median new-home price", unit: "dollars" },
  { id: "MORTGAGE30US", label: "30-year mortgage rate", unit: "percent" },
];

function fmt(row, unit) {
  if (!row) return "-";
  if (unit === "dollars") return `$${Math.round(row.v).toLocaleString("en-US")}`;
  if (unit === "dollars/gal") return `$${row.v.toFixed(2)}`;
  if (unit === "dollars/hour") return `$${row.v.toFixed(2)}`;
  if (unit === "percent") return `${row.v.toFixed(2)}%`;
  if (unit === "index") return `${row.v.toFixed(1)} index`;
  return row.v.toFixed(1);
}

function pct(now, then) {
  return ((now.v / then.v - 1) * 100);
}

function sign(n, digits = 1) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function change(now, then, unit) {
  if (unit === "percent") return `${now.v - then.v >= 0 ? "+" : ""}${(now.v - then.v).toFixed(2)} pp`;
  return sign(pct(now, then));
}

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function latestAtOrBefore(data, isoDate) {
  let out = null;
  for (const row of data) {
    if (row.d <= isoDate) out = row;
    else break;
  }
  return out;
}

function monthEndISO(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
}

function monthWindow(endIso, years) {
  const end = new Date(`${endIso.slice(0, 7)}-01T00:00:00Z`);
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  const out = [];
  for (const d = new Date(start); d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    out.push({
      label: d.toISOString().slice(0, 7),
      end: monthEndISO(d.getUTCFullYear(), d.getUTCMonth()),
    });
  }
  return out;
}

const jan2020 = "2020-01-01";
const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, `cost-of-living-index-${stamp}`);
const historyBase = path.join(SOCIAL, `cost-of-living-index-history-${stamp}`);
const noImage = process.argv.includes("--no-image");
const table = process.argv.includes("--table");
const years = Math.max(1, Math.round(Number(argValue("--years", "5")) || 5));

mkdirSync(SOCIAL, { recursive: true });

const rows = [];
for (const s of SERIES) {
  const data = await fred(s.id);
  const latest = data.at(-1);
  const prevYear = closest(data, oneYearBefore(latest.d));
  const base2020 = closest(data, jan2020);
  rows.push({
    ...s,
    data,
    latest,
    prevYear,
    base2020,
    yoy: change(latest, prevYear, s.unit),
    since2020: change(latest, base2020, s.unit),
    yoyRaw: pct(latest, prevYear),
    since2020Raw: pct(latest, base2020),
  });
}

const cpi = rows.find((r) => r.id === "CPIAUCSL");
const wages = rows.find((r) => r.id === "CES0500000003");
const wageVsCpi = wages.since2020Raw - cpi.since2020Raw;

const chartRows = rows.filter((r) => r.unit !== "percent");
const chartSVG = horizontalBarChart(
  chartRows
    .map((r) => ({
      label: r.label,
      v: r.since2020Raw,
      color: r.id === "CES0500000003" ? C.s2 : C.s1,
    }))
    .sort((a, b) => b.v - a.v),
  {
    fmtTick: (t) => `${Math.round(t)}%`,
    fmtVal: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`,
  }
);

const html = cardHTML({
  kicker: "Cost-of-living check",
  title: "Percent change since January 2020",
  hero: cpi.since2020,
  heroLabel: `overall CPI since Jan 2020`,
  chartSVG,
  source: "FRED; bars show change since Jan 2020",
  vintage: cpi.latest.d,
});

const lines = [
  `Cost-of-living check (${stamp})`,
  "",
  `Overall CPI is ${cpi.yoy} year over year and ${cpi.since2020} since Jan 2020.`,
  `Average hourly earnings are ${wages.since2020} since Jan 2020, ${Math.abs(wageVsCpi).toFixed(1)} percentage points ${wageVsCpi >= 0 ? "ahead of" : "behind"} overall CPI.`,
  "",
  "Category | Latest | Date | YoY | Since Jan 2020",
  "---|---:|---:|---:|---:",
  ...rows.map((r) => `${r.label} | ${fmt(r.latest, r.unit)} | ${r.latest.d} | ${r.yoy} | ${r.since2020}`),
  "",
  "Note: CPI category values are index levels, not dollar prices. The percent-change columns are the useful comparison.",
  "",
  "Sources: FRED series CPIAUCSL, CUSR0000SAF11, CUSR0000SEHA, GASREGW, CES0500000003, MSPUS, MORTGAGE30US.",
];

const csv = [
  "label,series,latest_date,latest_value,unit,yoy,since_2020",
  ...rows.map((r) => [
    r.label, r.id, r.latest.d, r.latest.v, r.unit, r.yoy, r.since2020,
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")),
].join("\n") + "\n";

let historyCsvPath = null;
if (table) {
  const latestDate = rows.map((r) => r.latest.d).sort().at(-1);
  const months = monthWindow(latestDate, years);
  const historyColumns = ["Month", ...rows.map((r) => r.label)];
  const historyRows = months.map((m) => [
    m.label,
    ...rows.map((r) => fmt(latestAtOrBefore(r.data, m.end), r.unit)),
  ]);
  historyCsvPath = `${historyBase}.csv`;
  writeFileSync(historyCsvPath, toCSV(historyColumns, historyRows));
  printTable(
    `Cost-of-living history, latest available by month (${years} years)`,
    historyColumns,
    historyRows,
    "FRED",
    true
  );
  console.log("\n  Note: monthly rows use the latest available observation as of that month end. Some series are weekly, monthly, or quarterly.");
}

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, csv);
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean)
  .map((ext) => path.relative(ROOT, `${outBase}.${ext}`));
if (historyCsvPath) files.push(path.relative(ROOT, historyCsvPath));
console.log(`\nFiles: ${files.join(" / ")}`);
