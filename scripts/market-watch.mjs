#!/usr/bin/env node
// Market watch snapshot: stock/index/ETF returns from Yahoo Finance plus
// gold and silver spot prices from FRED. Educational only, not financial advice.

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

const DEFAULT_TICKERS = ["SPY", "QQQ", "DIA", "IWM", "NVDA", "AMD", "MSFT", "AAPL", "META", "JPM"];
const METALS = [
  { symbol: "GC=F", label: "Gold futures" },
  { symbol: "SI=F", label: "Silver futures" },
];

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function parseTickers() {
  const raw = argValue("--tickers");
  const list = raw ? raw.split(",") : process.argv.slice(2).filter((a) => !a.startsWith("--"));
  return (list.length ? list : DEFAULT_TICKERS).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function money(n, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "-";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function pct(n) {
  if (n == null || !Number.isFinite(n)) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function oneYearBefore(isoDate) {
  const d = new Date(isoDate);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function startOfYear(isoDate) {
  return `${isoDate.slice(0, 4)}-01-01`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

async function yahooChart(symbol, range = "6y", interval = "1d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo ${res.status} for ${symbol}`);
  const result = (await res.json())?.chart?.result?.[0];
  if (!result) throw new Error(`No Yahoo chart data for ${symbol}`);
  const quote = result.indicators?.quote?.[0] || {};
  const ts = result.timestamp || [];
  const rows = ts.map((t, i) => ({
    d: new Date(t * 1000).toISOString().slice(0, 10),
    v: quote.close?.[i],
  })).filter((r) => Number.isFinite(r.v));
  if (!rows.length) throw new Error(`No Yahoo close prices for ${symbol}`);
  return {
    symbol,
    name: result.meta?.shortName || result.meta?.longName || symbol,
    currency: result.meta?.currency || "USD",
    rows,
  };
}

function rowAtOrBefore(rows, isoDate) {
  let out = null;
  for (const row of rows) {
    if (row.d <= isoDate) out = row;
    else break;
  }
  return out;
}

function returnsFromRows(rows) {
  const latest = rows.at(-1);
  const oneMonth = rowAtOrBefore(rows, new Date(Date.parse(latest.d) - 31 * 86_400_000).toISOString().slice(0, 10));
  const ytd = rowAtOrBefore(rows, startOfYear(latest.d));
  const oneYear = rowAtOrBefore(rows, oneYearBefore(latest.d));
  const fiveYear = rowAtOrBefore(rows, new Date(Date.parse(latest.d) - 365.25 * 5 * 86_400_000).toISOString().slice(0, 10));
  const ret = (base) => base ? latest.v / base.v - 1 : null;
  return {
    latest,
    oneMonth: ret(oneMonth),
    ytd: ret(ytd),
    oneYear: ret(oneYear),
    fiveYear: ret(fiveYear),
  };
}

async function stockRow(symbol) {
  const { name, currency, rows } = await yahooChart(symbol);
  const r = returnsFromRows(rows);
  return {
    type: "Stock/ETF",
    symbol,
    name,
    latestDate: r.latest.d,
    price: r.latest.v,
    currency,
    oneMonth: r.oneMonth,
    ytd: r.ytd,
    oneYear: r.oneYear,
    fiveYear: r.fiveYear,
  };
}

async function metalRow(metal) {
  const { rows } = await yahooChart(metal.symbol);
  const r = returnsFromRows(rows);
  return {
    type: "Metal",
    symbol: metal.label,
    name: metal.label,
    latestDate: r.latest.d,
    price: r.latest.v,
    currency: "USD",
    oneMonth: r.oneMonth,
    ytd: r.ytd,
    oneYear: r.oneYear,
    fiveYear: r.fiveYear,
  };
}

const tickers = parseTickers();
const noImage = process.argv.includes("--no-image");
const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, `market-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const stockResults = [];
for (const t of tickers) {
  try {
    stockResults.push(await stockRow(t));
  } catch (err) {
    stockResults.push({ type: "Stock/ETF", symbol: t, name: t, error: err.message });
  }
}
const metalResults = [];
for (const m of METALS) {
  try {
    metalResults.push(await metalRow(m));
  } catch (err) {
    metalResults.push({ type: "Metal", symbol: m.symbol, name: m.label, error: err.message });
  }
}

const rows = [...stockResults, ...metalResults];
const okRows = rows.filter((r) => !r.error);
const best = [...okRows].filter((r) => r.oneYear != null).sort((a, b) => b.oneYear - a.oneYear)[0];
const worst = [...okRows].filter((r) => r.oneYear != null).sort((a, b) => a.oneYear - b.oneYear)[0];

const chartRows = okRows
  .filter((r) => r.oneYear != null)
  .sort((a, b) => b.oneYear - a.oneYear)
  .slice(0, 12);
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({
    label: r.symbol,
    v: r.oneYear * 100,
    color: r.oneYear >= 0 ? (r.type === "Metal" ? C.s2 : C.s1) : C.neg,
  })),
  { fmtTick: (t) => `${Math.round(t)}%`, fmtVal: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` }
);

const html = cardHTML({
  kicker: "Market watch",
  title: "Stocks, indexes, gold, and silver: 1-year return check",
  hero: best ? pct(best.oneYear * 100) : "-",
  heroLabel: best ? `${best.symbol} 1-year return` : "latest available",
  chartSVG,
  source: "Yahoo Finance",
  vintage: okRows.map((r) => r.latestDate).sort().at(-1) || stamp,
});

const facebook = [
  best && worst
    ? `${best.symbol} (${best.name}) leads this snapshot with a ${pct(best.oneYear * 100)} 1-year return, while ${worst.symbol} (${worst.name}) is the weakest at ${pct(worst.oneYear * 100)}.`
    : "Market snapshot -- no 1-year returns were available for this run.",
  "",
  `As of ${okRows.map((r) => r.latestDate).sort().at(-1) || stamp}:`,
  ...rows.map((r) => r.error
    ? `${r.symbol} (${r.name}): data unavailable`
    : `${r.symbol} (${r.name}): ${money(r.price)}, ${pct(r.oneYear * 100)} 1-year / ${pct(r.fiveYear * 100)} 5-year`
  ),
  "",
  "This is a point-in-time snapshot, not investment advice -- prices move by the minute, and 1-year/5-year returns don't predict future performance.",
  "",
  "Sources: Yahoo Finance chart API for stocks/ETFs and gold/silver futures.",
  "Education/research only. Not financial advice.",
];

const lines = [
  `Market watch (${stamp})`,
  "",
  best ? `Best 1-year return in this snapshot: ${best.symbol} (${best.name}) at ${pct(best.oneYear * 100)}.` : "No 1-year returns available.",
  worst ? `Weakest 1-year return in this snapshot: ${worst.symbol} (${worst.name}) at ${pct(worst.oneYear * 100)}.` : "",
  "",
  "Symbol | Name | Type | Price | Date | 1M | YTD | 1Y | 5Y",
  "---|---|---|---:|---:|---:|---:|---:|---:",
  ...rows.map((r) => r.error
    ? `${r.symbol} | ${r.name} | ${r.type} | error | - | - | - | - | -`
    : `${r.symbol} | ${r.name} | ${r.type} | ${money(r.price)} | ${r.latestDate} | ${pct(r.oneMonth * 100)} | ${pct(r.ytd * 100)} | ${pct(r.oneYear * 100)} | ${pct(r.fiveYear * 100)}`
  ),
  "",
  "Sources: Yahoo Finance chart API for stocks/ETFs and gold/silver futures.",
  "Education/research only. Not financial advice.",
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

const csv = toCSV(
  ["symbol", "name", "type", "latest_date", "price", "currency", "one_month_pct", "ytd_pct", "one_year_pct", "five_year_pct", "error"],
  rows.map((r) => [
    r.symbol,
    r.name,
    r.type,
    r.latestDate || "",
    r.price ?? "",
    r.currency || "",
    r.oneMonth != null ? (r.oneMonth * 100).toFixed(2) : "",
    r.ytd != null ? (r.ytd * 100).toFixed(2) : "",
    r.oneYear != null ? (r.oneYear * 100).toFixed(2) : "",
    r.fiveYear != null ? (r.fiveYear * 100).toFixed(2) : "",
    r.error || "",
  ])
);

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, csv);
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
