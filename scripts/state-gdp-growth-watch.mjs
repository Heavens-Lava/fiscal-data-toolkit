#!/usr/bin/env node
// Which state economies are growing fastest, from BEA Regional real GDP data
// (chained dollars, so growth is inflation-adjusted).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, envValue, pct, rel } from "./lib/data-common.mjs";

const key = envValue("BEA_API_KEY");
if (!key) throw new Error("Missing BEA_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-gdp-growth-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

async function bea(params) {
  const qs = new URLSearchParams({ UserID: key, ResultFormat: "JSON", ...params });
  const res = await fetch(`https://apps.bea.gov/api/data?${qs}`);
  if (!res.ok) throw new Error(`BEA API HTTP ${res.status}`);
  const d = (await res.json()).BEAAPI;
  if (d.Results?.Error) throw new Error(d.Results.Error.APIErrorDescription);
  return d.Results?.Data || [];
}

// LineCode 1 = Real GDP (millions, chained dollars) — inflation-adjusted, so
// year-over-year % change reflects real growth, not just price increases.
const data = await bea({ method: "GetData", DataSetName: "Regional", TableName: "SASUMMARY", LineCode: 1, GeoFips: "STATE", Year: "LAST5" });
const abbrByFips = new Map(STATES.map((s) => [`${s.fips}000`, s.abbr]));

const byFips = new Map();
for (const r of data) {
  if (!/^\d{4}$/.test(r.TimePeriod)) continue;
  const value = Number((r.DataValue || "").replace(/,/g, "")) * Math.pow(10, Number(r.UNIT_MULT || 0));
  if (!Number.isFinite(value)) continue;
  const entry = byFips.get(r.GeoFips) || { name: r.GeoName.replace(/ \*+$/, ""), byYear: {} };
  entry.byYear[r.TimePeriod] = value;
  byFips.set(r.GeoFips, entry);
}

const years = [...new Set([...byFips.values()].flatMap((e) => Object.keys(e.byYear)))].sort();
const latestYear = years.at(-1), priorYear = years.at(-2);

const rows = [...byFips.entries()]
  .filter(([fips]) => abbrByFips.has(fips))
  .map(([, e]) => ({ state: e.name, gdp: e.byYear[latestYear], priorGdp: e.byYear[priorYear] }))
  .filter((r) => Number.isFinite(r.gdp) && Number.isFinite(r.priorGdp) && r.priorGdp > 0)
  .map((r) => ({ ...r, growthPct: ((r.gdp - r.priorGdp) / r.priorGdp) * 100 }))
  .sort((a, b) => b.growthPct - a.growthPct)
  .map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error("No BEA state real GDP growth rows.");

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 10);
const bottom = rows.slice(-5).reverse();

const chartSVG = horizontalBarChart(
  top.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.growthPct, color: r.state === "Arizona" ? C.s2 : C.s1 })),
  { fmtTick: (v) => `${v.toFixed(1)}%`, fmtVal: (v) => pct(v) }
);

const html = cardHTML({
  kicker: "State economies check",
  title: "Which state economies are growing the fastest?",
  hero: pct(top[0].growthPct),
  heroLabel: `${top[0].state}; real GDP growth, ${priorYear}-${latestYear}`,
  chartSVG, source: "U.S. Bureau of Economic Analysis, Regional Economic Accounts", vintage: latestYear,
});

const facebook = [
  `${top[0].state}'s economy grew ${pct(top[0].growthPct)} year-over-year — the fastest of any state, while ${bottom[0].state} grew just ${pct(bottom[0].growthPct)}. Every state, ranked:`,
  "",
  `BEA data, ${priorYear} to ${latestYear} — real (inflation-adjusted) GDP growth by state.`,
  "",
  "Fastest growing:", ...top.map((r) => `#${r.rank} ${r.state}: ${pct(r.growthPct)}`), "",
  "Slowest / shrinking:", ...bottom.map((r) => `#${r.rank} ${r.state}: ${pct(r.growthPct)}`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${pct(az.growthPct)}.` : "",
  "",
  "Note: this is real (inflation-adjusted) GDP growth — a state's economy can grow fast while still being a much smaller economy overall than a slower-growing giant like California or Texas (see our GDP-by-state post for the size ranking).",
  "",
  "Source: U.S. Bureau of Economic Analysis, Regional Economic Accounts (SASUMMARY).",
].filter(Boolean);

const lines = [
  `State GDP growth watch (${STAMP})`, "", `BEA Regional Economic Accounts, real GDP growth ${priorYear}-${latestYear}.`, "",
  "Rank | State | Real GDP growth",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${pct(r.growthPct)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "real_gdp_growth_pct"], rows.map((r) => [r.rank, r.state, r.growthPct])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
