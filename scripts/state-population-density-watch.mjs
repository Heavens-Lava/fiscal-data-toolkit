#!/usr/bin/env node
// Population density by state (people per square mile), Census ACS population
// over static land-area figures (U.S. Census Bureau 2020 land area, which
// doesn't change year to year). Rendered as a state tile map.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, screenshot, stateTileMap, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, censusRows, envValue, num, rel } from "./lib/data-common.mjs";

// U.S. Census Bureau, land area in square miles (2020 Census — land area is
// static and does not need an annual refresh).
const LAND_AREA_SQMI = {
  AL: 50645, AK: 570641, AZ: 113594, AR: 52035, CA: 155779, CO: 103642, CT: 4842, DE: 1949, DC: 61,
  FL: 53625, GA: 57513, HI: 6423, ID: 82643, IL: 55519, IN: 35826, IA: 55857, KS: 81759, KY: 39486,
  LA: 43204, ME: 30843, MD: 9707, MA: 7800, MI: 56539, MN: 79627, MS: 46923, MO: 68742, MT: 145546,
  NE: 76824, NV: 109781, NH: 8953, NJ: 7354, NM: 121298, NY: 47126, NC: 48618, ND: 69001, OH: 40861,
  OK: 68595, OR: 95988, PA: 44743, RI: 1034, SC: 30061, SD: 75811, TN: 41235, TX: 261232, UT: 82170,
  VT: 9217, VA: 39490, WA: 66456, WV: 24038, WI: 54158, WY: 97093,
};

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-population-density-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

let year, acs;
for (const candidate of [2024, 2023, 2022]) {
  try {
    acs = await censusRows(candidate, "acs/acs1/profile", ["DP05_0001E"], "state:*", key);
    if (acs.length) { year = candidate; break; }
  } catch { /* try prior ACS vintage */ }
}
if (!year) throw new Error("No Census ACS population vintage available.");

const stateByFips = new Map(STATES.map((s) => [s.fips, s]));
const rows = acs
  .map((r) => {
    const state = stateByFips.get(r.state);
    if (!state || !LAND_AREA_SQMI[state.abbr]) return null;
    const population = Number(r.DP05_0001E);
    const density = population / LAND_AREA_SQMI[state.abbr];
    return { state: state.name, abbr: state.abbr, population, density };
  })
  .filter(Boolean)
  .sort((a, b) => b.density - a.density)
  .map((r, i) => ({ ...r, rank: i + 1 }));

const az = rows.find((r) => r.abbr === "AZ");
const dense = rows.slice(0, 5);
const sparse = rows.slice(-5).reverse();
const fmtDensity = (v) => `${num(v)}/mi²`;

const chartSVG = stateTileMap(rows.map((r) => ({ ...r, v: r.density })), { fmtVal: fmtDensity });
const html = cardHTML({
  kicker: "Population density map",
  title: "People per square mile, by state",
  hero: fmtDensity(dense[0].density),
  heroLabel: `${dense[0].state}; population density, ${year}`,
  chartSVG, source: "U.S. Census Bureau ACS + static land area", vintage: String(year),
});

const facebook = [
  `${dense[0].state} packs in ${fmtDensity(dense[0].density)} — versus just ${fmtDensity(sparse[0].density)} in ${sparse[0].state}. Every state's population density, ranked:`,
  "",
  `Census ACS ${year} population ÷ Census Bureau land area — people per square mile, by state.`,
  "",
  "Most crowded:", ...dense.map((r) => `#${r.rank} ${r.state}: ${fmtDensity(r.density)}`), "",
  "Least crowded:", ...sparse.map((r) => `#${r.rank} ${r.state}: ${fmtDensity(r.density)}`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${fmtDensity(az.density)}.` : "",
  "",
  "This is an equal-size state tile map: color shows the value, not each state's physical land area.",
  "",
  "Note: statewide density averages hide a lot — a state can have both a dense city and vast empty land (Alaska and Nevada are extreme examples of this).",
  "",
  "Sources: U.S. Census Bureau American Community Survey (population) and U.S. Census Bureau land area figures (2020 Census).",
].filter(Boolean);

const lines = [
  `State population density watch (${STAMP})`, "", `Census ACS ${year} population over static land area (sq mi).`, "",
  "Rank | State | Population | People per sq mi",
  "---:|---|---:|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${num(r.population)} | ${num(r.density)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "population", "land_area_sqmi", "density_per_sqmi"], rows.map((r) => [r.rank, r.state, r.population, LAND_AREA_SQMI[r.abbr], r.density])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
