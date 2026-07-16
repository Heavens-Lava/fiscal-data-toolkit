#!/usr/bin/env node
// State population and year-over-year growth, from Census PEP (Population
// Estimates Program). Note: Census restructured this API — the old simple
// "pep/population" endpoint stops at vintage 2021; current vintages are
// served from "pep/charv" (normally a detailed age/sex/race breakdown), but
// querying it with NO demographic filters returns the default total rows.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, fred, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, argValue, envValue, num, pct, rel } from "./lib/data-common.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const view = String(argValue("--view", "total")).toLowerCase();
if (!["total", "growth"].includes(view)) throw new Error("--view must be total or growth.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-population-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

let vintage, raw;
for (const candidate of [2023, 2022, 2021]) {
  try {
    const res = await fetch(`https://api.census.gov/data/${candidate}/pep/charv?get=NAME,POP,YEAR,MONTH&for=state:*&key=${key}`);
    if (!res.ok) continue;
    raw = await res.json();
    if (raw?.length > 1) { vintage = candidate; break; }
  } catch { /* try prior vintage */ }
}
if (!vintage) throw new Error("No Census PEP state population vintage available.");

const [header, ...body] = raw;
const idx = Object.fromEntries(header.map((n, i) => [n, i]));
const julyRows = body.filter((r) => r[idx.MONTH] === "7" && r[idx.state] !== "72");
const byState = new Map();
for (const r of julyRows) {
  const name = r[idx.NAME];
  const entry = byState.get(name) || {};
  entry[r[idx.YEAR]] = Number(r[idx.POP]);
  byState.set(name, entry);
}
const years = [...new Set(julyRows.map((r) => r[idx.YEAR]))].sort();
const latestYear = years.at(-1), priorYear = years.at(-2);

const rows = [...byState.entries()]
  .map(([state, byYear]) => ({ state, pop: byYear[latestYear], priorPop: byYear[priorYear] }))
  .filter((r) => Number.isFinite(r.pop) && Number.isFinite(r.priorPop))
  .map((r) => ({ ...r, growthPct: ((r.pop - r.priorPop) / r.priorPop) * 100 }));
if (!rows.length) throw new Error("No matched Census PEP state population rows.");

const ranked = [...rows]
  .sort((a, b) => (view === "growth" ? b.growthPct - a.growthPct : b.pop - a.pop))
  .map((r, i) => ({ ...r, rank: i + 1 }));
const stateBreakdownTotal = rows.reduce((s, r) => s + r.pop, 0);
const az = ranked.find((r) => r.state === "Arizona");
const top = ranked.slice(0, 10);

// FRED's national monthly total (POPTHM) runs well ahead of the detailed
// state-by-state PEP breakdown above — use it for the current national
// headline, but keep the state breakdown honestly labeled at its own vintage.
const popSeries = view === "total" ? await fred("POPTHM") : null;
const currentNational = popSeries?.at(-1);

const chartSVG = horizontalBarChart(
  top.map((r) => ({ label: `#${r.rank} ${r.state}`, v: view === "growth" ? r.growthPct : r.pop, color: r.state === "Arizona" ? C.s2 : C.s1 })),
  view === "growth"
    ? { fmtTick: (v) => `${v.toFixed(1)}%`, fmtVal: (v) => pct(v) }
    : { fmtTick: (v) => `${(v / 1e6).toFixed(0)}M`, fmtVal: (v) => `${num(v)}` }
);

const html = cardHTML({
  kicker: "Population check",
  title: view === "growth" ? "Which states are growing the fastest?" : "Where do Americans actually live?",
  hero: view === "growth" ? pct(top[0].growthPct) : `${(top[0].pop / 1e6).toFixed(1)}M`,
  heroLabel: `${top[0].state}; ${view === "growth" ? `population growth, ${priorYear}–${latestYear}` : `population, July ${latestYear}`}`,
  chartSVG, source: "U.S. Census Bureau Population Estimates Program", vintage: `${latestYear} (vintage ${vintage})`,
});

const facebook = view === "growth" ? [
  "Which states are growing the fastest?",
  "",
  `Census population estimates, ${priorYear} to ${latestYear} (most recent year-over-year change available).`,
  "",
  "Fastest growing:", ...top.map((r) => `#${r.rank} ${r.state}: ${pct(r.growthPct)} (${num(r.priorPop)} → ${num(r.pop)})`), "",
  az ? `Arizona: #${az.rank} of ${ranked.length}, ${pct(az.growthPct)}.` : "",
  "",
  "Note: this is one year of change, not a long-term trend — a state can have an unusually high or low year. Growth includes both natural increase (births minus deaths) and net migration.",
  "",
  "Source: U.S. Census Bureau, Population Estimates Program.",
].filter(Boolean) : [
  `America's population has passed ${Math.floor(currentNational.v / 1e3)} million. Where do people actually live?`,
  "",
  `FRED/Census national estimate for ${currentNational.d.slice(0, 7)}: ${(currentNational.v / 1e3).toFixed(1)} million people. The state-by-state breakdown below is from Census's most recent detailed vintage, July ${latestYear} (${num(stateBreakdownTotal)} nationally at that point) — a bit older than the national headline number, but it's the newest state-level detail Census has published.`,
  "",
  "Most populous states:", ...top.map((r) => `#${r.rank} ${r.state}: ${num(r.pop)}`), "",
  az ? `Arizona: #${az.rank} of ${ranked.length}, ${num(az.pop)}.` : "",
  "",
  `For scale: the top 3 states alone (${top[0].state}, ${top[1].state}, ${top[2].state}) hold ${(((top[0].pop + top[1].pop + top[2].pop) / stateBreakdownTotal) * 100).toFixed(1)}% of the entire U.S. population.`,
  "",
  "Sources: Federal Reserve Economic Data (national total) and U.S. Census Bureau Population Estimates Program (state breakdown).",
].filter(Boolean);

const lines = [
  `State population watch (${STAMP})`, "", `Census PEP, ${latestYear} population (vintage ${vintage}).`, "",
  view === "growth" ? "Rank | State | Growth (%) | Population" : "Rank | State | Population | YoY growth",
  "---:|---|---:|---:",
  ...ranked.map((r) => `${r.rank} | ${r.state} | ${view === "growth" ? `${pct(r.growthPct)} | ${num(r.pop)}` : `${num(r.pop)} | ${pct(r.growthPct)}`}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "population", "prior_year_population", "yoy_growth_pct"], ranked.map((r) => [r.rank, r.state, r.pop, r.priorPop, r.growthPct])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
