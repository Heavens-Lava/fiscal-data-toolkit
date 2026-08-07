#!/usr/bin/env node
// Where have home prices risen the most since the pandemic housing boom
// began — FHFA House Price Index, purchase-only, by state. Keyless: FHFA
// publishes the full master file as a public CSV.
//
// Run:  node scripts/home-prices-since-2020-watch.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, pct, rel } from "./lib/data-common.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `home-prices-since-2020-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const BASE_YEAR = 2020, BASE_QTR = 1;

const res = await fetch("https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv", {
  headers: { "User-Agent": "fiscal-data-toolkit/1.0" },
});
if (!res.ok) throw new Error(`FHFA HPI HTTP ${res.status}`);
const text = await res.text();
const [header, ...csvLines] = text.trim().split("\n");
const cols = header.split(",");
const idx = Object.fromEntries(cols.map((c, i) => [c, i]));

const stateRows = csvLines
  .map((l) => l.split(","))
  .filter((r) => r[idx.hpi_type] === "traditional" && r[idx.hpi_flavor] === "purchase-only" &&
    r[idx.frequency] === "quarterly" && r[idx.level] === "State");

const byState = new Map();
for (const r of stateRows) {
  const state = r[idx.place_name];
  const abbr = r[idx.place_id];
  const yr = Number(r[idx.yr]);
  const qtr = Number(r[idx.period]);
  const value = Number(r[idx.index_nsa]);
  if (!Number.isFinite(value)) continue;
  const entry = byState.get(state) || { state, abbr, points: [] };
  entry.points.push({ yr, qtr, value });
  byState.set(state, entry);
}

const rows = [...byState.values()].map((e) => {
  const base = e.points.find((p) => p.yr === BASE_YEAR && p.qtr === BASE_QTR);
  const latest = e.points.reduce((a, b) => (b.yr > a.yr || (b.yr === a.yr && b.qtr > a.qtr) ? b : a), e.points[0]);
  if (!base || !latest) return null;
  return { state: e.state, abbr: e.abbr, base: base.value, latest: latest.value, latestYr: latest.yr, latestQtr: latest.qtr, changePct: (latest.value / base.value - 1) * 100 };
}).filter(Boolean).sort((a, b) => b.changePct - a.changePct).map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error("No FHFA state HPI rows parsed.");

const latestLabel = `${rows[0].latestYr} Q${rows[0].latestQtr}`;
const top = rows.slice(0, 8);
const bottom = rows.slice(-4).reverse();

const chartSVG = horizontalBarChart(
  top.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.changePct, color: C.s1 })),
  { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => `+${v.toFixed(0)}%` }
);

const html = cardHTML({
  kicker: "Home price check",
  title: "Where have home prices risen the most since 2020?",
  hero: `+${top[0].changePct.toFixed(0)}%`,
  heroLabel: `${top[0].state}; home price index change, Q1 2020 to ${latestLabel}`,
  chartSVG, source: "Federal Housing Finance Agency, House Price Index", vintage: latestLabel,
});

const facebook = [
  `Home prices are up more than half in some states since the pandemic housing boom started — here's where it's worst.`,
  "",
  `FHFA House Price Index, purchase-only — % change from Q1 2020 to ${latestLabel}, by state:`,
  "",
  "Risen the most:", ...top.map((r) => `#${r.rank} ${r.state}: +${r.changePct.toFixed(0)}%`), "",
  "Risen the least:", ...bottom.map((r) => `#${r.rank} ${r.state}: +${r.changePct.toFixed(0)}%`), "",
  "This is an index of repeat sales and refinance appraisals on the same homes over time, not a median sale price — it measures how much more expensive it is to buy the same house, not what the \"typical\" home costs in dollars. Every state is still positive: no state's home price index has fallen since Q1 2020.",
  "",
  "Source: Federal Housing Finance Agency, House Price Index (purchase-only, state, not seasonally adjusted).",
].filter(Boolean);

const lines = [
  `Home prices since 2020 (${STAMP})`, "", `FHFA HPI, purchase-only, Q1 2020 to ${latestLabel}.`, "",
  "Rank | State | % change since Q1 2020",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | +${r.changePct.toFixed(1)}%`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "base_index_2020q1", "latest_index", "latest_period", "change_pct"], rows.map((r) => [r.rank, r.state, r.base, r.latest, latestLabel, r.changePct.toFixed(1)])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
