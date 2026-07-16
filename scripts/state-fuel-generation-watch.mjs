#!/usr/bin/env node
// Electricity generation by state for a single fuel source (wind, solar,
// nuclear, coal, or hydro), from EIA Form EIA-923 operational data.
//
// Run:  node scripts/state-fuel-generation-watch.mjs --fuel wind
//       node scripts/state-fuel-generation-watch.mjs --fuel solar
//       node scripts/state-fuel-generation-watch.mjs --fuel nuclear
//       node scripts/state-fuel-generation-watch.mjs --fuel coal
//       node scripts/state-fuel-generation-watch.mjs --fuel hydro

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, argValue, envValue, num, pct, rel } from "./lib/data-common.mjs";

const FUELS = {
  wind: { id: "WND", label: "wind", noun: "Wind" },
  solar: { id: "TSN", label: "solar", noun: "Solar" },
  nuclear: { id: "NUC", label: "nuclear", noun: "Nuclear" },
  coal: { id: "COW", label: "coal", noun: "Coal" },
  hydro: { id: "HYC", label: "conventional hydroelectric", noun: "Hydroelectric" },
};

const eiaKey = envValue("EIA_API_KEY");
if (!eiaKey) throw new Error("Missing EIA_API_KEY in .env.");
const fuelKey = String(argValue("--fuel", "")).toLowerCase();
if (!FUELS[fuelKey]) throw new Error(`--fuel must be one of: ${Object.keys(FUELS).join(", ")}`);
const fuel = FUELS[fuelKey];
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-${fuelKey}-generation-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const url = "https://api.eia.gov/v2/electricity/electric-power-operational-data/data/";
const latestQs = new URLSearchParams({
  api_key: eiaKey, frequency: "annual", "data[0]": "generation",
  "facets[fueltypeid][]": fuel.id, "facets[sectorid][]": "99", "facets[location][]": "US",
  "sort[0][column]": "period", "sort[0][direction]": "desc", length: "1",
});
const latestRes = await fetch(`${url}?${latestQs}`);
if (!latestRes.ok) throw new Error(`EIA API HTTP ${latestRes.status}`);
const period = (await latestRes.json()).response?.data?.[0]?.period;
if (!period) throw new Error("Could not determine latest EIA electricity period.");

const qs = new URLSearchParams({
  api_key: eiaKey, frequency: "annual", "data[0]": "generation",
  "facets[fueltypeid][]": fuel.id, "facets[sectorid][]": "99", start: period, end: period, length: "5000",
});
const res = await fetch(`${url}?${qs}`);
if (!res.ok) throw new Error(`EIA API HTTP ${res.status}`);
const json = await res.json();

// Also need each state's ALL-fuels total, to show each state's fuel share.
const totalQs = new URLSearchParams({
  api_key: eiaKey, frequency: "annual", "data[0]": "generation",
  "facets[fueltypeid][]": "ALL", "facets[sectorid][]": "99", start: period, end: period, length: "5000",
});
const totalRes = await fetch(`${url}?${totalQs}`);
if (!totalRes.ok) throw new Error(`EIA API HTTP ${totalRes.status}`);
const totalJson = await totalRes.json();
const totalByState = new Map((totalJson.response?.data || []).map((d) => [d.location, Number(d.generation)]));

const stateAbbrs = new Set(STATES.map((s) => s.abbr));
const rows = (json.response?.data || [])
  .filter((d) => stateAbbrs.has(d.location))
  .map((d) => ({ state: d.stateDescription, gwh: Number(d.generation), stateTotal: totalByState.get(d.location) }))
  .filter((r) => Number.isFinite(r.gwh) && r.gwh > 0)
  .sort((a, b) => b.gwh - a.gwh)
  .map((r, i) => ({ ...r, rank: i + 1, share: Number.isFinite(r.stateTotal) && r.stateTotal > 0 ? (r.gwh / r.stateTotal) * 100 : null }));
if (!rows.length) throw new Error(`No EIA state ${fuel.label} generation rows.`);

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 10);
const nationalTotal = rows.reduce((s, r) => s + r.gwh, 0);

const chartSVG = horizontalBarChart(
  top.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.gwh, color: r.state === "Arizona" ? C.s2 : C.s1 })),
  { fmtTick: (v) => `${Math.round(v / 1000)}k`, fmtVal: (v) => `${num(v)} GWh` }
);

const html = cardHTML({
  kicker: `${fuel.noun} generation check`,
  title: `Which states generate the most ${fuel.label} electricity?`,
  hero: `${num(top[0].gwh)} GWh`,
  heroLabel: `${top[0].state}; ${fuel.label} generation, ${period}`,
  chartSVG, source: "U.S. EIA (Form EIA-923)", vintage: period,
});

const facebook = [
  `Which states generate the most ${fuel.label} electricity?`,
  "",
  `EIA ${period} data — ${fuel.label} electricity generation by state.`,
  "",
  "Top 10:", ...top.map((r) => `#${r.rank} ${r.state}: ${num(r.gwh)} GWh${r.share != null ? ` (${pct(r.share)} of that state's generation)` : ""}`), "",
  az && az.rank > 10 ? `Arizona: #${az.rank} of ${rows.length}, ${num(az.gwh)} GWh.` : "",
  "",
  `Nationally, these ${rows.length} states generated ${num(nationalTotal)} GWh of ${fuel.label} power in ${period}.`,
  "",
  `Note: this ranks total ${fuel.label} generation volume, not each state's electricity mix overall — a state can lead in raw ${fuel.label} output while still getting most of its power from other sources.`,
  "",
  "Source: U.S. Energy Information Administration, Form EIA-923 (electric power operational data).",
].filter(Boolean);

const lines = [
  `State ${fuel.label} generation watch (${STAMP})`, "", `EIA Form EIA-923, ${period} annual ${fuel.label} generation.`, "",
  "Rank | State | Generation (GWh) | Share of state's total generation",
  "---:|---|---:|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${num(r.gwh)} | ${r.share != null ? pct(r.share) : "-"}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "generation_gwh", "share_of_state_total_pct"], rows.map((r) => [r.rank, r.state, r.gwh, r.share])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
