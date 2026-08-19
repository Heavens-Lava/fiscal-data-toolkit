#!/usr/bin/env node
// Arizona economy snapshot from keyless FRED series.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  C,
  closest,
  fred,
  metricListCard,
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
const gdp = rows.find((r) => r.id === "AZNGSP");

// Gas is left out of the comparison rows on purpose: it's a volatile,
// largely national/oil-market-driven price, not a structural economic
// indicator, and its swings (±30-40%/yr) dwarf jobs/income/GDP/housing on
// a shared axis, burying the more meaningful signal. It's the hero number
// instead. Unemployment is also excluded from the bars specifically -- its
// "change" is measured in percentage POINTS, not percent, so it isn't the
// same unit as the other rows' % change and would be misleading side by
// side on one bar-length scale.
const barMetrics = rows.filter((r) => r.unit !== "percent" && r.id !== "APUS48A74714");
const ROW_COLOR = { AZNA: C.cat[0], AZSTHPI: C.cat[2], AZNGSP: C.cat[5], AZPCPI: C.cat[3] };
const ROW_ICON = { AZNA: "trend", AZSTHPI: "building", AZNGSP: "globe", AZPCPI: "doc" };

const html = metricListCard({
  title: "Phoenix gas is up sharply — the rest of Arizona's economy isn't moving nearly as fast",
  subtitle: "Year-over-year change across Arizona's economy",
  heroLabel: "Phoenix regular gas",
  heroValue: fmt(gas.latest, gas.unit),
  heroSub: gas.latest.d,
  rows: barMetrics.map((r) => ({
    label: r.label, value: r.chgRaw, value_display: r.chg,
    color: ROW_COLOR[r.id] || C.s1, icon: ROW_ICON[r.id] || "trend",
  })),
  callouts: [
    { icon: "trend", html: `Arizona payroll jobs are <b>${jobs.chg}</b> over the same period.` },
    { icon: "percent", html: `Unemployment moved <b>${unemp.chg}</b> — the labor market itself has barely shifted.` },
    { icon: "flag", html: `Gas is up <b>${gas.chg}</b> — driven mostly by national/global oil markets, not Arizona conditions.` },
  ],
  source: "FRED",
  vintage: gdp.latest.d,
});

const facebook = [
  `Phoenix gas hit ${fmt(gas.latest, gas.unit)}/gallon in ${gas.latest.d} — up ${gas.chg} from a year earlier.`,
  "",
  "Arizona economy snapshot:",
  ...rows.map((r) => `${r.label}: ${fmt(r.latest, r.unit)} as of ${r.latest.d} (${r.chg} vs. a year earlier)`),
  "",
  `For context: Arizona payroll jobs are ${jobs.chg} and unemployment is ${unemp.chg} over the same period — the labor market itself has moved far less than gas prices have.`,
  "",
  "Gas prices are volatile and largely driven by national/global oil markets, not Arizona-specific conditions — this is a snapshot, not a claim about the state economy's underlying health.",
  "",
  "Sources: FRED, series AZUR, AZNA, AZSTHPI, AZNGSP, AZPCPI, APUS48A74714.",
];

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
  "Facebook post",
  "-------------",
  facebook.join("\n"),
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
