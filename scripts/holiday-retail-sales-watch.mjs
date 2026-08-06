#!/usr/bin/env node
// Holiday shopping season retail sales — Census Bureau MARTS (Advance Monthly
// Retail Trade Survey), November sales (the Black Friday / holiday-kickoff
// month) each year, seasonally adjusted, vs. the online/nonstore-retailer
// slice of it.
//
// Run:  node scripts/holiday-retail-sales-watch.mjs
// Key:  free registration at api.census.gov/data/key_signup.html → store in .env as CENSUS_API_KEY

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, envValue, money, pct, rel } from "./lib/data-common.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `holiday-retail-sales-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

// category_code 44W72 = retail & food services, total. 454 = nonstore
// retailers (mail-order/online) — the closest official proxy for "online
// holiday shopping." data_type_code SM = sales, monthly ($ millions).
async function marts(year, categoryCode) {
  const qs = new URLSearchParams({
    get: "cell_value,data_type_code", time: `${year}-11`,
    seasonally_adj: "yes", category_code: categoryCode, key,
  });
  const res = await fetch(`https://api.census.gov/data/timeseries/eits/marts?${qs}`);
  if (!res.ok) throw new Error(`Census MARTS HTTP ${res.status}`);
  const rows = (await res.json()).slice(1);
  const sm = rows.find((r) => r[1] === "SM");
  return sm ? Number(sm[0]) * 1_000_000 : null;
}

const years = [2021, 2022, 2023, 2024, 2025];
const rows = [];
for (const year of years) {
  const [total, nonstore] = await Promise.all([marts(year, "44W72"), marts(year, "454")]);
  if (total == null) continue;
  rows.push({ year, total, nonstore, nonstorePct: nonstore != null ? (nonstore / total) * 100 : null });
}
if (!rows.length) throw new Error("No Census MARTS November retail data available.");

const latest = rows[rows.length - 1];
const first = rows[0];
const growth = ((latest.total - first.total) / first.total) * 100;

const chartSVG = horizontalBarChart(
  rows.map((r) => ({ label: String(r.year), v: r.total, color: r.year === latest.year ? C.s2 : C.s1 })),
  { fmtTick: (v) => `$${(v / 1e9).toFixed(0)}B`, fmtVal: (v) => `$${(v / 1e9).toFixed(0)}B` }
);

const html = cardHTML({
  kicker: "Holiday shopping check",
  title: "How big is November retail — the Black Friday month?",
  hero: `$${(latest.total / 1e9).toFixed(0)}B`,
  heroLabel: `U.S. retail & food services sales, November ${latest.year}`,
  chartSVG, source: "U.S. Census Bureau, Advance Monthly Retail Trade Survey", vintage: String(latest.year),
});

const facebook = [
  "Black Friday kicks off the biggest retail month of the year — here's how big.",
  "",
  `Census Bureau data — U.S. retail & food services sales, seasonally adjusted, for November each year (the month that includes Black Friday).`,
  "",
  ...rows.map((r) => `${r.year}: $${(r.total / 1e9).toFixed(0)}B${r.nonstorePct != null ? ` (online/nonstore retailers: ${pct(r.nonstorePct)})` : ""}`),
  "",
  `${latest.year} vs. ${first.year}: November retail sales are up ${growth.toFixed(1)}% over ${years.length - 1} years.`,
  "",
  "Note: \"nonstore retailers\" is the Census category closest to online shopping, but it also includes catalog and vending sales; seasonally adjusted figures smooth typical November-vs-other-months swings so trend across years is comparable.",
  "",
  "Source: U.S. Census Bureau, Advance Monthly Sales for Retail and Food Services (MARTS).",
].filter(Boolean);

const lines = [
  `Holiday retail sales watch (${STAMP})`, "", "Census MARTS, November retail & food services sales, seasonally adjusted.", "",
  "Year | Total sales | Online/nonstore sales | Online share",
  "---:|---:|---:|---:",
  ...rows.map((r) => `${r.year} | ${money(r.total)} | ${r.nonstore != null ? money(r.nonstore) : "n/a"} | ${r.nonstorePct != null ? pct(r.nonstorePct) : "n/a"}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["year", "total_sales_usd", "nonstore_sales_usd", "nonstore_share_pct"],
  rows.map((r) => [r.year, r.total, r.nonstore ?? "", r.nonstorePct != null ? r.nonstorePct.toFixed(1) : ""])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
