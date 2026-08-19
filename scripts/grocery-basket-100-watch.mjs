#!/usr/bin/env node
// grocery-basket-100-watch.mjs — a fixed grocery basket (real, unchanging
// quantities) priced in Jan 2020 vs. today, from BLS Average Retail Food
// Prices via FRED. The basket is NOT scaled/calibrated to land on any
// particular dollar figure -- it costs whatever it costs, then and now.
//
// Run:  node scripts/grocery-basket-100-watch.mjs
//       node scripts/grocery-basket-100-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, fred, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

// Fixed real quantities -- never rescaled. Chosen as a plausible one-time
// household grocery run; the point is that these numbers never change,
// only the prices behind them do.
const BASKET_ITEMS = [
  { id: "APU0000703112", name: "Ground beef", qty: 6, unit: "lbs" },
  { id: "APU0000FF1101", name: "Chicken breast (boneless)", qty: 6, unit: "lbs" },
  { id: "APU0000708111", name: "Eggs, Grade A large", qty: 4, unit: "dozen" },
  { id: "APU0000709112", name: "Whole milk", qty: 4, unit: "gallons" },
  { id: "APU0000702111", name: "White bread", qty: 5, unit: "1-lb loaves" },
  { id: "APU0000712311", name: "Potatoes", qty: 10, unit: "lbs" },
  { id: "APU0000711211", name: "Bananas", qty: 8, unit: "lbs" },
];

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}
function money(n) {
  return `$${n.toFixed(2)}`;
}
function pct(now, then) {
  return ((now / then) - 1) * 100;
}
function sign(n) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}
function atOrBefore(data, iso) {
  let out = null;
  for (const p of data) {
    if (p.d <= iso) out = p; else break;
  }
  return out;
}

const noImage = process.argv.includes("--no-image");
const baseIso = "2020-01-01";
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `grocery-basket-100-watch-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

const items = [];
let baseTotal = 0;
let nowTotal = 0;
let latestDate = baseIso;

for (const item of BASKET_ITEMS) {
  const series = await fred(item.id);
  if (!series.length) throw new Error(`No FRED data for ${item.name} (${item.id}).`);
  const basePoint = atOrBefore(series, baseIso) || series[0];
  const latestPoint = series.at(-1);
  if (latestPoint.d > latestDate) latestDate = latestPoint.d;

  const baseItemCost = basePoint.v * item.qty;
  const nowItemCost = latestPoint.v * item.qty;
  baseTotal += baseItemCost;
  nowTotal += nowItemCost;

  items.push({
    name: item.name, qty: item.qty, unit: item.unit,
    baseUnit: basePoint.v, nowUnit: latestPoint.v,
    baseCost: baseItemCost, nowCost: nowItemCost,
    changePct: pct(nowItemCost, baseItemCost),
  });
}

const totalChangePct = pct(nowTotal, baseTotal);
items.sort((a, b) => b.changePct - a.changePct);

const chartSVG = horizontalBarChart(
  items.map((it) => ({
    label: it.name, v: it.changePct,
    color: it.changePct >= 40 ? C.neg : it.changePct >= 20 ? C.cat[3] : C.cat[0],
  })),
  { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => sign(v) }
);

const html = cardHTML({
  kicker: "Grocery basket check",
  title: "The same grocery basket, Jan 2020 vs. today",
  hero: money(nowTotal),
  heroLabel: `Same basket cost ${money(baseTotal)} in Jan 2020 (${sign(totalChangePct)})`,
  chartSVG,
  source: "BLS Average Retail Food Prices via FRED",
  vintage: latestDate,
});

const facebook = [
  `The exact same grocery basket — 6 lbs ground beef, 6 lbs chicken breast, 4 dozen eggs, 4 gallons whole milk, 5 loaves of bread, 10 lbs potatoes, 8 lbs bananas — cost ${money(baseTotal)} in January 2020. Today it costs ${money(nowTotal)} (${sign(totalChangePct)}).`,
  "",
  "Here's how each item moved:",
  ...items.map((it) => `${it.name}: ${money(it.baseCost)} → ${money(it.nowCost)} (${sign(it.changePct)})`),
  "",
  "This is a fixed real basket — the same quantities every time this runs, never rescaled to hit a round number. It goes up or down exactly as much as the underlying BLS prices do.",
  "",
  "Source: U.S. Bureau of Labor Statistics, Average Retail Food Prices, via FRED.",
];

const lines = [
  `Grocery basket check (${stamp})`,
  "",
  `Basket cost, ${baseIso}: ${money(baseTotal)}. Basket cost, ${latestDate}: ${money(nowTotal)} (${sign(totalChangePct)}).`,
  "",
  "Item | Qty | Unit price then | Unit price now | Item cost then | Item cost now | Change",
  "---|---:|---:|---:|---:|---:|---:",
  ...items.map((it) => `${it.name} | ${it.qty} ${it.unit} | ${money(it.baseUnit)} | ${money(it.nowUnit)} | ${money(it.baseCost)} | ${money(it.nowCost)} | ${sign(it.changePct)}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["item", "qty", "unit", "unit_price_2020", "unit_price_now", "item_cost_2020", "item_cost_now", "pct_change"],
  items.map((it) => [it.name, it.qty, it.unit, it.baseUnit.toFixed(2), it.nowUnit.toFixed(2), it.baseCost.toFixed(2), it.nowCost.toFixed(2), it.changePct.toFixed(1)])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
