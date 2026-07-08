#!/usr/bin/env node
// Arizona economy snapshot from keyless FRED series.

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
  screenshot,
} from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

const SERIES = [
  { id: "AZUR", label: "Unemployment rate", unit: "percent" },
  { id: "AZNA", label: "Nonfarm payroll jobs", unit: "thousands" },
  { id: "AZSTHPI", label: "Home price index", unit: "index" },
  { id: "AZNGSP", label: "Nominal GDP", unit: "millions" },
  { id: "AZPCPI", label: "Per-capita income", unit: "dollars" },
  { id: "APUS48A74714", label: "Phoenix regular gas", unit: "dollars/gal" },
];

function previousPoint(rows, latest) {
  const i = rows.findIndex((row) => row.d === latest.d);
  return rows[Math.max(0, i - 1)] || latest;
}

function fmt(row, unit) {
  if (!row) return "-";
  if (unit === "percent") return `${row.v.toFixed(1)}%`;
  if (unit === "thousands") return `${Math.round(row.v).toLocaleString("en-US")}k`;
  if (unit === "millions") return `$${(row.v / 1e6).toFixed(1)}T`;
  if (unit === "dollars") return `$${Math.round(row.v).toLocaleString("en-US")}`;
  if (unit === "dollars/gal") return `$${row.v.toFixed(2)}`;
  return row.v.toFixed(1);
}

function pct(now, then) {
  return ((now.v / then.v - 1) * 100);
}

function change(now, then, unit) {
  if (unit === "percent") return `${now.v - then.v >= 0 ? "+" : ""}${(now.v - then.v).toFixed(1)} pp`;
  return `${pct(now, then) >= 0 ? "+" : ""}${pct(now, then).toFixed(1)}%`;
}

const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, `arizona-economy-${stamp}`);
const noImage = process.argv.includes("--no-image");

mkdirSync(SOCIAL, { recursive: true });

const rows = [];
for (const s of SERIES) {
  const data = await fred(s.id);
  const latest = data.at(-1);
  const nearYear = closest(data, oneYearBefore(latest.d));
  const prevYear = nearYear.d === latest.d ? previousPoint(data, latest) : nearYear;
  rows.push({ ...s, latest, prevYear, chg: change(latest, prevYear, s.unit), chgRaw: pct(latest, prevYear) });
}

const jobs = rows.find((r) => r.id === "AZNA");
const unemp = rows.find((r) => r.id === "AZUR");
const gas = rows.find((r) => r.id === "APUS48A74714");

const chartSVG = horizontalBarChart(
  rows
    .filter((r) => r.unit !== "percent")
    .map((r) => ({ label: r.label, v: r.chgRaw, color: r.id === "APUS48A74714" ? C.neg : C.s1 }))
    .sort((a, b) => b.v - a.v),
  {
    fmtTick: (t) => `${Math.round(t)}%`,
    fmtVal: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`,
  }
);

const html = cardHTML({
  kicker: "Arizona economy check",
  title: "One-year change across Arizona jobs, income, housing, and gas",
  hero: gas.chg,
  heroLabel: `Phoenix regular gas through ${gas.latest.d}`,
  chartSVG,
  source: "FRED",
  vintage: gas.latest.d,
});

const lines = [
  `Arizona economy check (${stamp})`,
  "",
  `Arizona payroll jobs: ${fmt(jobs.latest, jobs.unit)} as of ${jobs.latest.d} (${jobs.chg} from roughly a year earlier).`,
  `Unemployment: ${fmt(unemp.latest, unemp.unit)} as of ${unemp.latest.d} (${unemp.chg} from roughly a year earlier).`,
  `Phoenix regular gas: ${fmt(gas.latest, gas.unit)} as of ${gas.latest.d} (${gas.chg} year over year).`,
  "",
  "Indicator | Latest | Date | 1-year change",
  "---|---:|---:|---:",
  ...rows.map((r) => `${r.label} | ${fmt(r.latest, r.unit)} | ${r.latest.d} | ${r.chg}`),
  "",
  "Sources: FRED series AZUR, AZNA, AZSTHPI, AZNGSP, AZPCPI, APUS48A74714.",
];

const csv = [
  "label,series,latest_date,latest_value,unit,one_year_change",
  ...rows.map((r) => [
    r.label, r.id, r.latest.d, r.latest.v, r.unit, r.chg,
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")),
].join("\n") + "\n";

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, csv);
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean)
  .map((ext) => path.relative(ROOT, `${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
