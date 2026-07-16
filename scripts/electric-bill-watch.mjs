#!/usr/bin/env node
// Average residential electric bill by state — computed from EIA's reported
// monthly revenue and customer counts (Form EIA-861M), not cents/kWh (see
// electricity-price-watch.mjs for the per-kWh rate version of this data).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, envValue, money, rel } from "./lib/data-common.mjs";
import { fetchElectricity } from "./lib/eia-utilities.mjs";

const eiaKey = envValue("EIA_API_KEY");
if (!eiaKey) throw new Error("Missing EIA_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `electric-bill-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const { period, byState } = await fetchElectricity(eiaKey);
const rows = [...byState.entries()]
  .map(([state, annual]) => ({ state, annual, monthly: annual / 12 }))
  .sort((a, b) => b.monthly - a.monthly)
  .map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error("No EIA electricity billing rows.");

const az = rows.find((r) => r.state === "Arizona");
const highest = rows.slice(0, 5);
const lowest = rows.slice(-5).reverse();
const nationalAvgMonthly = rows.reduce((s, r) => s + r.monthly, 0) / rows.length;

const chartRows = [...highest, ...lowest.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.monthly, color: r.state === "Arizona" ? C.s2 : r.rank <= 5 ? C.neg : C.s1 })),
  { fmtTick: (v) => `$${Math.round(v)}`, fmtVal: money }
);

const html = cardHTML({
  kicker: "Electric bill check",
  title: "Average residential electric bill by state",
  hero: money(highest[0].monthly),
  heroLabel: `${highest[0].state}; average monthly bill, ${period}`,
  chartSVG, source: "U.S. EIA (Form EIA-861M)", vintage: period,
});

const facebook = [
  "Which states pay the highest average electric bills?",
  "",
  `EIA ${period} data — average residential electric bill, computed from actual reported monthly revenue divided by residential customer count (not just the per-kWh rate).`,
  "",
  "Highest:", ...highest.map((r) => `#${r.rank} ${r.state}: ${money(r.monthly)}/month`), "",
  "Lowest:", ...lowest.map((r) => `#${r.rank} ${r.state}: ${money(r.monthly)}/month`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${money(az.monthly)}/month.` : "",
  "",
  `Simple average across all states + DC: ${money(nationalAvgMonthly)}/month.`,
  "",
  "Note: this reflects actual average usage and local rates combined — a high bill can mean expensive electricity, high usage (like AC-heavy summers), or both.",
  "",
  "Source: U.S. Energy Information Administration, Form EIA-861M.",
].filter(Boolean);

const lines = [
  `Electric bill watch (${STAMP})`, "", `EIA Form EIA-861M, ${period}. Average monthly bill = reported monthly revenue / residential customers.`, "",
  "Rank | State | Avg monthly bill | Avg annual bill",
  "---:|---|---:|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${money(r.monthly)} | ${money(r.annual)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "avg_monthly_bill", "avg_annual_bill"], rows.map((r) => [r.rank, r.state, r.monthly, r.annual])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
