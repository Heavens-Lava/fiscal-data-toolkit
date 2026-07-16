#!/usr/bin/env node
// Largest state economies by nominal GDP, from BEA Regional data.
//
// Run:  node scripts/state-gdp-watch.mjs
// Key:  free registration at apps.bea.gov/API/signup/ → store in .env as BEA_API_KEY

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, envValue, money, rel } from "./lib/data-common.mjs";

const key = envValue("BEA_API_KEY");
if (!key) throw new Error("Missing BEA_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-gdp-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

async function bea(params) {
  const qs = new URLSearchParams({ UserID: key, ResultFormat: "JSON", ...params });
  const res = await fetch(`https://apps.bea.gov/api/data?${qs}`);
  if (!res.ok) throw new Error(`BEA API HTTP ${res.status}`);
  const d = (await res.json()).BEAAPI;
  if (d.Results?.Error) throw new Error(d.Results.Error.APIErrorDescription);
  return d.Results?.Data || [];
}

// LineCode 4 = Nominal GDP (millions of current dollars), TableName SASUMMARY.
const data = await bea({ method: "GetData", DataSetName: "Regional", TableName: "SASUMMARY", LineCode: 4, GeoFips: "STATE", Year: "LAST5" });
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

const year = [...byFips.values()].flatMap((e) => Object.keys(e.byYear)).sort().at(-1);
const rows = [...byFips.entries()]
  .filter(([fips]) => abbrByFips.has(fips))
  .map(([fips, e]) => ({ state: e.name, gdp: e.byYear[year] }))
  .filter((r) => Number.isFinite(r.gdp))
  .sort((a, b) => b.gdp - a.gdp)
  .map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error("No BEA state GDP rows.");

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 10);
const totalUS = rows.reduce((s, r) => s + r.gdp, 0);

const chartSVG = horizontalBarChart(
  top.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.gdp, color: r.state === "Arizona" ? C.s2 : C.s1 })),
  { fmtTick: (v) => `$${(v / 1e12).toFixed(1)}T`, fmtVal: money }
);

const html = cardHTML({
  kicker: "State economies check",
  title: "The largest state economies by GDP",
  hero: money(top[0].gdp),
  heroLabel: `${top[0].state}; nominal GDP, ${year}`,
  chartSVG, source: "U.S. Bureau of Economic Analysis, Regional Economic Accounts", vintage: year,
});

const facebook = [
  "Which state economies are actually the biggest?",
  "",
  `BEA ${year} data — nominal GDP by state.`,
  "",
  "Top 10:", ...top.map((r) => `#${r.rank} ${r.state}: ${money(r.gdp)}`), "",
  az && az.rank > 10 ? `Arizona: #${az.rank} of ${rows.length}, ${money(az.gdp)}.` : "",
  "",
  `For scale: ${top[0].state} alone is ${((top[0].gdp / totalUS) * 100).toFixed(1)}% of total U.S. GDP across all states.`,
  "",
  "Note: this is total state GDP (economic output), not per-person income or state budget/tax revenue — a state can have a huge economy and a small government budget, or vice versa.",
  "",
  "Source: U.S. Bureau of Economic Analysis, Regional Economic Accounts (SASUMMARY).",
].filter(Boolean);

const lines = [
  `State GDP watch (${STAMP})`, "", `BEA Regional Economic Accounts, ${year} nominal GDP.`, "",
  "Rank | State | Nominal GDP",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${money(r.gdp)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "nominal_gdp"], rows.map((r) => [r.rank, r.state, r.gdp])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
