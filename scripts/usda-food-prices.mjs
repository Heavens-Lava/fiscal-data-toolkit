#!/usr/bin/env node
// Grocery price watch using BLS average retail food price series via FRED.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, esc, fred, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

const ITEMS = [
  { id: "APU0000708111", label: "Eggs, grade A large", unit: "dozen" },
  { id: "APU0000709112", label: "Milk, whole", unit: "gallon" },
  { id: "APU0000703112", label: "Ground beef", unit: "lb" },
  { id: "APU0000702111", label: "White bread", unit: "lb" },
  { id: "APU0000FF1101", label: "Chicken breast", unit: "lb" },
  { id: "APU0000711211", label: "Bananas", unit: "lb" },
  { id: "APU0000711311", label: "Oranges", unit: "lb" },
  { id: "APU0000712311", label: "Potatoes", unit: "lb" },
];

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function price(n) {
  return `$${Number(n).toFixed(2)}`;
}

function pct(now, then) {
  return (now / then - 1) * 100;
}

function sign(n) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function atOrBefore(data, iso) {
  let out = null;
  for (const row of data) {
    if (row.d <= iso) out = row;
    else break;
  }
  return out;
}

function yearsBefore(iso, years) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function smallMultiples(rows, yearLabels) {
  const w = 1104, h = 400;
  const cols = 2, colW = 552, rowH = 92;
  const padX = 8, padTop = 14;
  const plotX = 156, plotW = 318, plotH = 50;
  let s = "";

  rows.forEach((r, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * colW + padX;
    const y = row * rowH + padTop;
    const vals = r.indexPoints.map((p) => p.v);
    const min = Math.min(90, ...vals);
    const max = Math.max(110, ...vals);
    const xOf = (j) => x + plotX + plotW * (j / Math.max(1, r.indexPoints.length - 1));
    const yOf = (v) => y + plotH * (1 - (v - min) / (max - min || 1));
    const baseY = yOf(100);
    const d = r.indexPoints.map((p, j) => `${j ? "L" : "M"}${xOf(j).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(" ");
    const last = r.indexPoints.at(-1);
    const firstPrice = r.prices.find(Boolean)?.v;
    const latestPrice = r.latest;

    s += `<text x="${x}" y="${y + 18}" font-size="16" font-weight="650" fill="${C.ink2}">${esc(r.label)}</text>`;
    s += `<text x="${x}" y="${y + 38}" font-size="13" fill="${C.muted}">${esc(price(firstPrice))} to ${esc(price(latestPrice))} / ${esc(r.unit)}</text>`;
    s += `<line x1="${x + plotX}" y1="${baseY}" x2="${x + plotX + plotW}" y2="${baseY}" stroke="${C.grid}" stroke-width="1"/>`;
    s += `<path d="${d}" fill="none" stroke="${r.periodChange === Math.max(...rows.map((x) => x.periodChange)) ? C.neg : C.s1}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    s += `<circle cx="${xOf(r.indexPoints.length - 1)}" cy="${yOf(last.v)}" r="4" fill="${C.ink}" stroke="${C.surface}" stroke-width="2"/>`;
    s += `<text x="${x + plotX + plotW + 12}" y="${yOf(last.v) + 5}" font-size="15" font-weight="650" fill="${C.ink}">${esc(sign(r.periodChange))}</text>`;
    s += `<text x="${x + plotX}" y="${y + plotH + 20}" font-size="12" fill="${C.muted}" text-anchor="middle">${esc(yearLabels[0])}</text>`;
    s += `<text x="${x + plotX + plotW}" y="${y + plotH + 20}" font-size="12" fill="${C.muted}" text-anchor="middle">${esc(yearLabels.at(-1))}</text>`;
  });

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}

const years = Math.max(1, Math.min(20, Number(argValue("--years", "5")) || 5));
const noImage = process.argv.includes("--no-image");
const showTable = process.argv.includes("--table") || process.argv.includes("table");
const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, `usda-food-prices-${years}yr-${stamp}`);
const historyBase = path.join(SOCIAL, `usda-food-prices-history-${years}yr-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

const rows = [];
for (const item of ITEMS) {
  const data = await fred(item.id);
  const latest = data.at(-1);
  const prevYear = atOrBefore(data, yearsBefore(latest.d, 1));
  const prior = atOrBefore(data, yearsBefore(latest.d, years));
  rows.push({
    ...item,
    latestDate: latest.d,
    latest: latest.v,
    data,
    yoy: prevYear ? pct(latest.v, prevYear.v) : null,
    periodChange: prior ? pct(latest.v, prior.v) : null,
  });
}

rows.sort((a, b) => b.periodChange - a.periodChange);
const hero = rows[0];
const chartSVG = horizontalBarChart(
  rows.map((r, i) => ({ label: r.label, v: Math.max(0, r.periodChange), color: i === 0 ? C.neg : C.s1 })),
  { fmtTick: (v) => `${Math.round(v)}%`, fmtVal: (v) => sign(v) }
);

const html = cardHTML({
  kicker: "Grocery price check",
  title: `Which staple foods rose most over ${years} years?`,
  hero: sign(hero.periodChange),
  heroLabel: `${hero.label}; latest ${price(hero.latest)} per ${hero.unit}`,
  chartSVG,
  source: "FRED/BLS average retail food prices",
  vintage: rows.map((r) => r.latestDate).sort().at(-1),
});

const lines = [
  `Grocery price check (${stamp})`,
  "",
  `These are BLS average retail prices, pulled through FRED. Latest item dates can differ by series.`,
  "Note: BLS average prices are best for price levels; percent changes here are simple comparisons of these posted average-price series.",
  "",
  "Item | Latest price | Latest date | YoY | Change over window",
  "---|---:|---:|---:|---:",
  ...rows.map((r) => `${r.label} | ${price(r.latest)} / ${r.unit} | ${r.latestDate} | ${r.yoy == null ? "n/a" : sign(r.yoy)} | ${r.periodChange == null ? "n/a" : sign(r.periodChange)}`),
  "",
  "Source: FRED series from BLS average retail food prices.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["item", "series", "unit", "latest_date", "latest_price", "yoy_pct", `change_${years}yr_pct`],
  rows.map((r) => [r.label, r.id, r.unit, r.latestDate, r.latest, r.yoy?.toFixed(4) ?? "", r.periodChange?.toFixed(4) ?? ""])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

const latestDate = rows.map((r) => r.latestDate).sort().at(-1);
const latestYear = Number(latestDate.slice(0, 4));
const startYear = latestYear - years;
const yearLabels = [];
for (let y = startYear; y <= latestYear; y++) yearLabels.push(String(y));

function yearlyPrice(row, year) {
  const end = year === latestYear ? latestDate : `${year}-12-31`;
  return atOrBefore(row.data, end);
}

const historyRows = rows.map((r) => {
  const prices = yearLabels.map((year) => yearlyPrice(r, Number(year)));
  const base = prices.find(Boolean)?.v;
  return {
    ...r,
    prices,
    indexPoints: prices.map((p, i) => ({
      label: yearLabels[i],
      v: p && base ? (p.v / base) * 100 : null,
    })).filter((p) => p.v != null),
  };
});

const historyChartSVG = smallMultiples(historyRows, yearLabels);

const historyHero = historyRows.slice().sort((a, b) => b.periodChange - a.periodChange)[0];
const historyHtml = cardHTML({
  kicker: "Grocery price trend",
  title: `Staple food prices over ${years} years`,
  hero: sign(historyHero.periodChange),
  heroLabel: `${historyHero.label}; latest ${price(historyHero.latest)} per ${historyHero.unit}`,
  chartSVG: historyChartSVG,
  source: "FRED/BLS average retail food prices; index line starts at 100",
  vintage: latestDate,
});

const historyLines = [
  `Grocery price trend (${stamp})`,
  "",
  `Line chart uses an index: each item's first available year in this ${years}-year window equals 100.`,
  "The table below keeps the actual posted average retail prices.",
  "",
  ["Item", "Unit", ...yearLabels].join(" | "),
  ["---", "---", ...yearLabels.map(() => "---:")].join("|"),
  ...historyRows.map((r) => [
    r.label,
    r.unit,
    ...r.prices.map((p) => p ? price(p.v) : "n/a"),
  ].join(" | ")),
  "",
  "Source: FRED series from BLS average retail food prices.",
];

writeFileSync(`${historyBase}.txt`, historyLines.join("\n"));
writeFileSync(`${historyBase}.csv`, toCSV(
  ["item", "series", "unit", ...yearLabels],
  historyRows.map((r) => [r.label, r.id, r.unit, ...r.prices.map((p) => p?.v ?? "")])
));
writeFileSync(`${historyBase}.html`, historyHtml);
if (!noImage) screenshot(`${historyBase}.html`, `${historyBase}.png`);

console.log(lines.join("\n"));
if (showTable) console.log(`\n${historyLines.join("\n")}`);
console.log(`\nSummary files: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`)).join(" / ")}`);
console.log(`History files: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${historyBase}.${ext}`)).join(" / ")}`);
