#!/usr/bin/env node
// Ownership entities for U.S. rental properties and rental units from Census/HUD RHFS.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, envValue, getJSON, num, parseTable, pct, rel } from "./lib/data-common.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const year = 2024;
const outBase = path.join(SOCIAL, `housing-ownership-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const qs = new URLSearchParams({
  get: "TBL_NAME,SUBTABLE_L1,CHARACTERISTIC,FGSZ_NAME,BYGROUP,BYGROUP_VALUE,ESTIMATE_PROPERTIES,ESTIMATE_UNITS",
  TABLE_CODE: "2", ST_L1: "204", FGSZ: "0", BGR: "1", ucgid: "0100000US", key,
});
const raw = parseTable(await getJSON(`https://api.census.gov/data/${year}/rhfs?${qs}`, "Census RHFS"));
const total = raw.find((r) => r.CHARACTERISTIC === "Total");
if (!total) throw new Error("RHFS ownership total was not returned.");
const totalUnits = Number(total.ESTIMATE_UNITS);
const totalProperties = Number(total.ESTIMATE_PROPERTIES);
const rows = raw.filter((r) => r.CHARACTERISTIC !== "Total").map((r) => ({
  owner: r.CHARACTERISTIC, properties: Number(r.ESTIMATE_PROPERTIES), units: Number(r.ESTIMATE_UNITS),
})).filter((r) => r.units >= 0).map((r) => ({
  ...r, unitShare: r.units / totalUnits * 100, propertyShare: r.properties / totalProperties * 100,
  unitsPerProperty: r.properties > 0 ? r.units / r.properties : null,
})).sort((a, b) => b.units - a.units).map((r, i) => ({ ...r, rank: i + 1 }));

const reported = rows.filter((r) => r.owner !== "Not reported");
const chartSVG = horizontalBarChart(reported.map((r, i) => ({
  label: r.owner.length > 29 ? `${r.owner.slice(0, 26)}...` : r.owner,
  v: r.unitShare, color: i === 0 ? C.s2 : C.s1,
})), { fmtTick: (v) => `${Math.round(v)}%`, fmtVal: (v) => pct(v) });
const largest = reported[0];
const html = cardHTML({
  kicker: "Rental housing ownership check",
  title: "Legal ownership of U.S. rental units",
  hero: pct(largest.unitShare), heroLabel: `${largest.owner}; share of rental units`,
  chartSVG, source: "U.S. Census Bureau/HUD Rental Housing Finance Survey", vintage: String(year),
});
const individual = rows.find((r) => r.owner === "Individual investor");
const llc = rows.find((r) => r.owner === "LLP, LP or LLC");
const reit = rows.find((r) => r.owner === "Real Estate Investment Trust (REIT)");
const corporation = rows.find((r) => r.owner === "Real estate corporation");
const facebook = [
  "Who legally owns America's rental housing?", "",
  `LLPs, LPs and LLCs held an estimated ${num(llc.units * 1000)} rental units, or ${pct(llc.unitShare)} of the national total measured by the 2024 Census/HUD Rental Housing Finance Survey.`,
  `Individual investors owned the largest share of rental properties: ${pct(individual.propertyShare)}. Those properties contained about ${num(individual.units * 1000)} units (${pct(individual.unitShare)} of units).`,
  `REITs and real-estate corporations together held about ${num((reit.units + corporation.units) * 1000)} units (${pct(reit.unitShare + corporation.unitShare)}).`, "",
  "Largest shares of rental units:", ...reported.slice(0, 5).map((r) => `${r.owner}: ${pct(r.unitShare)}`), "",
  "These are legal ownership entities, not a count of ultimate beneficial owners. An LLC may represent one local landlord or a large investment company, so LLC should not be treated as synonymous with institutional ownership.", "",
  "Which breakdown should come next: single-family rentals, property size, mortgages, or how many other properties each owner holds? Comment below and share this with someone following the rental market.", "",
  "Source: U.S. Census Bureau and HUD, 2024 Rental Housing Finance Survey.",
];
const lines = [
  `U.S. rental housing ownership (${STAMP})`, "", `RHFS ${year}; estimates are reported in thousands.`, "",
  "Ownership entity | Share of rental units",
  "---|---:",
  ...rows.map((r) => `#${r.rank} ${r.owner} | ${pct(r.unitShare)}`), "",
  "Facebook post", "-------------", facebook.join("\n"), "",
  "Note: RHFS covers properties with at least one rental unit. Entity type does not reveal the ultimate beneficial owner.",
];
writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "ownership_entity", "properties_thousands", "property_share_pct", "rental_units_thousands", "unit_share_pct", "units_per_property", "vintage"], rows.map((r) => [r.rank, r.owner, r.properties, r.propertyShare, r.units, r.unitShare, r.unitsPerProperty ?? "", year])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
