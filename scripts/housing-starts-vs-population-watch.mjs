#!/usr/bin/env node
// housing-starts-vs-population-watch.mjs — how many new housing units get
// started for every new resident, by decade? New privately-owned housing
// units started (Census/HUD, HOUST, monthly seasonally-adjusted annual
// rate) summed into cumulative decade totals, against total population
// growth over the same span (POPTHM) -- both via FRED, no key required.
//
// Run:  node scripts/housing-starts-vs-population-watch.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, fred, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, rel } from "./lib/data-common.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `housing-starts-vs-population-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const [houst, pop] = await Promise.all([fred("HOUST"), fred("POPTHM")]);
const popByDate = new Map(pop.map((r) => [r.d, r.v]));

function windowStat(startYear, endYear, label) {
  const rows = houst.filter((r) => r.d >= `${startYear}-01-01` && r.d <= `${endYear}-12-01`);
  const expectedMonths = (Number(endYear) - Number(startYear) + 1) * 12;
  if (rows.length < expectedMonths) return null; // only compare full, equal-length 10-year windows
  const cumStarts = rows.reduce((sum, r) => sum + r.v / 12, 0); // SAAR -> actual units/month
  const popStart = popByDate.get(`${startYear}-01-01`);
  const popEnd = popByDate.get(`${endYear}-12-01`);
  if (!popStart || !popEnd) return null;
  const growth = popEnd - popStart;
  return { label, startYear, endYear, cumStarts, growth, ratio: cumStarts / growth, months: rows.length };
}

// Most recent COMPLETE 10-year window (not a partial current decade -- comparing
// a 6-year 2020s-so-far stub against full 10-year decades would mechanically
// skew the ratio, since 2020-2025 population growth was unusually slow).
const latestFullYear = Number(houst[houst.length - 1].d.slice(0, 4)) - (houst[houst.length - 1].d.slice(5, 7) === "12" ? 0 : 1);
const recentStart = String(latestFullYear - 9);
const DECADES = [
  ["1980", "1989", "1980s"], ["1990", "1999", "1990s"], ["2000", "2009", "2000s"], ["2010", "2019", "2010s"],
  [recentStart, String(latestFullYear), `${recentStart}-${latestFullYear}`],
];
const rows = DECADES.map(([s, e, label]) => windowStat(s, e, label)).filter(Boolean);
if (rows.length < 2) throw new Error("Not enough full 10-year windows with complete FRED data to compare.");

const latest = rows[rows.length - 1];
const lowestRow = rows.reduce((a, b) => (a.ratio < b.ratio ? a : b));
const highestRow = rows.reduce((a, b) => (a.ratio > b.ratio ? a : b));

const chartSVG = horizontalBarChart(
  rows.map((r) => ({ label: r.label, v: r.ratio, color: r === latest ? C.neg : C.s1 })),
  { fmtTick: (v) => v.toFixed(1), fmtVal: (v) => v.toFixed(2) }
);

const html = cardHTML({
  kicker: "Housing construction vs. population check",
  title: "New housing units started per new resident, by 10-year window",
  hero: latest.ratio.toFixed(2),
  heroLabel: `housing units started per new resident, ${latest.label}`,
  chartSVG, source: "U.S. Census Bureau/HUD (HOUST) & Census population estimates (POPTHM), via FRED", vintage: latest.endYear,
});

const facebook = [
  `From ${latest.label}, about ${latest.ratio.toFixed(2)} new housing units were started for every new resident added to the U.S. population -- the ${latest.ratio === highestRow.ratio ? "highest" : latest.ratio === lowestRow.ratio ? "lowest" : "middle"} of the last five comparable 10-year windows. The low point was the ${lowestRow.label}, at ${lowestRow.ratio.toFixed(2)} units per new resident.`,
  "",
  "Method: monthly new privately-owned housing units started (seasonally-adjusted annual rate, divided by 12 and summed across each 10-year window) versus the change in total U.S. population over the same span. All windows are full, equal-length 10-year spans -- no partial-decade stub is compared against a complete one.",
  "",
  ...rows.map((r) => `${r.label}: ${r.ratio.toFixed(2)} units per new resident (${Math.round(r.cumStarts).toLocaleString()}k units started, ${Math.round(r.growth).toLocaleString()}k population growth)`),
  "",
  "This counts housing units started, not completed or occupied, and doesn't distinguish single-family from multifamily construction, second homes, or units lost to demolition -- and it says nothing about where that construction happened relative to where the population grew.",
  "",
  "Sources: U.S. Census Bureau/HUD New Privately-Owned Housing Units Started (HOUST); U.S. Census Bureau population estimates (POPTHM); both via FRED.",
];

const lines = [
  `Housing starts vs. population watch (${STAMP})`, "",
  "Decade | Units started (thousands) | Population growth (thousands) | Units per new resident",
  "---|---:|---:|---:",
  ...rows.map((r) => `${r.label} | ${Math.round(r.cumStarts).toLocaleString()} | ${Math.round(r.growth).toLocaleString()} | ${r.ratio.toFixed(3)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["decade", "units_started_thousands", "population_growth_thousands", "units_per_new_resident"],
  rows.map((r) => [r.label, r.cumStarts.toFixed(0), r.growth.toFixed(0), r.ratio.toFixed(4)])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
