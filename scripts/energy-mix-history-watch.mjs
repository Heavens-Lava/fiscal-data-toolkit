#!/usr/bin/env node
// America's electricity generation mix over the last 50 years, from EIA's
// historical Total Energy dataset (data available back to 1949).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, legend, lineChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, envValue, num, rel } from "./lib/data-common.mjs";

const eiaKey = envValue("EIA_API_KEY");
if (!eiaKey) throw new Error("Missing EIA_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `energy-mix-history-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

// MSN codes, EIA Total Energy dataset — "Electricity Net Generation ..., All
// Sectors, Million Kilowatthours". Renewables is a manual sum of hydro, wind,
// solar, geothermal, wood, and waste (no single "all renewables" MSN in this
// historical series).
const SERIES = {
  coal: "CLETPUS", gas: "NGETPUS", nuclear: "NUETPUS", petroleum: "PAETPUS", otherGases: "OJETPUS",
  hydro: "HVETPUS", geothermal: "GEETPUS", solar: "SOETPUS", wind: "WYETPUS", wood: "WDETPUS", waste: "WSETPUS",
  total: "ELETPUS",
};

async function fetchSeries(msn) {
  const qs = new URLSearchParams({ api_key: eiaKey, frequency: "annual", "data[0]": "value", "facets[msn][]": msn, "sort[0][column]": "period", "sort[0][direction]": "asc", length: "5000" });
  const res = await fetch(`https://api.eia.gov/v2/total-energy/data/?${qs}`);
  if (!res.ok) throw new Error(`EIA API HTTP ${res.status}`);
  const json = await res.json();
  return new Map((json.response?.data || []).map((d) => [d.period, Number(d.value)]));
}

const byMsn = Object.fromEntries(await Promise.all(Object.entries(SERIES).map(async ([key, msn]) => [key, await fetchSeries(msn)])));

const years = [...byMsn.total.keys()].filter((y) => /^\d{4}$/.test(y)).sort();
const latestYear = years.at(-1);
const startYear = String(Number(latestYear) - 49); // last 50 years including latestYear
const windowYears = years.filter((y) => y >= startYear);

const rows = windowYears.map((y) => {
  const renewables = ["hydro", "geothermal", "solar", "wind", "wood", "waste"].reduce((s, k) => s + (byMsn[k].get(y) || 0), 0);
  const other = (byMsn.petroleum.get(y) || 0) + (byMsn.otherGases.get(y) || 0);
  return {
    year: y, coal: byMsn.coal.get(y) || 0, gas: byMsn.gas.get(y) || 0, nuclear: byMsn.nuclear.get(y) || 0,
    renewables, other, total: byMsn.total.get(y) || 0,
  };
}).filter((r) => r.total > 0);
if (!rows.length) throw new Error("No EIA historical energy-mix rows.");

const first = rows[0], last = rows.at(-1);
const pct = (v, r) => (v / r.total) * 100;

const chartSeries = [
  { color: C.s1, points: rows.map((r) => ({ label: r.year, v: pct(r.coal, r) })), endLabel: (v) => v },
  { color: C.s2, points: rows.map((r) => ({ label: r.year, v: pct(r.gas, r) })), endLabel: (v) => v },
  { color: C.neg, points: rows.map((r) => ({ label: r.year, v: pct(r.renewables, r) })), endLabel: (v) => v },
];
const chartSVG = lineChart(chartSeries, {
  fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => `${v.toFixed(1)}%`,
  labelStep: Math.max(2, Math.round(rows.length / 10)), yLabel: "Share of electricity generation",
});
const legendHTML = legend([
  { color: C.s1, name: "Coal" }, { color: C.s2, name: "Natural gas" }, { color: C.neg, name: "Renewables" },
]);

const html = cardHTML({
  kicker: "Energy mix history check",
  title: `America's electricity mix, ${first.year}-${last.year}`,
  hero: `${pct(last.gas, last).toFixed(0)}%`,
  heroLabel: `natural gas share of generation, ${last.year}`,
  chartSVG, legendHTML, source: "U.S. EIA (Total Energy / historical MER series)", vintage: last.year,
});

const facebook = [
  `America's electricity mix has flipped over the last ${rows.length} years.`,
  "",
  `EIA historical data, ${first.year} vs. ${last.year}:`,
  "",
  `Coal: ${pct(first.coal, first).toFixed(0)}% → ${pct(last.coal, last).toFixed(0)}%`,
  `Natural gas: ${pct(first.gas, first).toFixed(0)}% → ${pct(last.gas, last).toFixed(0)}%`,
  `Nuclear: ${pct(first.nuclear, first).toFixed(0)}% → ${pct(last.nuclear, last).toFixed(0)}%`,
  `Renewables (hydro, wind, solar, geothermal, biomass): ${pct(first.renewables, first).toFixed(0)}% → ${pct(last.renewables, last).toFixed(0)}%`,
  `Petroleum & other gases: ${pct(first.other, first).toFixed(0)}% → ${pct(last.other, last).toFixed(0)}%`,
  "",
  `Total generation grew from ${num(first.total / 1000)} to ${num(last.total / 1000)} thousand GWh over that span.`,
  "",
  "Note: \"Renewables\" combines several EIA categories (conventional hydro, wind, solar, geothermal, wood, and waste) into one line for readability — it is not a single official EIA series.",
  "",
  "Which change surprises you most? Comment below and follow America by the Numbers for more data stories.",
  "",
  "Source: U.S. Energy Information Administration, Total Energy historical statistics (Monthly/Annual Energy Review series).",
  "Source website: https://www.eia.gov/totalenergy/data/monthly/",
  "Information retrieved programmatically through the EIA API.",
  "Graph and video made by Jeffrey Macy.",
].filter(Boolean);

const lines = [
  `Energy mix history watch (${STAMP})`, "", `EIA historical Total Energy dataset, ${first.year}-${last.year} annual generation shares.`, "",
  "Year | Coal % | Gas % | Nuclear % | Renewables % | Petroleum & other %",
  "---:|---:|---:|---:|---:|---:",
  ...rows.map((r) => `${r.year} | ${pct(r.coal, r).toFixed(1)} | ${pct(r.gas, r).toFixed(1)} | ${pct(r.nuclear, r).toFixed(1)} | ${pct(r.renewables, r).toFixed(1)} | ${pct(r.other, r).toFixed(1)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["year", "coal_pct", "gas_pct", "nuclear_pct", "renewables_pct", "other_pct", "total_generation_gwh"],
  rows.map((r) => [r.year, pct(r.coal, r), pct(r.gas, r), pct(r.nuclear, r), pct(r.renewables, r), pct(r.other, r), r.total])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
