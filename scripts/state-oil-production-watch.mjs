#!/usr/bin/env node
// Crude oil production by state, from EIA petroleum field production data.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, envValue, num, rel } from "./lib/data-common.mjs";

const eiaKey = envValue("EIA_API_KEY");
if (!eiaKey) throw new Error("Missing EIA_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-oil-production-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const abbrToName = new Map(STATES.map((s) => [s.abbr, s.name]));
const url = "https://api.eia.gov/v2/petroleum/crd/crpdn/data/";

const latestQs = new URLSearchParams({
  api_key: eiaKey, frequency: "annual", "data[0]": "value", "facets[process][]": "FPF",
  "sort[0][column]": "period", "sort[0][direction]": "desc", length: "1",
});
const latestRes = await fetch(`${url}?${latestQs}`);
if (!latestRes.ok) throw new Error(`EIA API HTTP ${latestRes.status}`);
const period = (await latestRes.json()).response?.data?.[0]?.period;
if (!period) throw new Error("Could not determine latest EIA petroleum production period.");

const qs = new URLSearchParams({
  api_key: eiaKey, frequency: "annual", "data[0]": "value", "facets[process][]": "FPF",
  start: period, end: period, length: "5000",
});
const res = await fetch(`${url}?${qs}`);
if (!res.ok) throw new Error(`EIA API HTTP ${res.status}`);
const json = await res.json();

// EPC0 = generic "Crude Oil" product code — the one consistent total per
// state. Alaska also reports a separate "ANS Crude Oil" (EPCANS) row that is
// a subset of EPC0, not additional production — using only EPC0 avoids
// double-counting it.
const rows = (json.response?.data || [])
  .filter((d) => d.units === "MBBL" && d.product === "EPC0" && d.duoarea?.startsWith("S"))
  .map((d) => ({ state: abbrToName.get(d.duoarea.slice(1)), mbbl: Number(d.value) }))
  .filter((r) => r.state && Number.isFinite(r.mbbl) && r.mbbl > 0)
  .sort((a, b) => b.mbbl - a.mbbl)
  .map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error("No EIA state crude oil production rows.");

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 10);
const nationalTotal = rows.reduce((s, r) => s + r.mbbl, 0);

const chartSVG = horizontalBarChart(
  top.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.mbbl, color: r.state === "Arizona" ? C.s2 : C.s1 })),
  { fmtTick: (v) => `${Math.round(v / 1000)}M`, fmtVal: (v) => `${num(v)} kbbl` }
);

const html = cardHTML({
  kicker: "Oil production check",
  title: "Which states produce the most crude oil?",
  hero: `${(top[0].mbbl / 1e6).toFixed(2)}M bbl`,
  heroLabel: `${top[0].state}; crude oil field production, ${period}`,
  chartSVG, source: "U.S. EIA (petroleum field production data)", vintage: period,
});

const facebook = [
  "Which states produce the most crude oil?",
  "",
  `EIA ${period} data — crude oil field production by state.`,
  "",
  "Top 10:", ...top.map((r) => `#${r.rank} ${r.state}: ${num(r.mbbl)} thousand barrels`), "",
  az && az.rank > 10 ? `Arizona: #${az.rank} of ${rows.length}, ${num(az.mbbl)} thousand barrels.` : "",
  "",
  `Total across these ${rows.length} states: ${num(nationalTotal)} thousand barrels in ${period}.`,
  "",
  "Source: U.S. Energy Information Administration, petroleum field production data.",
].filter(Boolean);

const lines = [
  `State oil production watch (${STAMP})`, "", `EIA petroleum field production, ${period} crude oil (thousand barrels).`, "",
  "Rank | State | Production (thousand bbl)",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${num(r.mbbl)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "production_thousand_bbl"], rows.map((r) => [r.rank, r.state, r.mbbl])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
