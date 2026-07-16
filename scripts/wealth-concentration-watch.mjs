#!/usr/bin/env node
// wealth-concentration-watch.mjs - who actually owns US household wealth, by
// wealth percentile group. Federal Reserve Distributional Financial Accounts
// (DFA), mirrored on FRED — no API key required.
//
// Run:  node scripts/wealth-concentration-watch.mjs
//       node scripts/wealth-concentration-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, fred, horizontalBarChart, last, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

const GROUPS = [
  { id: "WFRBST01134", label: "Top 1% (99th-100th pctile)" },
  { id: "WFRBSN09161", label: "Next 9% (90th-99th pctile)" },
  { id: "WFRBSN40188", label: "Next 40% (50th-90th pctile)" },
  { id: "WFRBSB50215", label: "Bottom 50%" },
];

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function money(n) {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `wealth-concentration-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

console.log("  Fetching wealth-share data for 4 percentile groups + total net worth...");
const [groupSeries, totalRows] = await Promise.all([
  Promise.all(GROUPS.map((g) => fred(g.id))),
  fred("TNWBSHNO"),
]);

const total = last(totalRows);
const totalDollars = total.v * 1e6; // FRED reports in millions

const rows = GROUPS.map((g, i) => {
  const latest = last(groupSeries[i]);
  return { ...g, pct: latest.v, date: latest.d, dollars: (latest.v / 100) * totalDollars };
});

const vintage = rows[0].date;
const top1 = rows[0];
const bottom50 = rows[rows.length - 1];
const shareSum = rows.reduce((s, r) => s + r.pct, 0);

const chartSVG = horizontalBarChart(
  rows.map((r, i) => ({ label: r.label, v: r.pct, color: i === 0 ? C.neg : i === rows.length - 1 ? C.s2 : C.s1 })),
  { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => `${v.toFixed(1)}%` }
);

const html = cardHTML({
  kicker: "Wealth concentration check",
  title: "Who owns US household wealth, by percentile group",
  hero: `${top1.pct.toFixed(1)}%`,
  heroLabel: `held by the top 1% · ${vintage}`,
  chartSVG,
  source: "Federal Reserve Distributional Financial Accounts",
  vintage,
});

const facebook = [
  "How is U.S. household wealth divided?",
  "",
  `As of ${vintage}, total U.S. household net worth was ${money(totalDollars)}.`,
  "",
  ...rows.map((r) => `• ${r.label}: ${r.pct.toFixed(1)}% (${money(r.dollars)})`),
  "",
  `The top 10% together hold ${(rows[0].pct + rows[1].pct).toFixed(1)}% of household net worth. The bottom 50% hold ${bottom50.pct.toFixed(1)}%.`,
  `The top 1% alone holds about ${(top1.pct / bottom50.pct).toFixed(0)} times the wealth of the entire bottom half combined.`,
  "",
  "Important: wealth means assets minus debts. It is not annual income. These are Federal Reserve distributional estimates, not a census of every household.",
  "",
  "Which factor should the next post break down: homeownership, stocks, debt, or age?",
  "",
  "Follow for more public-data breakdowns, and share this if you think more people should see the full distribution.",
  "",
  "Source: Federal Reserve Distributional Financial Accounts:",
  "https://www.federalreserve.gov/releases/efa/efa-distributional-financial-accounts.htm",
];

const lines = [
  `Wealth concentration check (${stamp})`,
  "",
  `Total US household net worth: ${money(totalDollars)} (${vintage})`,
  `Sum of shares: ${shareSum.toFixed(1)}% (should be ~100%, small gap is FRED rounding)`,
  "",
  "Group | Share of Net Worth | Dollar Amount",
  "---|---:|---:",
  ...rows.map((r) => `${r.label} | ${r.pct.toFixed(1)}% | ${money(r.dollars)}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["group", "share_pct", "dollars", "date"], rows.map((r) => [r.label, r.pct, r.dollars, r.date])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
