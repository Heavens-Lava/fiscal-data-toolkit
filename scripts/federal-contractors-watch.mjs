#!/usr/bin/env node
// federal-contractors-watch.mjs - which companies get the most federal
// contract money, and how concentrated that spending is. USASpending.gov.
// No API key required.
//
// Run:  node scripts/federal-contractors-watch.mjs
//       node scripts/federal-contractors-watch.mjs 2024
//       node scripts/federal-contractors-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const BASE = "https://api.usaspending.gov/api/v2";
const HDR = { "User-Agent": "fiscal-data-toolkit/1.0", "Content-Type": "application/json" };
const CONTRACT_TYPES = ["A", "B", "C", "D"]; // definitive/BPA/delivery/purchase order contracts

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function money(n) {
  const v = Number(n);
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function cleanName(name) {
  return String(name)
    .replace(/,?\s*(INC|LLC|CORP|CORPORATION|CO|LTD|LP|LLP)\.?$/i, "")
    .trim();
}

async function post(pathq, body) {
  const res = await fetch(`${BASE}${pathq}`, { method: "POST", headers: HDR, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`USASpending API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const argv = process.argv.slice(2);
const now = new Date();
const FY = parseInt(argv.find((a) => /^\d{4}$/.test(a)) ?? (now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1));
const noImage = argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `federal-contractors-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const timeFilt = [{ start_date: `${FY - 1}-10-01`, end_date: `${FY}-09-30` }];

console.log(`  Fetching top federal contractors for FY${FY}...`);
const [recipientData, totalData] = await Promise.all([
  post("/search/spending_by_category/recipient/", {
    filters: { time_period: timeFilt, award_type_codes: CONTRACT_TYPES },
    limit: 10,
  }),
  post("/search/spending_over_time/", {
    filters: { time_period: timeFilt, award_type_codes: CONTRACT_TYPES },
    group: "fiscal_year",
  }),
]);

const rows = (recipientData.results || []).map((r) => ({ name: cleanName(r.name || r.recipient_name || "?"), amount: r.amount || 0 }));
if (!rows.length) throw new Error(`No contractor data returned for FY${FY}`);

// USASpending's "recipient" category is per legal entity, not consolidated
// by parent company — the same corporate group can show up more than once
// under different subsidiary names (e.g. a defense prime and its own
// shipyard subsidiary), which understates true parent-company concentration.
// Flag any display name that repeats so that's visible rather than silent.
const nameCounts = new Map();
for (const r of rows) nameCounts.set(r.name, (nameCounts.get(r.name) || 0) + 1);
const hasDuplicateNames = [...nameCounts.values()].some((c) => c > 1);

const totalContractSpending = (totalData.results || []).reduce((s, r) => s + (r.aggregated_amount || 0), 0);
const top10Sum = rows.reduce((s, r) => s + r.amount, 0);
const top10Share = totalContractSpending ? (top10Sum / totalContractSpending) * 100 : null;
const leader = rows[0];

const chartSVG = horizontalBarChart(
  rows.map((r, i) => ({ label: r.name, v: r.amount / 1e9, color: i === 0 ? C.s2 : C.s1 })),
  { fmtTick: (v) => `$${v.toFixed(0)}B`, fmtVal: (v) => `$${v.toFixed(1)}B` }
);

const html = cardHTML({
  kicker: "Federal contractors check",
  title: `Top 10 federal contractors, FY${FY}`,
  hero: money(leader.amount),
  heroLabel: `${leader.name} · FY${FY}`,
  chartSVG,
  source: "USASpending.gov",
  vintage: `FY${FY}`,
});

const facebook = [
  `The single biggest federal contractor in FY${FY}: ${leader.name}, with ${money(leader.amount)} in contract awards.`,
  "",
  `Top 10 federal contractors: ${rows.map((r) => `${r.name} ${money(r.amount)}`).join(", ")}.`,
  `Combined, those 10 entries received ${money(top10Sum)}${top10Share != null ? ` — about ${top10Share.toFixed(0)}% of all ${money(totalContractSpending)} in federal contract spending that fiscal year` : ""}.`,
  "",
  `Important: USASpending tracks money by legal entity, not consolidated parent company — so this list can understate true concentration.${hasDuplicateNames ? " In this run, one company's name appears more than once (different subsidiaries of the same corporate group, awarded separately)." : ""} A well-known example not always obvious from the names alone: Raytheon Company and RTX are the same corporate parent (RTX Corporation), reporting as separate recipients.`,
  "",
  "This covers contracts only (goods and services the government buys) — not grants, loans, or direct payments like Social Security and Medicare, which go to individuals and different kinds of organizations entirely.",
  "",
  "Real numbers, real source — USASpending.gov:",
  "https://www.usaspending.gov/search",
];

const lines = [
  `Federal contractors check (${stamp})`,
  "",
  `Fiscal year: FY${FY} | Total contract spending: ${totalContractSpending ? money(totalContractSpending) : "n/a"}`,
  "",
  "Rank | Contractor | Amount | Share of Total",
  "---:|---|---:|---:",
  ...rows.map((r, i) => `${i + 1} | ${r.name} | ${money(r.amount)} | ${totalContractSpending ? ((r.amount / totalContractSpending) * 100).toFixed(1) + "%" : "n/a"}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "contractor", "amount"], rows.map((r, i) => [i + 1, r.name, r.amount])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
