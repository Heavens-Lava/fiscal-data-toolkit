#!/usr/bin/env node
// Total electricity generation by state, from EIA Form EIA-923 operational data.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, envValue, num, rel } from "./lib/data-common.mjs";

const eiaKey = envValue("EIA_API_KEY");
if (!eiaKey) throw new Error("Missing EIA_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-electricity-generation-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const url = "https://api.eia.gov/v2/electricity/electric-power-operational-data/data/";
const latestQs = new URLSearchParams({
  api_key: eiaKey, frequency: "annual", "data[0]": "generation",
  "facets[fueltypeid][]": "ALL", "facets[sectorid][]": "99", "facets[location][]": "US",
  "sort[0][column]": "period", "sort[0][direction]": "desc", length: "1",
});
const latestRes = await fetch(`${url}?${latestQs}`);
if (!latestRes.ok) throw new Error(`EIA API HTTP ${latestRes.status}`);
const period = (await latestRes.json()).response?.data?.[0]?.period;
if (!period) throw new Error("Could not determine latest EIA electricity period.");

const qs = new URLSearchParams({
  api_key: eiaKey, frequency: "annual", "data[0]": "generation",
  "facets[fueltypeid][]": "ALL", "facets[sectorid][]": "99", start: period, end: period, length: "5000",
});
const res = await fetch(`${url}?${qs}`);
if (!res.ok) throw new Error(`EIA API HTTP ${res.status}`);
const json = await res.json();

const stateAbbrs = new Set(STATES.map((s) => s.abbr));
const rows = (json.response?.data || [])
  .filter((d) => stateAbbrs.has(d.location))
  .map((d) => ({ state: d.stateDescription, thousandMwh: Number(d.generation) }))
  .filter((r) => Number.isFinite(r.thousandMwh))
  .sort((a, b) => b.thousandMwh - a.thousandMwh)
  .map((r, i) => ({ ...r, rank: i + 1, gwh: r.thousandMwh }));
if (!rows.length) throw new Error("No EIA state electricity generation rows.");

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 10);

const chartSVG = horizontalBarChart(
  top.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.gwh, color: r.state === "Arizona" ? C.s2 : C.s1 })),
  { fmtTick: (v) => `${Math.round(v / 1000)}M`, fmtVal: (v) => `${num(v)} GWh` }
);

const html = cardHTML({
  kicker: "Electricity generation check",
  title: "Which states generate the most electricity?",
  hero: `${num(top[0].gwh)} GWh`,
  heroLabel: `${top[0].state}; total generation, ${period}`,
  chartSVG, source: "U.S. EIA (Form EIA-923)", vintage: period,
});

const facebook = [
  "Which states generate the most electricity?",
  "",
  `EIA ${period} data — total electricity generation by state, all sectors and fuel sources combined.`,
  "",
  "Top 10:", ...top.map((r) => `#${r.rank} ${r.state}: ${num(r.gwh)} GWh`), "",
  az && az.rank > 10 ? `Arizona: #${az.rank} of ${rows.length}, ${num(az.gwh)} GWh.` : "",
  "",
  "Note: this is generation, not consumption — states with lots of power plants (often for cheap fuel, land, or export purposes) can generate far more than their own residents use.",
  "",
  "Source: U.S. Energy Information Administration, Form EIA-923 (electric power operational data).",
].filter(Boolean);

const lines = [
  `State electricity generation watch (${STAMP})`, "", `EIA Form EIA-923, ${period} annual generation, all sectors and fuels.`, "",
  "Rank | State | Generation (GWh)",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${num(r.gwh)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "generation_gwh"], rows.map((r) => [r.rank, r.state, r.gwh])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
