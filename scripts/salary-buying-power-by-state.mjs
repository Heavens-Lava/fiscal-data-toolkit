#!/usr/bin/env node
// What the same salary buys in each state, using BEA Regional Price Parities.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cardHTML, screenshot, stateTileMap, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, argValue, envValue, money, rel } from "./lib/data-common.mjs";

const key = envValue("BEA_API_KEY");
if (!key) throw new Error("Missing BEA_API_KEY in .env. Free key: https://apps.bea.gov/API/signup/");
const salary = Math.max(10000, Number(argValue("--salary", "100000")) || 100000);
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `salary-buying-power-${Math.round(salary)}-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const qs = new URLSearchParams({
  UserID: key, method: "GetData", DataSetName: "Regional", TableName: "SASUMMARY",
  LineCode: "13", GeoFips: "STATE", Year: "LAST5", ResultFormat: "JSON",
});
const res = await fetch(`https://apps.bea.gov/api/data?${qs}`);
if (!res.ok) throw new Error(`BEA HTTP ${res.status}`);
const body = (await res.json()).BEAAPI;
if (body.Results?.Error) throw new Error(body.Results.Error.APIErrorDescription);
const data = body.Results?.Data || [];
const year = [...new Set(data.map((r) => Number(r.TimePeriod)).filter(Number.isFinite))]
  .sort((a, b) => b - a)
  .find((candidate) => data.some((r) => Number(r.TimePeriod) === candidate && r.GeoFips !== "00000" && Number(String(r.DataValue).replace(/,/g, "")) > 0));
const stateByFips = new Map(STATES.map(({ fips, abbr, name }) => [fips, { abbr, name }]));
const rows = data.filter((r) => Number(r.TimePeriod) === year && /^\d{5}$/.test(r.GeoFips) && r.GeoFips !== "00000")
  .map((r) => ({
    state: r.GeoName.replace(/ \*+$/, ""),
    abbr: stateByFips.get(r.GeoFips.slice(0, 2))?.abbr,
    rpp: Number(String(r.DataValue).replace(/,/g, "")),
  }))
  .filter((r) => r.rpp > 0 && r.abbr)
  .map((r) => ({
    ...r,
    salaryNeeded: salary * r.rpp / 100,
    purchasingPower: salary * 100 / r.rpp,
    difference: salary * 100 / r.rpp - salary,
    costDifferencePct: r.rpp - 100,
  }))
  .sort((a, b) => b.purchasingPower - a.purchasingPower)
  .map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error("No BEA price-parity rows returned.");

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 5);
const bottom = rows.slice(-5).reverse();
const spread = top[0].purchasingPower - bottom[0].purchasingPower;
const feelsLike = (value) => `$${Math.round(value / 1000)}k`;
const chartSVG = stateTileMap(rows.map((r) => ({ abbr: r.abbr, v: r.purchasingPower })), {
  fmtVal: feelsLike,
  thresholds: [95000, 100000, 105000, 110000],
  legendLabels: ["Under $95k", "$95-99k", "$100-104k", "$105-109k", "$110k+"],
});

const html = cardHTML({
  kicker: "Salary buying-power check",
  title: `What ${money(salary)} feels like in every state`,
  hero: feelsLike(top[0].purchasingPower),
  heroLabel: `${top[0].state}; strongest purchasing-power equivalent`,
  chartSVG, source: "U.S. Bureau of Economic Analysis Regional Price Parities", vintage: String(year),
});

const facebook = [
  `A ${money(salary)} salary is not the same ${money(salary)} everywhere.`, "",
  `After adjusting for statewide price levels, it has about ${money(top[0].purchasingPower)} of purchasing power in ${top[0].state}, but about ${money(bottom[0].purchasingPower)} in ${bottom[0].state}. Same paycheck, roughly a ${money(spread)} difference in what it can buy.`, "",
  "Where it stretches furthest:",
  ...top.map((r) => `#${r.rank} ${r.state}: ${feelsLike(r.purchasingPower)}`), "",
  "Where it stretches least:",
  ...bottom.map((r) => `#${r.rank} ${r.state}: ${feelsLike(r.purchasingPower)}`), "",
  az ? `Arizona: #${az.rank}, about ${feelsLike(az.purchasingPower)} of purchasing power.` : null, "",
  "This is not a tax map and it does not show average wages. It estimates how far the same salary goes after adjusting for broad statewide prices. Housing, transportation, childcare, insurance, household size, and city-versus-rural costs can change an individual household's experience.", "",
  "Which state surprised you most, and does this match what life feels like where you live?", "",
  "Source: U.S. Bureau of Economic Analysis Regional Price Parities",
  "Source website: https://www.bea.gov/data/prices-inflation/regional-price-parities-state-and-metro-area",
  "Information retrieved programmatically via API.",
  "Graph made by Jeffrey Macy.",
].filter((line) => line !== null && line !== undefined && line !== false);

const lines = [
  `Salary purchasing power by state (${STAMP})`, "",
  `Question: What does ${money(salary)} feel like in each state after adjusting for statewide price levels? BEA vintage: ${year}.`, "",
  "State | Purchasing-power equivalent",
  "---|---:",
  ...rows.map((r) => `#${r.rank} ${r.state} | ${money(r.purchasingPower)}`),
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Note: BEA Regional Price Parity 100 equals the national price level. Purchasing-power equivalent equals the comparison salary divided by the state's relative price level.",
];
writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "state", "abbr", "rpp", "cost_vs_us_pct", "comparison_salary", "purchasing_power", "salary_needed", "difference", "vintage"],
  rows.map((r) => [r.rank, r.state, r.abbr, r.rpp, r.costDifferencePct, salary, r.purchasingPower, r.salaryNeeded, r.difference, year])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
