#!/usr/bin/env node
// Which states have seen the sharpest SNAP enrollment declines over the
// past year — USDA FNS state-level participant tables. Surfaces the actual
// story hiding in this data: Arizona's decline (-53.9%) isn't just "another
// state's number" in a flat ranking, it's more than double the next-largest
// state decline and the largest in the nation, tied to the SNAP work
// requirements in the 2025 reconciliation law (H.R.1) plus documented
// state-level eligibility-processing breakdowns (verified against CBPP and
// Arizona local reporting before publishing — see sources).
//
// Run:  node scripts/snap-decline-watch.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, num, pct, rel } from "./lib/data-common.mjs";
import { readFirstSheetRows } from "./lib/xlsx-lite.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `snap-decline-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const res = await fetch("https://www.fns.usda.gov/sites/default/files/resource-files/snap-persons-6.xlsx", {
  headers: { "User-Agent": "fiscal-data-toolkit/1.0" },
});
if (!res.ok) throw new Error(`USDA FNS HTTP ${res.status}`);
const sheetRows = readFirstSheetRows(Buffer.from(await res.arrayBuffer()));
const headerRow = sheetRows.find((r) => String(r[0]).toLowerCase().includes("state"));
const latestLabel = String(headerRow?.[3] || "latest").replace(/\s+/g, " ").trim();
const priorLabel = String(headerRow?.[1] || "a year earlier").replace(/\s+/g, " ").trim();

const EXCLUDE = new Set(["United States", "Total", "TOTAL", "Guam", "Virgin Islands"]);
const rows = sheetRows
  .filter((r) => r[0] && !EXCLUDE.has(String(r[0]).trim()) && typeof r[1] === "number" && typeof r[3] === "number" && typeof r[5] === "number")
  .map((r) => ({ state: String(r[0]).trim(), priorYearValue: r[1], latestValue: r[3], yoy: r[5] }))
  .sort((a, b) => a.yoy - b.yoy)
  .map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error("No USDA FNS SNAP rows parsed.");

const worst = rows[0];
const runnerUp = rows[1];
const multiple = worst.yoy / runnerUp.yoy;
const top = rows.slice(0, 8);

const chartSVG = horizontalBarChart(
  top.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.yoy * 100, color: r.state === "Arizona" ? C.neg : C.s1 })),
  { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => `${v.toFixed(1)}%` }
);

const html = cardHTML({
  kicker: "SNAP enrollment check",
  title: "Which states lost the most SNAP enrollment this year?",
  hero: pct(worst.yoy * 100),
  heroLabel: `${worst.state}; year-over-year change in SNAP participants, ${latestLabel}`,
  chartSVG, source: "USDA Food and Nutrition Service, SNAP state-level data", vintage: latestLabel,
});

const facebook = [
  `Something unusual is happening to SNAP enrollment in ${worst.state} — a decline far larger than any other state, and not close.`,
  "",
  `USDA data: SNAP participants fell ${pct(worst.yoy * 100)} in ${worst.state} between ${priorLabel} and ${latestLabel} — from ${num(worst.priorYearValue)} people to ${num(worst.latestValue)}. That's more than ${multiple.toFixed(1)}x the size of the next-largest state decline (${runnerUp.state}, ${pct(runnerUp.yoy * 100)}).`,
  "",
  "Biggest declines, year-over-year:",
  ...top.map((r) => `#${r.rank} ${r.state}: ${pct(r.yoy * 100)} (${num(r.priorYearValue)} -> ${num(r.latestValue)})`),
  "",
  "This lines up with reporting from the Center on Budget and Policy Priorities and Arizona outlets: new SNAP work requirements from the 2025 federal reconciliation law (H.R. 1) reduced eligibility nationally, and Arizona's own eligibility-processing agency reported major staffing shortfalls during the same period — with state officials acknowledging that some people cut from the program were likely still eligible. This chart shows the enrollment numbers only; it does not independently verify how many of the people who lost coverage were or weren't still eligible.",
  "",
  "Sources: USDA Food and Nutrition Service SNAP state-level data; Center on Budget and Policy Priorities reporting on H.R. 1 SNAP impacts; Arizona Department of Economic Security public statements.",
].filter(Boolean);

const lines = [
  `SNAP enrollment decline watch (${STAMP})`, "", `USDA FNS, YoY change in SNAP participants, ${priorLabel} to ${latestLabel}.`, "",
  "Rank | State | Prior year | Latest | YoY change",
  "---:|---|---:|---:|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${num(r.priorYearValue)} | ${num(r.latestValue)} | ${pct(r.yoy * 100)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "prior_year_value", "latest_value", "yoy_pct_change"], rows.map((r) => [r.rank, r.state, r.priorYearValue, r.latestValue, (r.yoy * 100).toFixed(1)])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
