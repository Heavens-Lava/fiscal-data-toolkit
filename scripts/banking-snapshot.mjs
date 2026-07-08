#!/usr/bin/env node
// banking-snapshot.mjs — pull U.S. banking-sector totals from the FDIC API
// (no API key required), print a clean snapshot of all FDIC-insured
// institutions, and rank the biggest banks by total assets to show how
// concentrated the sector is.
//
// Run:  node scripts/banking-snapshot.mjs
//       node scripts/banking-snapshot.mjs --no-image
// Data source: https://banks.data.fdic.gov/  (api.fdic.gov/banks)
// Note: FDIC dollar figures are reported in THOUSANDS; we convert to dollars.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const BASE = "https://api.fdic.gov/banks";

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function money(n) {
  const v = Number(n);
  const s = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${a.toLocaleString("en-US")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function cleanBankName(name) {
  return String(name)
    .replace(/ NATIONAL ASSN$/, "")
    .replace(/ NATIONAL ASSOCIATION$/, "")
    .replace(/ BANK NA$/, " Bank")
    .trim();
}

const noImage = process.argv.includes("--no-image");
const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, `banking-snapshot-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

// 1) Find the latest reporting quarter (REPDTE, e.g. 20260331)
const latest = (await getJSON(
  `${BASE}/financials?fields=REPDTE&sort_by=REPDTE&sort_order=DESC&limit=1&format=json`
)).data[0].data.REPDTE;

// 2) Pull every bank's key figures for that quarter (one call covers all ~4,400)
const rows = (await getJSON(
  `${BASE}/financials?filters=REPDTE:${latest}` +
    `&fields=ASSET,DEP,SC,EQ,NETINC&limit=10000&format=json`
)).data;

// FDIC values are in $thousands -> multiply by 1,000 for dollars
const sum = (k) => rows.reduce((s, r) => s + (Number(r.data[k]) || 0), 0) * 1000;
const banks = rows.length;
const assets = sum("ASSET");
const deposits = sum("DEP");
const securities = sum("SC"); // mostly Treasuries + gov't-backed mortgage bonds
const equity = sum("EQ");
const netIncome = sum("NETINC"); // for the quarter

const q = `${latest.slice(0, 4)}-Q${Math.ceil(Number(latest.slice(4, 6)) / 3)}`;

// 3) Top 10 banks by total assets, for the concentration story
const topRows = (await getJSON(
  `${BASE}/financials?filters=REPDTE:${latest}` +
    `&fields=NAME,CITY,STALP,ASSET,SC&sort_by=ASSET&sort_order=DESC&limit=10&format=json`
)).data.map((r) => ({
  name: cleanBankName(r.data.NAME),
  city: r.data.CITY,
  state: r.data.STALP,
  assets: Number(r.data.ASSET) * 1000,
  securities: Number(r.data.SC) * 1000,
}));

const top4Sum = topRows.slice(0, 4).reduce((s, r) => s + r.assets, 0);
const top10Sum = topRows.reduce((s, r) => s + r.assets, 0);
const leader = topRows[0];
const leaderShare = (leader.assets / assets) * 100;
const top4Share = (top4Sum / assets) * 100;
const top10Share = (top10Sum / assets) * 100;

console.log("\n  U.S. BANKING SECTOR SNAPSHOT");
console.log("  (source: FDIC API — all FDIC-insured institutions, no key required)\n");
console.log(`  Reporting quarter .......... ${q}  (${banks.toLocaleString()} banks)`);
console.log(`  Total assets ............... ${money(assets)}`);
console.log(`  Total deposits (funding) ... ${money(deposits)}   (${(deposits / assets * 100).toFixed(0)}% of assets)`);
console.log(`  Securities held ............ ${money(securities)}   (${(securities / assets * 100).toFixed(0)}% of assets)`);
console.log(`    └ mostly U.S. Treasuries & gov't-backed mortgage bonds`);
console.log(`  Equity capital (cushion) ... ${money(equity)}   (${(equity / assets * 100).toFixed(1)}% of assets)`);
console.log(`  Net income (this quarter) .. ${money(netIncome)}`);
console.log("");
console.log("  How banks make money (the spread):");
console.log("    They pay low interest on DEPOSITS and earn higher interest on");
console.log("    LOANS + SECURITIES. The gap (net interest margin) is the profit.");
console.log("");
console.log(`  Which bank holds the most? (${q}, by assets)`);
console.log("  Rank  Bank                          Assets    Securities held");
topRows.forEach((r, i) => {
  console.log(`  ${String(i + 1).padStart(2)}    ${r.name.padEnd(28)}  ${money(r.assets).padStart(7)}  ${money(r.securities).padStart(7)}`);
});
console.log("");
console.log(`  ${leader.name} is #1 — ${money(leader.assets)}, about ${leaderShare.toFixed(0)}% of all U.S. bank assets in one institution.`);
console.log(`  Top 4 banks ≈ ${money(top4Sum)} = ~${Math.round(top4Share)}% of the entire sector.`);
console.log(`  Top 10 banks ≈ ${money(top10Sum)} = ~${Math.round(top10Share)}% — more than half.`);
console.log(`  The other ~${(banks - 10).toLocaleString()} banks split the remaining ~${Math.round(100 - top10Share)}%.`);
console.log("");

const chartSVG = horizontalBarChart(
  topRows.map((r, i) => ({
    label: r.name.length > 28 ? `${r.name.slice(0, 25)}...` : r.name,
    v: r.assets / 1e12,
    color: i === 0 ? C.s2 : C.s1,
  })),
  { fmtTick: (v) => `$${v.toFixed(1)}T`, fmtVal: (v) => `$${v.toFixed(2)}T` }
);

const html = cardHTML({
  kicker: "Banking concentration check",
  title: "Which banks hold the most of the U.S. banking system?",
  hero: `${Math.round(top10Share)}%`,
  heroLabel: `of all bank assets held by the top 10 · ${q}`,
  chartSVG,
  source: "FDIC BankFind financials",
  vintage: q,
});

const facebook = [
  "Banking concentration check:",
  "",
  `As of ${q}, ${banks.toLocaleString()} FDIC-insured banks held ${money(assets)} in total assets. ${leader.name} (${leader.city}, ${leader.state}) is #1 by itself, with ${money(leader.assets)} — about ${leaderShare.toFixed(0)}% of the entire sector in one institution.`,
  "",
  `The concentration is the real story: the top 4 banks hold about ${money(top4Sum)} (~${Math.round(top4Share)}% of the sector). The top 10 hold about ${money(top10Sum)} (~${Math.round(top10Share)}%) — more than half. The other ~${(banks - 10).toLocaleString()} FDIC-insured banks split the remaining ~${Math.round(100 - top10Share)}%.`,
  "",
  `For scale: the whole sector holds ${money(deposits)} in deposits (${(deposits / assets * 100).toFixed(0)}% of assets) and ${money(securities)} in securities — mostly Treasuries and government-backed mortgage bonds — against ${money(equity)} of equity capital (${(equity / assets * 100).toFixed(1)}% of assets) as a loss-absorbing cushion.`,
  "",
  "Real numbers, real source — FDIC BankFind financials:",
  "https://banks.data.fdic.gov/docs/",
];

const lines = [
  `Banking concentration check (${stamp})`,
  "",
  `Reporting quarter: ${q} (${banks.toLocaleString()} banks)`,
  `Total assets: ${money(assets)}`,
  `Total deposits: ${money(deposits)} (${(deposits / assets * 100).toFixed(0)}% of assets)`,
  `Securities held: ${money(securities)} (${(securities / assets * 100).toFixed(0)}% of assets)`,
  `Equity capital: ${money(equity)} (${(equity / assets * 100).toFixed(1)}% of assets)`,
  `Net income (quarter): ${money(netIncome)}`,
  "",
  "Rank | Bank | City, State | Assets | Securities held",
  "---:|---|---|---:|---:",
  ...topRows.map((r, i) => `${i + 1} | ${r.name} | ${r.city}, ${r.state} | ${money(r.assets)} | ${money(r.securities)}`),
  "",
  `Top 4 banks: ${money(top4Sum)} (~${Math.round(top4Share)}% of sector)`,
  `Top 10 banks: ${money(top10Sum)} (~${Math.round(top10Share)}% of sector)`,
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "bank", "city", "state", "assets", "securities_held"],
  topRows.map((r, i) => [i + 1, r.name, r.city, r.state, r.assets, r.securities])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`  Files: ${files.join(" / ")}`);
