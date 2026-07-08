#!/usr/bin/env node
// crypto-market-watch.mjs - crypto price and market-cap snapshot from CoinGecko.
// No key required for the public endpoint. Educational only, not financial advice.

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

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function money(n, digits = 2) {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: digits })}`;
}

function pct(n) {
  if (n == null || !Number.isFinite(n)) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

const count = Math.min(Number(argValue("--count", "10")), 25);
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `crypto-market-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const qs = new URLSearchParams({
  vs_currency: "usd",
  order: "market_cap_desc",
  per_page: String(count),
  page: "1",
  sparkline: "false",
  price_change_percentage: "24h,7d,30d,1y",
});
const res = await fetch(`https://api.coingecko.com/api/v3/coins/markets?${qs}`, {
  headers: { "User-Agent": "fiscal-data-toolkit/1.0" },
});
if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
const rows = await res.json();
if (!Array.isArray(rows) || !rows.length) throw new Error("CoinGecko returned no rows");

const totalMarketCap = rows.reduce((s, r) => s + (Number(r.market_cap) || 0), 0);
const leader = rows[0];
const chartSVG = horizontalBarChart(
  rows.slice(0, 12).map((r, i) => ({
    label: String(r.symbol || r.name).toUpperCase(),
    v: Number(r.market_cap) || 0,
    color: i === 0 ? C.s2 : C.s1,
  })),
  { fmtTick: money, fmtVal: money }
);

const html = cardHTML({
  kicker: "Crypto market watch",
  title: `Top ${rows.length} crypto assets by market cap`,
  hero: money(leader.market_cap),
  heroLabel: `${leader.name} market cap`,
  chartSVG,
  source: "CoinGecko public API",
  vintage: stamp,
});

const lines = [
  `Crypto market watch (${stamp})`,
  "",
  `Top asset: ${leader.name} (${String(leader.symbol).toUpperCase()}) at ${money(leader.current_price)}; market cap ${money(leader.market_cap)}.`,
  `Combined market cap of top ${rows.length} shown: ${money(totalMarketCap)}.`,
  "",
  "Rank | Asset | Price | Market cap | 24h | 7d | 30d | 1y",
  "---:|---|---:|---:|---:|---:|---:|---:",
  ...rows.map((r) => `${r.market_cap_rank} | ${r.name} (${String(r.symbol).toUpperCase()}) | ${money(r.current_price)} | ${money(r.market_cap)} | ${pct(r.price_change_percentage_24h_in_currency)} | ${pct(r.price_change_percentage_7d_in_currency)} | ${pct(r.price_change_percentage_30d_in_currency)} | ${pct(r.price_change_percentage_1y_in_currency)}`),
  "",
  "Source: CoinGecko public markets API.",
  "Education/research only. Not financial advice.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "id", "symbol", "name", "price_usd", "market_cap_usd", "change_24h_pct", "change_7d_pct", "change_30d_pct", "change_1y_pct"],
  rows.map((r) => [
    r.market_cap_rank, r.id, r.symbol, r.name, r.current_price, r.market_cap,
    r.price_change_percentage_24h_in_currency ?? "",
    r.price_change_percentage_7d_in_currency ?? "",
    r.price_change_percentage_30d_in_currency ?? "",
    r.price_change_percentage_1y_in_currency ?? "",
  ])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
