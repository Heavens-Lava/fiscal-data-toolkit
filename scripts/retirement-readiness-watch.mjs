#!/usr/bin/env node
// State retirement-security indicators for residents age 60+ from Census ACS.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, argValue, censusRows, envValue, money, pct, rel, uniqueRows } from "./lib/data-common.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const metric = String(argValue("--metric", "under150")).toLowerCase();
if (!["under150", "poverty"].includes(metric)) throw new Error("--metric must be under150 or poverty.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `retirement-readiness-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const vars = ["S0102_C02_078E", "S0102_C02_084E", "S0102_C02_087E", "S0102_C02_088E", "S0102_C02_091E", "S0102_C02_092E"];
let year;
let raw;
for (const candidate of [2025, 2024, 2023, 2022]) {
  try {
    raw = await censusRows(candidate, "acs/acs1/subject", vars, "state:*", key);
    if (raw.length) { year = candidate; break; }
  } catch { /* try prior ACS vintage */ }
}
if (!year) throw new Error("No Census ACS older-population vintage available.");
const rows = raw.map((r) => ({
  state: r.NAME, stateCode: r.state,
  meanSocialSecurity: Number(r.S0102_C02_078E), meanRetirementIncome: Number(r.S0102_C02_084E),
  povertyRate: Number(r.S0102_C02_087E), nearPovertyRate: Number(r.S0102_C02_088E),
  ownerRate: Number(r.S0102_C02_091E), renterRate: Number(r.S0102_C02_092E),
})).filter((r) => r.stateCode !== "72" && r.povertyRate >= 0 && r.meanSocialSecurity > 0)
  .map((r) => ({ ...r, under150Rate: r.povertyRate + r.nearPovertyRate }))
  .sort((a, b) => metric === "poverty" ? b.povertyRate - a.povertyRate : b.under150Rate - a.under150Rate)
  .map((r, i) => ({ ...r, rank: i + 1 }));

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 5);
const bottom = rows.slice(-5).reverse();
const chartRows = uniqueRows([...top, az, ...bottom.toReversed()], "state");
const chartSVG = horizontalBarChart(chartRows.map((r) => ({
  label: `#${r.rank} ${r.state}`, v: metric === "poverty" ? r.povertyRate : r.under150Rate, color: r.state === "Arizona" ? C.s2 : C.s1,
})), { fmtTick: (v) => `${Math.round(v)}%`, fmtVal: (v) => pct(v) });
const html = cardHTML({
  kicker: "Retirement security check",
  title: metric === "poverty" ? "Where is poverty highest among residents age 60+?" : "Where are most older residents below 150% of poverty?",
  hero: pct(metric === "poverty" ? top[0].povertyRate : top[0].under150Rate),
  heroLabel: `${top[0].state}; age 60+ ${metric === "poverty" ? "below poverty" : "below 150% of poverty"}`,
  chartSVG, source: "U.S. Census Bureau ACS S0102", vintage: String(year),
});
const facebook = [
  "Where do older Americans face the greatest financial pressure?", "",
  "We're using \"below 150% of the poverty line\" here instead of just \"below poverty\" — that's the cutoff researchers use because plenty of seniors just above the official poverty line still can't cover rent, medications, and food. It's not a stricter measure, it's a more realistic one.", "",
  "Highest shares of residents age 60+ below that line:",
  ...[...rows].sort((a, b) => b.under150Rate - a.under150Rate).slice(0, 5).map((r, i) => `#${i + 1} ${r.state}: ${pct(r.under150Rate)}`), "",
  az ? `#${az.rank} Arizona: ${pct(az.under150Rate)}` : "", "",
  "This is a measure of older residents living on very limited incomes, not a measurement of retirement-account balances.", "",
  az ? `Arizona context: ${pct(az.renterRate)} of older households rent. Households receiving Social Security report a mean annual Social Security income of ${money(az.meanSocialSecurity)}.` : "", "",
  "Which retirement measure should I add next: Social Security dependence, housing costs, or working after age 65? Comment below and share this with someone planning for retirement.", "",
  "Source: U.S. Census Bureau American Community Survey, table S0102.",
].filter(Boolean);
const lines = [
  `Retirement security by state (${STAMP})`, "", `Population age 60 and older; ACS ${year}.`, "",
  "State | Age 60+ below 150% of poverty",
  "---|---:",
  ...rows.map((r) => `#${r.rank} ${r.state} | ${pct(r.under150Rate)}`), "",
  "Facebook post", "-------------", facebook.join("\n"), "",
  "Note: Income figures are means among households receiving each income type. This is not an individual retirement-savings estimate.",
];
writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "under_150pct_poverty_60plus", "poverty_rate_60plus", "near_poverty_rate_60plus", "mean_social_security_income", "mean_retirement_income", "owner_rate_60plus", "renter_rate_60plus", "vintage"], rows.map((r) => [r.rank, r.state, r.under150Rate, r.povertyRate, r.nearPovertyRate, r.meanSocialSecurity, r.meanRetirementIncome, r.ownerRate, r.renterRate, year])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
