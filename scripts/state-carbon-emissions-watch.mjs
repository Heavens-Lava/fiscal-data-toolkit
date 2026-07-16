#!/usr/bin/env node
// Energy-related CO2 emissions by state, from EIA's State Energy Data
// System (SEDS).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, envValue, num, rel } from "./lib/data-common.mjs";

const eiaKey = envValue("EIA_API_KEY");
if (!eiaKey) throw new Error("Missing EIA_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-carbon-emissions-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const url = "https://api.eia.gov/v2/seds/data/";
const latestQs = new URLSearchParams({
  api_key: eiaKey, frequency: "annual", "data[0]": "value", "facets[seriesId][]": "TETCE",
  "sort[0][column]": "period", "sort[0][direction]": "desc", length: "1",
});
const latestRes = await fetch(`${url}?${latestQs}`);
if (!latestRes.ok) throw new Error(`EIA API HTTP ${latestRes.status}`);
const period = (await latestRes.json()).response?.data?.[0]?.period;
if (!period) throw new Error("Could not determine latest EIA SEDS emissions period.");

const qs = new URLSearchParams({
  api_key: eiaKey, frequency: "annual", "data[0]": "value", "facets[seriesId][]": "TETCE",
  start: period, end: period, length: "5000",
});
const res = await fetch(`${url}?${qs}`);
if (!res.ok) throw new Error(`EIA API HTTP ${res.status}`);
const json = await res.json();

const rows = (json.response?.data || [])
  .filter((d) => d.stateId !== "US")
  .map((d) => ({ state: d.stateDescription, mmt: Number(d.value) }))
  .filter((r) => Number.isFinite(r.mmt) && r.mmt > 0)
  .sort((a, b) => b.mmt - a.mmt)
  .map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error("No EIA state CO2 emissions rows.");

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 5);
const bottom = rows.slice(-5).reverse();
const nationalTotal = rows.reduce((s, r) => s + r.mmt, 0);

const chartRows = [...top, ...bottom.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.mmt, color: r.state === "Arizona" ? C.s2 : r.rank <= 5 ? C.neg : C.s1 })),
  { fmtTick: (v) => `${Math.round(v)}`, fmtVal: (v) => `${v.toFixed(1)} MMT CO2` }
);

const html = cardHTML({
  kicker: "Carbon emissions check",
  title: "Energy-related CO2 emissions by state",
  hero: `${num(top[0].mmt)} MMT`,
  heroLabel: `${top[0].state}; energy-related CO2 emissions, ${period}`,
  chartSVG, source: "U.S. EIA State Energy Data System (SEDS)", vintage: period,
});

const facebook = [
  "Which states produce the most energy-related carbon emissions?",
  "",
  `EIA SEDS ${period} data — energy-related CO2 emissions by state (million metric tons).`,
  "",
  "Highest:", ...top.map((r) => `#${r.rank} ${r.state}: ${num(r.mmt)} MMT CO2`), "",
  "Lowest:", ...bottom.map((r) => `#${r.rank} ${r.state}: ${num(r.mmt)} MMT CO2`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${num(az.mmt)} MMT CO2.` : "",
  "",
  `Total across all states: ${num(nationalTotal)} million metric tons in ${period}.`,
  "",
  "Note: this counts total emissions, not per-person or per-dollar-of-economic-output — larger, more industrial, or more populous states naturally rank higher regardless of efficiency.",
  "",
  "Source: U.S. Energy Information Administration, State Energy Data System (SEDS).",
].filter(Boolean);

const lines = [
  `State carbon emissions watch (${STAMP})`, "", `EIA SEDS, ${period} energy-related CO2 emissions by state.`, "",
  "Rank | State | Emissions (million metric tons CO2)",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${r.mmt.toFixed(1)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "co2_million_metric_tons"], rows.map((r) => [r.rank, r.state, r.mmt])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
