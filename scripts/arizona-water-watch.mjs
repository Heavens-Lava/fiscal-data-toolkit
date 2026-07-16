#!/usr/bin/env node
// Colorado River reservoir storage and Arizona drought snapshot.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, lineChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const RESERVOIRS = [
  { name: "Lake Mead", locationId: 3514, color: C.s1 },
  { name: "Lake Powell", locationId: 393, color: C.s2 },
];

const stamp = new Date().toISOString().slice(0, 10);
const noImage = process.argv.includes("--no-image");
const years = Math.max(5, Math.min(20, Number(process.argv[process.argv.indexOf("--years") + 1]) || 10));
const outBase = path.join(SOCIAL, `arizona-water-watch-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function maf(n) { return `${(n / 1e6).toFixed(2)} MAF`; }
function pct(n) { return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; }
function closest(rows, target) {
  const ms = Date.parse(target);
  return rows.reduce((best, row) => Math.abs(Date.parse(row.date) - ms) < Math.abs(Date.parse(best.date) - ms) ? row : best);
}

async function json(url) {
  const res = await fetch(url, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

async function reservoirPoint(reservoir, year, monthDay) {
  const center = new Date(`${year}-${monthDay}T00:00:00Z`);
  const after = new Date(center); after.setUTCDate(after.getUTCDate() - 10);
  const before = new Date(center); before.setUTCDate(before.getUTCDate() + 10);
  const qs = new URLSearchParams({
    locationId: String(reservoir.locationId),
    parameterId: "3",
    "dateTime[after]": after.toISOString().slice(0, 10),
    "dateTime[before]": before.toISOString().slice(0, 10),
    "catalogItem.isModeled": "false",
  });
  const data = await json(`https://data.usbr.gov/rise/api/result?${qs}`);
  const rows = (data.data || []).map((x) => ({
    date: x.attributes.dateTime.slice(0, 10),
    storage: Number(x.attributes.result),
  })).filter((x) => Number.isFinite(x.storage));
  if (!rows.length) throw new Error(`No ${reservoir.name} storage near ${year}-${monthDay}`);
  return { reservoir: reservoir.name, year, ...closest(rows, `${year}-${monthDay}`) };
}

async function drought() {
  const end = new Date();
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 30);
  const d = (x) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}/${x.getUTCFullYear()}`;
  const url = `https://usdmdataservices.unl.edu/api/StateStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=04&startdate=${d(start)}&enddate=${d(end)}&statisticsType=1`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Drought Monitor HTTP ${res.status}`);
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const values = lines[1].split(",");
  return Object.fromEntries(header.map((h, i) => [h, values[i]]));
}

const monthDay = stamp.slice(5);
const currentYear = Number(stamp.slice(0, 4));
const targetYears = Array.from({ length: years + 1 }, (_, i) => currentYear - years + i);
const [points, droughtRow] = await Promise.all([
  Promise.all(RESERVOIRS.flatMap((r) => targetYears.map((year) => reservoirPoint(r, year, monthDay)))),
  drought().catch(() => null),
]);

const series = RESERVOIRS.map((r) => ({
  ...r,
  points: points.filter((p) => p.reservoir === r.name).sort((a, b) => a.year - b.year),
}));
const latest = series.map((s) => s.points[s.points.length - 1]);
const chartSVG = lineChart(series.map((s) => ({
  color: s.color,
  points: s.points.map((p) => ({ label: String(p.year), v: p.storage / 1e6 })),
  endLabel: (v) => `${s.name.replace("Lake ", "")} ${v}`,
})), { fmtTick: (v) => `${v.toFixed(0)}`, fmtVal: (v) => `${v.toFixed(2)} MAF`, labelStep: 2, yLabel: "Million acre-feet" });

const mead = latest.find((x) => x.reservoir === "Lake Mead");
const powell = latest.find((x) => x.reservoir === "Lake Powell");
const meadFirst = series[0].points[0];
const powellFirst = series[1].points[0];
const d1 = droughtRow ? Number(droughtRow.D1) : null;
const d3 = droughtRow ? Number(droughtRow.D3) : null;
const html = cardHTML({
  kicker: "Arizona water watch",
  title: `${years}-year Colorado River reservoir check`,
  hero: maf(mead.storage),
  heroLabel: `Lake Mead storage on ${mead.date}`,
  chartSVG,
  source: "U.S. Bureau of Reclamation RISE; U.S. Drought Monitor",
  vintage: mead.date,
});

const facebook = [
  "How much water is currently stored in Lake Mead and Lake Powell?",
  "",
  `Lake Mead: ${maf(mead.storage)} (${pct((mead.storage / meadFirst.storage - 1) * 100)} since ${meadFirst.year})`,
  `Lake Powell: ${maf(powell.storage)} (${pct((powell.storage / powellFirst.storage - 1) * 100)} since ${powellFirst.year})`,
  ...(droughtRow ? [`Arizona in moderate-or-worse drought: ${d1.toFixed(1)}%`, `Arizona in extreme-or-worse drought: ${d3.toFixed(1)}%`] : []),
  "",
  "An acre-foot is roughly enough water to cover one acre one foot deep. Reservoir storage changes seasonally, so the chart compares approximately the same calendar date each year.",
  "",
  "Which water measure should I add next: elevation, inflow, releases, or a longer historical comparison?",
  "",
  "Follow for a weekly Arizona water update and share this with someone who follows the Colorado River.",
];

const lines = [
  `Arizona water watch (${stamp})`, "",
  `Reservoir storage comparison near ${monthDay} each year.`, "",
  "Year | Lake Mead | Lake Powell",
  "---:|---:|---:",
  ...targetYears.map((year) => {
    const a = points.find((p) => p.year === year && p.reservoir === "Lake Mead");
    const b = points.find((p) => p.year === year && p.reservoir === "Lake Powell");
    return `${year} | ${maf(a.storage)} | ${maf(b.storage)}`;
  }),
  ...(droughtRow ? ["", "Arizona drought snapshot", "", "Measure | Share of Arizona", "---|---:", `Abnormally dry or worse (D0-D4) | ${Number(droughtRow.D0).toFixed(1)}%`, `Moderate drought or worse (D1-D4) | ${d1.toFixed(1)}%`, `Severe drought or worse (D2-D4) | ${Number(droughtRow.D2).toFixed(1)}%`, `Extreme drought or worse (D3-D4) | ${d3.toFixed(1)}%`, `Exceptional drought (D4) | ${Number(droughtRow.D4).toFixed(1)}%`] : []),
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: U.S. Bureau of Reclamation RISE API; U.S. Drought Monitor state statistics.",
  "Note: Reclamation observations are provisional and may be revised.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["reservoir", "year", "date", "storage_acre_feet"], points.map((p) => [p.reservoir, p.year, p.date, p.storage])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
