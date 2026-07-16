#!/usr/bin/env node
// debt-foreign-holders-watch.mjs - which countries hold the most US Treasury
// debt. Treasury International Capital (TIC) System, "Major Foreign Holders
// of Treasury Securities" — published as a plain-text table, no API key,
// no registration.
//
// Run:  node scripts/debt-foreign-holders-watch.mjs
//       node scripts/debt-foreign-holders-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, fiscal, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const TIC_URL = "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt";

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function money(billions) {
  return `$${(billions / 1000).toFixed(2)}T`;
}

const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `debt-foreign-holders-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

console.log("  Fetching TIC major foreign holders table...");
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 20000);
let text;
try {
  const res = await fetch(TIC_URL, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (fiscal-data-toolkit)" } });
  if (!res.ok) throw new Error(`TIC data HTTP ${res.status}`);
  text = await res.text();
} finally {
  clearTimeout(timer);
}

const lines0 = text.split("\n").map((l) => l.trimEnd()).filter(Boolean);
const headerIdx = lines0.findIndex((l) => l.startsWith("Country\t"));
if (headerIdx === -1) throw new Error("Could not find the header row in the TIC table — its format may have changed");
const header = lines0[headerIdx].split("\t");
const months = header.slice(1); // e.g. ["2026-04", "2026-03", ...] newest first
const latestMonth = months[0];

// "Of Which: ..." rows are a breakdown of the official-sector SUBSET of the
// total, not additional holders — including them would double-count and can
// make a "top 10" sum exceed the grand total. "All Other" and "Grand Total"
// are aggregates, not individual holders, so they're excluded from the
// per-country ranking too (Grand Total is parsed separately, below).
const rows = lines0.slice(headerIdx + 1)
  .map((l) => l.split("\t"))
  .filter((c) => c.length >= 2 && c[0] && Number.isFinite(Number(c[1])))
  .map((c) => ({ country: c[0], billions: Number(c[1]) }))
  .filter((r) => !/^(grand total|total|all other|of which)/i.test(r.country));

if (!rows.length) throw new Error("No country rows parsed from the TIC table");

const grandTotalRow = lines0.slice(headerIdx + 1).map((l) => l.split("\t")).find((c) => /^grand total/i.test(c[0]));
const grandTotal = grandTotalRow ? Number(grandTotalRow[1]) : rows.reduce((s, r) => s + r.billions, 0);

const top10 = rows.slice().sort((a, b) => b.billions - a.billions).slice(0, 10);
const top10Sum = top10.reduce((s, r) => s + r.billions, 0);
const top10Share = (top10Sum / grandTotal) * 100;
const leader = top10[0];

const federalDebt = Number((await fiscal("/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1")).data[0].tot_pub_debt_out_amt);
const foreignShareOfDebt = (grandTotal * 1e9 / federalDebt) * 100;

const chartSVG = horizontalBarChart(
  top10.map((r, i) => ({ label: r.country, v: r.billions / 1000, color: i === 0 ? C.s2 : C.s1 })),
  { fmtTick: (v) => `$${v.toFixed(1)}T`, fmtVal: (v) => `$${v.toFixed(2)}T` }
);

const html = cardHTML({
  kicker: "Who owns US debt check",
  title: "Top 10 foreign holders of US Treasury securities",
  hero: money(leader.billions),
  heroLabel: `${leader.country} · ${latestMonth}`,
  chartSVG,
  source: "US Treasury, TIC System (Major Foreign Holders of Treasury Securities)",
  vintage: latestMonth,
});

const facebook = [
  "Who owns US debt check:",
  "",
  `As of ${latestMonth}, foreign countries and territories held about ${money(grandTotal)} of US Treasury debt — roughly ${foreignShareOfDebt.toFixed(0)}% of the entire $${(federalDebt / 1e12).toFixed(2)}T federal debt. That means about ${(100 - foreignShareOfDebt).toFixed(0)}% is held domestically — by the Federal Reserve, US banks, mutual funds, pension funds, state/local governments, and individual Americans.`,
  "",
  `Top holder: ${leader.country} at ${money(leader.billions)}.`,
  `Top 10 foreign holders: ${top10.map((r) => `${r.country} ${money(r.billions)}`).join(", ")}.`,
  `Those top 10 alone account for ${money(top10Sum)} — about ${top10Share.toFixed(0)}% of all foreign-held US debt.`,
  "",
  "Note: Treasury discloses holdings by the country where the custodial account is located, not necessarily the ultimate beneficial owner — this is why places like Belgium, Luxembourg, Ireland, and the Cayman Islands (financial-hub jurisdictions, not major economies) show up ranked highly.",
  "",
  "Real numbers, real source — US Treasury, TIC System:",
  "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Pages/index.aspx",
];

const lines = [
  `Who owns US debt check (${stamp})`,
  "",
  `Data through: ${latestMonth}`,
  `Total foreign holdings: ${money(grandTotal)} (${foreignShareOfDebt.toFixed(1)}% of $${(federalDebt / 1e12).toFixed(2)}T total federal debt)`,
  "",
  "Rank | Country | Holdings",
  "---:|---|---:",
  ...top10.map((r, i) => `${i + 1} | ${r.country} | ${money(r.billions)}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "country", "holdings_billions_usd"], top10.map((r, i) => [i + 1, r.country, r.billions])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
