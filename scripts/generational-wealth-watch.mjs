#!/usr/bin/env node
// Which generation owns America's wealth — Federal Reserve Distributional
// Financial Accounts (DFA), generation breakdown. Keyless: the Fed publishes
// the full dataset as a small CSV-in-ZIP bundle (no per-series FRED lookup
// exists for this cut, only for wealth percentile).
//
// Run:  node scripts/generational-wealth-watch.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, money, pct, rel } from "./lib/data-common.mjs";
import { readZipTextFiles } from "./lib/xlsx-lite.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `generational-wealth-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const GEN_ORDER = ["Silent", "BabyBoom", "GenX", "Millennial"];
const GEN_LABEL = {
  Silent: "Silent & earlier (born before 1946)",
  BabyBoom: "Baby Boomers (1946-1964)",
  GenX: "Gen X (1965-1980)",
  Millennial: "Millennial & Gen Z (born 1981+)",
};

const res = await fetch("https://www.federalreserve.gov/releases/z1/dataviz/download/zips/dfa.zip", {
  headers: { "User-Agent": "fiscal-data-toolkit/1.0" },
});
if (!res.ok) throw new Error(`Federal Reserve DFA download HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
const files = readZipTextFiles(buf);

function parseCSV(text) {
  const [header, ...rows] = text.trim().split("\n").map((l) => l.split(","));
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i]])));
}

const shareRows = parseCSV(files.get("dfa-generation-shares.csv"));
const levelRows = parseCSV(files.get("dfa-generation-levels.csv"));
const latestDate = shareRows[shareRows.length - 1].Date;

const rows = GEN_ORDER.map((gen) => {
  const shareRow = shareRows.filter((r) => r.Date === latestDate).find((r) => r.Category === gen);
  const levelRow = levelRows.filter((r) => r.Date === latestDate).find((r) => r.Category === gen);
  return {
    gen, label: GEN_LABEL[gen],
    sharePct: Number(shareRow["Net worth"]),
    dollars: Number(levelRow["Net worth"]) * 1e6, // millions -> dollars
  };
});

const boomer = rows.find((r) => r.gen === "BabyBoom");
const millennial = rows.find((r) => r.gen === "Millennial");
const totalDollars = rows.reduce((s, r) => s + r.dollars, 0);

const chartSVG = horizontalBarChart(
  rows.map((r) => ({ label: r.label, v: r.sharePct, color: r.gen === "BabyBoom" ? C.neg : r.gen === "Millennial" ? C.s2 : C.s1 })),
  { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => `${v.toFixed(1)}%` }
);

const html = cardHTML({
  kicker: "Generational wealth check",
  title: "Which generation owns America's wealth?",
  hero: `${boomer.sharePct.toFixed(1)}%`,
  heroLabel: `held by Baby Boomers · ${latestDate}`,
  chartSVG, source: "Federal Reserve Distributional Financial Accounts", vintage: latestDate,
});

const facebook = [
  `Baby Boomers are about 20% of the US population — and hold ${boomer.sharePct.toFixed(1)}% of all household wealth.`,
  "",
  `Federal Reserve data, ${latestDate} — share of total US household net worth (${money(totalDollars)}), by generation:`,
  "",
  ...rows.map((r) => `${r.label}: ${pct(r.sharePct)} (${money(r.dollars)})`),
  "",
  `Millennials and Gen Z together — a bigger population than Boomers — hold just ${millennial.sharePct.toFixed(1)}%.`,
  "",
  "Note: the Fed's generation categories lump Gen Z in with Millennials (anyone born 1981 or later) — there's no separate Gen Z breakout in this dataset. This is total net worth (assets minus debts) held by everyone currently alive in each generation, not a claim about what any individual owns, and it's shifting every quarter as Boomers age, spend down savings, and pass wealth on.",
  "",
  "Source: Federal Reserve Distributional Financial Accounts.",
].filter(Boolean);

const lines = [
  `Generational wealth watch (${STAMP})`, "", `Federal Reserve DFA, generation net-worth shares, ${latestDate}.`, "",
  "Generation | Share of net worth | Dollar amount",
  "---|---:|---:",
  ...rows.map((r) => `${r.label} | ${pct(r.sharePct)} | ${money(r.dollars)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["generation", "share_pct", "dollars", "date"], rows.map((r) => [r.gen, r.sharePct, r.dollars, latestDate])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
