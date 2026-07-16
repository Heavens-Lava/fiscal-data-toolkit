#!/usr/bin/env node
// What the same salary buys in each state, using BEA Regional Price Parities.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, argValue, envValue, money, rel, uniqueRows } from "./lib/data-common.mjs";

const key = envValue("BEA_API_KEY");
if (!key) throw new Error("Missing BEA_API_KEY in .env. Free key: https://apps.bea.gov/API/signup/");
const salary = Math.max(10000, Number(argValue("--salary", "70000")) || 70000);
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
const rows = data.filter((r) => Number(r.TimePeriod) === year && /^\d{5}$/.test(r.GeoFips) && r.GeoFips !== "00000")
  .map((r) => ({
    state: r.GeoName.replace(/ \*+$/, ""), rpp: Number(String(r.DataValue).replace(/,/g, "")),
  }))
  .filter((r) => r.rpp > 0)
  .map((r) => ({
    ...r,
    salaryNeeded: salary * r.rpp / 100,
    difference: salary * r.rpp / 100 - salary,
    costDifferencePct: r.rpp - 100,
  }))
  .sort((a, b) => b.salaryNeeded - a.salaryNeeded)
  .map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error("No BEA price-parity rows returned.");

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 5);
const bottom = rows.slice(-5).reverse();
const spread = top[0].salaryNeeded - bottom[0].salaryNeeded;
const costLabel = (r) => Math.abs(r.costDifferencePct) < 0.05
  ? "about the U.S. average"
  : `${Math.abs(r.costDifferencePct).toFixed(1)}% ${r.costDifferencePct > 0 ? "higher" : "lower"}`;
const chartRows = uniqueRows([...top, az, ...bottom.toReversed()], "state");
const chartSVG = horizontalBarChart(chartRows.map((r) => ({
  label: `#${r.rank} ${r.state}`, v: r.salaryNeeded, color: r.state === "Arizona" ? C.s2 : C.s1,
})), { fmtTick: (v) => `$${Math.round(v / 1000)}k`, fmtVal: money });

const html = cardHTML({
  kicker: "Salary buying-power check",
  title: `Salary needed to match a ${money(salary)} U.S.-average lifestyle`,
  hero: money(top[0].salaryNeeded),
  heroLabel: `${top[0].state}; highest salary needed`,
  chartSVG, source: "U.S. Bureau of Economic Analysis Regional Price Parities", vintage: String(year),
});

const facebook = [
  `What salary would you need in each state to afford what ${money(salary)} buys at U.S.-average prices?`,
  `${top[0].state} requires about ${money(top[0].salaryNeeded)}, while ${bottom[0].state} requires about ${money(bottom[0].salaryNeeded)}. That is a ${money(spread)} annual difference, or about ${money(spread / 12)} per month, for roughly the same broad purchasing power.`, "",
  "State | Salary needed for equivalent buying power",
  ...rows.map((r) => `#${r.rank} ${r.state} | ${money(r.salaryNeeded)} (${costLabel(r)})`), "",
  az ? `Arizona ranks #${az.rank}: ${money(az.salaryNeeded)} (${costLabel(az)}).` : "", "",
  "These are statewide price comparisons, not take-home-pay estimates. Taxes, household size, occupation, and city-versus-rural costs can change the real result.", "",
  `Does this match what living in your state feels like? Comment with your state, and share this with someone considering a move.`, "",
  "Sources:", "• U.S. Bureau of Economic Analysis Regional Price Parities",
  "Source website: https://www.bea.gov/data/prices-inflation/regional-price-parities-state-and-metro-area",
  "Information retrieved programmatically via API.",
  "Graph made by Jeffrey Macy.",
].filter(Boolean);

const lines = [
  `Salary needed by state (${STAMP})`, "",
  `Question: What salary is needed in each state to match what ${money(salary)} buys at U.S.-average prices? BEA vintage: ${year}.`, "",
  "State | Salary needed",
  "---|---:",
  ...rows.map((r) => `#${r.rank} ${r.state} | ${money(r.salaryNeeded)}`),
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Note: BEA Regional Price Parity 100 equals the national price level. Salary needed equals the comparison salary multiplied by the state's price level.",
];
writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "rpp", "cost_vs_us_pct", "comparison_salary", "salary_needed", "difference", "vintage"], rows.map((r) => [r.rank, r.state, r.rpp, r.costDifferencePct, salary, r.salaryNeeded, r.difference, year])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
