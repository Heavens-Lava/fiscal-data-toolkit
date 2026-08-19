#!/usr/bin/env node
// CFPB consumer complaint totals by product and company for the latest year.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, `consumer-complaint-watch-${stamp}`);
const noImage = process.argv.includes("--no-image");
mkdirSync(SOCIAL, { recursive: true });

function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function num(n) { return Math.round(n).toLocaleString("en-US"); }
function short(n) { return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n); }
function dateOffset(years) { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); return d.toISOString().slice(0, 10); }

async function complaintData(state = null) {
  const qs = new URLSearchParams({ size: "0", date_received_min: dateOffset(1), date_received_max: stamp });
  if (state) qs.set("state", state);
  const res = await fetch(`https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/?${qs}`, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`CFPB HTTP ${res.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

function buckets(data, key) { return data.aggregations?.[key]?.[key]?.buckets || []; }

const [us, az] = await Promise.all([complaintData(), complaintData("AZ")]);
const products = buckets(us, "product").slice(0, 10).map((x, i) => ({ rank: i + 1, name: x.key, count: x.doc_count }));
const companies = buckets(us, "company").slice(0, 10).map((x, i) => ({ rank: i + 1, name: x.key, count: x.doc_count }));
const azProducts = buckets(az, "product").slice(0, 5).map((x, i) => ({ rank: i + 1, name: x.key, count: x.doc_count }));
if (!products.length) throw new Error("CFPB returned no product aggregations.");
const total = Number(us.hits?.total?.value || products.reduce((s, x) => s + x.count, 0));
const azTotal = Number(az.hits?.total?.value || azProducts.reduce((s, x) => s + x.count, 0));

const chartLabel = (value) => value.length > 28 ? `${value.slice(0, 25)}...` : value;
const chartSVG = horizontalBarChart(products.slice(0, 8).map((r) => ({ label: chartLabel(r.name), v: r.count, color: r.rank === 1 ? C.neg : C.s1 })), {
  fmtTick: short,
  fmtVal: short,
});
const html = cardHTML({
  kicker: "Consumer complaint watch",
  title: "Which financial products draw the most complaints?",
  hero: short(total),
  heroLabel: `published CFPB complaints; latest 12 months`,
  chartSVG,
  source: "Consumer Financial Protection Bureau",
  vintage: stamp,
});

const facebook = [
  `${products[0].name} drew ${num(products[0].count)} CFPB complaints in the past 12 months — ${(products[0].count / products[1].count).toFixed(1)}x the #2 product. Every product, ranked:`,
  "",
  `Published complaints in the latest 12 months: ${num(total)}`,
  `#2 product: ${products[1].name} (${num(products[1].count)})`,
  `Arizona complaints: ${num(azTotal)}; top product: ${azProducts[0]?.name || "n/a"}`,
  "",
  `The company with the most published complaints was ${companies[0]?.name || "n/a"} (${num(companies[0]?.count || 0)}). Company totals are not adjusted for customer count or market share, so they should not be read as a simple worst-company ranking.`,
  "",
  "Which category should I break down next: credit reports, debt collection, credit cards, mortgages, or bank accounts?",
  "",
  "Follow for monthly consumer-data checks and share this with someone who has dealt with a financial complaint.",
];

const lines = [
  `Consumer complaint watch (${stamp})`, "",
  `Window: ${dateOffset(1)} through ${stamp}. Published CFPB complaints: ${num(total)}.`, "",
  "Rank | Financial product | Complaints",
  "---:|---|---:",
  ...products.map((r) => `${r.rank} | ${r.name} | ${num(r.count)}`),
  "", "Companies with the most published complaints", "",
  "Rank | Company | Complaints", "---:|---|---:",
  ...companies.map((r) => `${r.rank} | ${r.name} | ${num(r.count)}`),
  "", "Arizona product breakdown", "",
  "Rank | Financial product | Complaints", "---:|---|---:",
  ...azProducts.map((r) => `${r.rank} | ${r.name} | ${num(r.count)}`),
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: Consumer Financial Protection Bureau Consumer Complaint Database API.",
  "Note: complaints are submissions published by CFPB, not verified findings of wrongdoing. Counts are not normalized by customers or accounts.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["type", "rank", "name", "complaints", "window_start", "window_end"], [
  ...products.map((r) => ["product", r.rank, r.name, r.count, dateOffset(1), stamp]),
  ...companies.map((r) => ["company", r.rank, r.name, r.count, dateOffset(1), stamp]),
  ...azProducts.map((r) => ["arizona_product", r.rank, r.name, r.count, dateOffset(1), stamp]),
]));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
