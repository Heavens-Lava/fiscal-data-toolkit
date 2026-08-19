#!/usr/bin/env node
// market-structure-watch.mjs - stock-market size, trading, issuance, and leverage.
// Sources: World Bank, SIFMA, FINRA, Federal Reserve SCF. Mostly keyless.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  C,
  metricListCard,
  screenshot,
  toCSV,
} from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

const WORLD_BANK = {
  marketCap: "CM.MKT.LCAP.CD",
  listedCompanies: "CM.MKT.LDOM.NO",
  tradedValue: "CM.MKT.TRAD.CD",
  turnover: "CM.MKT.TRNR",
};

const SCF = {
  year: 2022,
  stockOwnershipPct: 58.0,
  retirementAccountPct: 54.4,
  source: "Federal Reserve Survey of Consumer Finances",
};

function arg(name) {
  return process.argv.includes(name);
}

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function cleanText(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function money(n) {
  if (n == null || !Number.isFinite(n)) return "n/a";
  const s = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${Math.round(a).toLocaleString("en-US")}`;
}

function num(n) {
  return Math.round(n).toLocaleString("en-US");
}

function pct(n) {
  return `${n.toFixed(1)}%`;
}

async function worldBankLatest(country, indicator) {
  const url = `https://api.worldbank.org/v2/country/${country}/indicator/${indicator}?format=json&per_page=20`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`World Bank HTTP ${res.status} for ${indicator}`);
  const json = await res.json();
  const row = json?.[1]?.find((r) => r.value != null);
  if (!row) throw new Error(`World Bank returned no value for ${indicator}`);
  return { value: Number(row.value), year: row.date };
}

async function worldBankBundle(country) {
  const entries = await Promise.all(Object.entries(WORLD_BANK).map(async ([key, id]) => [key, await worldBankLatest(country, id)]));
  return Object.fromEntries(entries);
}

async function sifmaStats() {
  const url = "https://www.sifma.org/resources/research/statistics/us-equity-and-related-securities-statistics/";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`SIFMA HTTP ${res.status}`);
  const text = await res.text();
  const plain = cleanText(text);
  const ytd = plain.match(/YTD\s+(\d{4})\s+statistics\s+\(through\s+([^)]+)\)\s+include:/i);
  const equity = plain.match(/Total equity issuance\s+\$([\d,.]+)\s+billion,\s+([+\-\d.]+)%\s+Y\/Y/i);
  const ipo = plain.match(/IPO issuance\s+\$([\d,.]+)\s+billion,\s+([+\-\d.]+)%\s+Y\/Y/i);
  const adv = plain.match(/ADV\s+([\d,.]+)\s+billion\s+shares,\s+([+\-\d.]+)%\s+Y\/Y/i);
  return {
    year: ytd?.[1] || "",
    through: ytd?.[2] || "",
    totalEquityIssuance: equity ? Number(equity[1].replace(/,/g, "")) * 1e9 : null,
    totalEquityIssuanceYoY: equity ? Number(equity[2]) : null,
    ipoIssuance: ipo ? Number(ipo[1].replace(/,/g, "")) * 1e9 : null,
    ipoIssuanceYoY: ipo ? Number(ipo[2]) : null,
    advShares: adv ? Number(adv[1].replace(/,/g, "")) * 1e9 : null,
    advSharesYoY: adv ? Number(adv[2]) : null,
    source: "SIFMA US Equity and Related Securities Statistics",
  };
}

async function finraMargin() {
  const url = "https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-statistics";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`FINRA HTTP ${res.status}`);
  const text = await res.text();
  const m = text.match(/<tbody><tr><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/i);
  if (!m) throw new Error("Could not parse FINRA margin statistics table");
  return {
    month: m[1],
    marginDebt: Number(m[2].replace(/,/g, "")) * 1e6,
    cashFreeCredit: Number(m[3].replace(/,/g, "")) * 1e6,
    marginFreeCredit: Number(m[4].replace(/,/g, "")) * 1e6,
    source: "FINRA Margin Statistics",
  };
}

const noImage = arg("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `market-structure-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const [us, world, sifma, finra] = await Promise.all([
  worldBankBundle("USA"),
  worldBankBundle("WLD").catch(() => null),
  sifmaStats().catch((err) => ({ error: err.message })),
  finraMargin().catch((err) => ({ error: err.message })),
]);

const dollarRows = [
  { metric: "U.S. listed-company market cap", value: us.marketCap.value, date: us.marketCap.year, source: "World Bank" },
  { metric: "U.S. annual stock-trading value", value: us.tradedValue.value, date: us.tradedValue.year, source: "World Bank" },
];
if (world?.marketCap?.value) dollarRows.push({ metric: "World listed-company market cap", value: world.marketCap.value, date: world.marketCap.year, source: "World Bank" });
if (!finra.error) dollarRows.push({ metric: "Margin debt", value: finra.marginDebt, date: finra.month, source: finra.source });
if (!sifma.error && sifma.totalEquityIssuance != null) dollarRows.push({ metric: "U.S. equity issuance YTD", value: sifma.totalEquityIssuance, date: `${sifma.year} through ${sifma.through}`, source: sifma.source });
if (!sifma.error && sifma.ipoIssuance != null) dollarRows.push({ metric: "U.S. IPO issuance YTD", value: sifma.ipoIssuance, date: `${sifma.year} through ${sifma.through}`, source: sifma.source });

const chartRows = dollarRows
  .filter((r) => r.value > 0)
  .sort((a, b) => b.value - a.value)
  .slice(0, 7);

const marketCap = us.marketCap.value;
const tradedValue = us.tradedValue.value;
const listed = us.listedCompanies.value;
const turnover = us.turnover.value;
const marginShare = !finra.error ? (finra.marginDebt / marketCap) * 100 : null;
const worldVsUsMultiple = world?.marketCap?.value ? world.marketCap.value / marketCap : null;
const tradedShareOfCap = (tradedValue / marketCap) * 100;

// Identity color per metric (dataviz skill categorical order, C.cat) — world
// vs. US market size is one distinction (green vs. blue), margin debt /
// equity issuance / IPO issuance are each their own category.
const ROW_COLOR = {
  "World listed-company market cap": C.cat[5],
  "U.S. listed-company market cap": C.cat[0],
  "U.S. annual stock-trading value": C.cat[0],
  "Margin debt": C.cat[6],
  "U.S. equity issuance YTD": C.cat[3],
  "U.S. IPO issuance YTD": C.cat[2],
};
const ROW_ICON = {
  "World listed-company market cap": "globe",
  "U.S. listed-company market cap": "flag",
  "U.S. annual stock-trading value": "trend",
  "Margin debt": "percent",
  "U.S. equity issuance YTD": "doc",
  "U.S. IPO issuance YTD": "IPO",
};

const html = metricListCard({
  title: "How big is the stock market, and how much leverage is in it?",
  subtitle: "Key size and leverage metrics for global and U.S. markets",
  heroLabel: "U.S. listed-company market cap",
  heroValue: money(marketCap),
  heroSub: us.marketCap.year,
  rows: chartRows.map((r) => ({
    label: r.metric, value: r.value, value_display: money(r.value),
    color: ROW_COLOR[r.metric] || C.s1, icon: ROW_ICON[r.metric] || "trend",
  })),
  dividerAfterIndex: 2,
  callouts: [
    worldVsUsMultiple != null ? { icon: "globe", html: `The world's listed-company market cap is more than <b>${worldVsUsMultiple >= 2 ? "double" : `${worldVsUsMultiple.toFixed(1)}x`}</b> that of the U.S.` } : null,
    { icon: "trend", html: `U.S. annual stock-trading value equals <b>~${Math.round(tradedShareOfCap)}%</b> of U.S. market cap.` },
    marginShare != null ? { icon: "percent", html: `Margin debt remains small relative to total market size (<b>~${marginShare.toFixed(1)}%</b>).` } : null,
  ].filter(Boolean),
  source: "World Bank, FINRA, SIFMA, Federal Reserve SCF",
  vintage: stamp,
});

const facebook = [
  `The U.S. stock market is worth ${money(marketCap)} — ${worldVsUsMultiple != null ? `about ${pct(100 / worldVsUsMultiple)} of the ${money(world.marketCap.value)} global listed-equity market` : "a huge share of the global listed-equity market"}.`,
  "",
  "Size and leverage, in one snapshot:",
  ...chartRows.map((r) => `${r.metric}: ${money(r.value)} (${r.date})`),
  "",
  `For scale: U.S. stock trading during the year equals about ${Math.round(tradedShareOfCap)}% of the market's total value, while margin debt — money borrowed against stock holdings — is only about ${marginShare != null ? marginShare.toFixed(1) : "a small"}% of market cap. Leverage in the system is smaller than the headline dollar figures might suggest.`,
  "",
  `${pct(SCF.stockOwnershipPct)} of U.S. families own stocks directly or indirectly, per the Federal Reserve's ${SCF.year} Survey of Consumer Finances.`,
  "",
  "Sources: World Bank, FINRA Margin Statistics, SIFMA US Equity and Related Securities Statistics, Federal Reserve SCF.",
];

const lines = [
  `Market structure watch (${stamp})`,
  "",
  "Dollar metrics",
  "",
  "Metric | Latest | Date | Source",
  "---|---:|---:|---",
  ...dollarRows.map((r) => `${r.metric} | ${money(r.value)} | ${r.date} | ${r.source}`),
  "",
  "Activity and participation metrics",
  "",
  "Metric | Latest | Date | Source",
  "---|---:|---:|---",
  `U.S. listed domestic companies | ${num(listed)} | ${us.listedCompanies.year} | World Bank`,
  `U.S. stock-market turnover ratio | ${pct(turnover)} | ${us.turnover.year} | World Bank`,
  !sifma.error && sifma.advShares != null ? `Average daily U.S. equity volume | ${num(sifma.advShares)} shares | ${sifma.year} through ${sifma.through} | SIFMA` : `Average daily U.S. equity volume | n/a | n/a | SIFMA parse failed: ${sifma.error}`,
  `Families owning stocks, direct or indirect | ${pct(SCF.stockOwnershipPct)} | ${SCF.year} | ${SCF.source}`,
  `Families with retirement accounts | ${pct(SCF.retirementAccountPct)} | ${SCF.year} | ${SCF.source}`,
  !finra.error ? `Margin debt as share of U.S. market cap | ${pct(marginShare)} | ${finra.month} vs ${us.marketCap.year} market cap | FINRA + World Bank` : `Margin debt | n/a | n/a | FINRA parse failed: ${finra.error}`,
  "",
  "Table note: 'people trading stocks' is not a clean public live count. The closest official recurring measure is household stock ownership from the Federal Reserve Survey of Consumer Finances.",
  "",
  "Source links:",
  "World Bank indicators: CM.MKT.LCAP.CD, CM.MKT.LDOM.NO, CM.MKT.TRAD.CD, CM.MKT.TRNR.",
  "FINRA Margin Statistics: https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-statistics",
  "SIFMA US Equity and Related Securities Statistics: https://www.sifma.org/resources/research/statistics/us-equity-and-related-securities-statistics/",
  "Federal Reserve SCF: https://www.federalreserve.gov/econres/scfindex.htm",
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["metric", "value", "date", "source"],
  [
    ...dollarRows.map((r) => [r.metric, r.value, r.date, r.source]),
    ["U.S. listed domestic companies", listed, us.listedCompanies.year, "World Bank"],
    ["U.S. stock-market turnover ratio pct", turnover, us.turnover.year, "World Bank"],
    ["Average daily U.S. equity volume shares", sifma.advShares ?? "", `${sifma.year || ""} ${sifma.through || ""}`.trim(), sifma.source || `SIFMA parse failed: ${sifma.error}`],
    ["Families owning stocks direct or indirect pct", SCF.stockOwnershipPct, SCF.year, SCF.source],
    ["Families with retirement accounts pct", SCF.retirementAccountPct, SCF.year, SCF.source],
    ["Margin debt as share of U.S. market cap pct", marginShare ?? "", finra.month || "", finra.source || `FINRA parse failed: ${finra.error}`],
  ]
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
