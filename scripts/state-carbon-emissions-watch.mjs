#!/usr/bin/env node
// Energy-related CO2 emissions by state, from EIA's State Energy Data
// System (SEDS).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, censusRows, envValue, num, rel } from "./lib/data-common.mjs";

const eiaKey = envValue("EIA_API_KEY");
if (!eiaKey) throw new Error("Missing EIA_API_KEY in .env.");
const censusKey = envValue("CENSUS_API_KEY");
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

const rawRows = (json.response?.data || [])
  .filter((d) => d.stateId !== "US")
  .map((d) => ({ state: d.stateDescription, mmt: Number(d.value) }))
  .filter((r) => Number.isFinite(r.mmt) && r.mmt > 0);
if (!rawRows.length) throw new Error("No EIA state CO2 emissions rows.");

// Per-capita, not just total volume -- a raw-total ranking just reproduces
// the biggest/most-industrial-state ranking every time. Emissions per
// resident answers a more interesting question.
let popYear, acs;
if (censusKey) {
  for (const candidate of [2024, 2023, 2022]) {
    try {
      acs = await censusRows(candidate, "acs/acs1/profile", ["DP05_0001E"], "state:*", censusKey);
      if (acs.length) { popYear = candidate; break; }
    } catch { /* try prior ACS vintage */ }
  }
}
const stateByFips = new Map(STATES.map((s) => [s.fips, s]));
const popByName = new Map(
  (acs || []).map((r) => {
    const s = stateByFips.get(r.state);
    return s ? [s.name, Number(r.DP05_0001E)] : null;
  }).filter(Boolean)
);

const rows = rawRows
  .map((r) => ({ ...r, population: popByName.get(r.state), perCapitaTons: popByName.get(r.state) ? (r.mmt * 1e6) / popByName.get(r.state) : null }))
  .sort((a, b) => (b.perCapitaTons ?? -1) - (a.perCapitaTons ?? -1))
  .map((r, i) => ({ ...r, rank: i + 1 }));
const hasPerCapita = rows.every((r) => r.perCapitaTons != null);

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 5);
const bottom = rows.slice(-5).reverse();
const nationalTotal = rawRows.reduce((s, r) => s + r.mmt, 0);
const fmtPerCapita = (v) => `${v.toFixed(1)} tons/person`;

const chartRows = [...top, ...bottom.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({
    label: `#${r.rank} ${r.state}`,
    v: hasPerCapita ? r.perCapitaTons : r.mmt,
    color: r.state === "Arizona" ? C.s2 : r.rank <= 5 ? C.neg : C.s1,
  })),
  hasPerCapita
    ? { fmtTick: (v) => v.toFixed(0), fmtVal: fmtPerCapita }
    : { fmtTick: (v) => `${Math.round(v)}`, fmtVal: (v) => `${v.toFixed(1)} MMT CO2` }
);

const html = cardHTML({
  kicker: "Carbon emissions check",
  title: hasPerCapita ? "Energy-related CO2 emissions per person, by state" : "Energy-related CO2 emissions by state",
  hero: hasPerCapita ? fmtPerCapita(top[0].perCapitaTons) : `${num(top[0].mmt)} MMT`,
  heroLabel: `${top[0].state}; energy-related CO2 emissions${hasPerCapita ? " per resident" : ""}, ${period}`,
  chartSVG, source: "U.S. EIA State Energy Data System (SEDS)" + (hasPerCapita ? " + Census ACS" : ""), vintage: period,
});

const facebook = hasPerCapita ? [
  `${top[0].state} emits ${fmtPerCapita(top[0].perCapitaTons)} in energy-related CO2 — ${(top[0].perCapitaTons / bottom[0].perCapitaTons).toFixed(0)}x ${bottom[0].state}'s ${fmtPerCapita(bottom[0].perCapitaTons)}. Adjusting for population changes the leaderboard completely from a raw-total ranking. Every state, ranked:`,
  "",
  `EIA SEDS ${period} emissions ÷ Census ACS ${popYear} population — energy-related CO2 per resident, by state.`,
  "",
  "Highest per person:", ...top.map((r) => `#${r.rank} ${r.state}: ${fmtPerCapita(r.perCapitaTons)}`), "",
  "Lowest per person:", ...bottom.map((r) => `#${r.rank} ${r.state}: ${fmtPerCapita(r.perCapitaTons)}`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${fmtPerCapita(az.perCapitaTons)}.` : "",
  "",
  `Total across all states: ${num(nationalTotal)} million metric tons in ${period}.`,
  "",
  "Note: per-resident emissions reflect a state's industry mix, energy sources, and climate (heating/cooling demand) as much as individual behavior -- a state with heavy industry or power-plant exports can rank high here even if its households use little energy.",
  "",
  "Source: U.S. Energy Information Administration, State Energy Data System (SEDS); U.S. Census Bureau ACS.",
] : [
  `${top[0].state} emits ${num(top[0].mmt)} MMT of energy-related CO2 a year — more than ${(top[0].mmt / bottom[0].mmt).toFixed(0)}x ${bottom[0].state}. Every state, ranked:`,
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
];

const lines = [
  `State carbon emissions watch (${STAMP})`, "", `EIA SEDS, ${period} energy-related CO2 emissions by state.`, "",
  hasPerCapita ? "Rank | State | Emissions per person (tons) | Total (MMT)" : "Rank | State | Emissions (million metric tons CO2)",
  hasPerCapita ? "---:|---|---:|---:" : "---:|---|---:",
  ...rows.map((r) => hasPerCapita ? `${r.rank} | ${r.state} | ${r.perCapitaTons.toFixed(1)} | ${r.mmt.toFixed(1)}` : `${r.rank} | ${r.state} | ${r.mmt.toFixed(1)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  hasPerCapita ? ["rank", "state", "co2_per_capita_tons", "co2_million_metric_tons"] : ["rank", "state", "co2_million_metric_tons"],
  rows.map((r) => hasPerCapita ? [r.rank, r.state, r.perCapitaTons, r.mmt] : [r.rank, r.state, r.mmt])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
