#!/usr/bin/env node
// rent-hours-worked-watch.mjs — how many hours of work at the state's median
// wage does it take to cover one month's median rent? Census ACS gross rent
// ÷ BLS OEWS median wage (all occupations) by state -- a real median WORKER
// wage, not household income divided by a standard workweek (which conflates
// multi-earner households with a single wage rate).
//
// Run:  node scripts/rent-hours-worked-watch.mjs
//       node scripts/rent-hours-worked-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, censusRows, envValue, money, rel } from "./lib/data-common.mjs";

const censusKey = envValue("CENSUS_API_KEY");
if (!censusKey) throw new Error("Missing CENSUS_API_KEY in .env.");
const blsKey = envValue("BLS_API_KEY");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `rent-hours-worked-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

let year, acs;
for (const candidate of [2024, 2023, 2022]) {
  try {
    acs = await censusRows(candidate, "acs/acs1/profile", ["DP04_0134E"], "state:*", censusKey);
    if (acs.length) { year = candidate; break; }
  } catch { /* try prior ACS vintage */ }
}
if (!year) throw new Error("No Census ACS gross-rent vintage available.");

const rentByFips = new Map(acs.map((r) => [r.state, Number(r.DP04_0134E)]));

// BLS OEWS "All Occupations" (SOC 00-0000) median annual wage, by state --
// same OEUS series-ID pattern already verified working in
// public-service-pay-watch.mjs, just with the all-occupations SOC code.
const targets = STATES.map((state) => ({ ...state, id: `OEUS${state.fips7}00000000000013` }));
const byId = new Map(targets.map((r) => [r.id, r]));
const series = [];
const batchSize = blsKey ? 50 : 25;
for (let i = 0; i < targets.length; i += batchSize) {
  const ids = targets.slice(i, i + batchSize).map((r) => r.id);
  const body = { seriesid: ids, startyear: "2025", endyear: "2025" };
  if (blsKey) body.registrationkey = blsKey;
  const res = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`BLS HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== "REQUEST_SUCCEEDED") throw new Error((json.message || [json.status]).join("; "));
  series.push(...json.Results.series);
}

const wageYears = [];
const rows = [];
for (const s of series) {
  const state = byId.get(s.seriesID);
  const point = s.data?.[0];
  const rent = rentByFips.get(state?.fips);
  if (!state || !point || !Number.isFinite(Number(point.value)) || !Number.isFinite(rent) || rent <= 0) continue;
  const annualWage = Number(point.value);
  const hourlyWage = annualWage / 2080;
  const hoursForRent = rent / hourlyWage;
  wageYears.push(point.year);
  rows.push({ state: state.name, rent, annualWage, hourlyWage, hoursForRent, daysForRent: hoursForRent / 8 });
}
if (!rows.length) throw new Error("No matched rent/wage rows.");
rows.sort((a, b) => b.hoursForRent - a.hoursForRent);
rows.forEach((r, i) => { r.rank = i + 1; });
const oewsYear = wageYears[0] || "2025";

const top = rows.slice(0, 5);
const bottom = rows.slice(-5).reverse();
const usAvgHours = rows.reduce((s, r) => s + r.hoursForRent, 0) / rows.length;

const chartRows = [...top, ...bottom.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.hoursForRent, color: r.rank <= 5 ? C.neg : C.s1 })),
  { fmtTick: (v) => `${Math.round(v)}h`, fmtVal: (v) => `${v.toFixed(0)}h` }
);

const html = cardHTML({
  kicker: "Rent burden check",
  title: "How many hours of work does one month of rent cost?",
  hero: `${top[0].hoursForRent.toFixed(0)}h`,
  heroLabel: `${top[0].state}; hours at the state's median wage to cover median rent`,
  chartSVG, source: "Census ACS gross rent ÷ BLS OEWS median wage", vintage: `${year} rent, ${oewsYear} wages`,
});

const facebook = [
  `In ${top[0].state}, a worker earning the state's median wage has to work ${top[0].hoursForRent.toFixed(0)} hours — ${(top[0].hoursForRent / 8).toFixed(1)} full workdays — just to cover one month's median rent. In ${bottom[0].state}, the same rent takes ${bottom[0].hoursForRent.toFixed(0)} hours. Every state, ranked:`,
  "",
  `Method: Census ACS ${year} median gross rent ÷ (BLS OEWS ${oewsYear} median annual wage, all occupations, ÷ 2,080 standard work hours/year).`,
  "",
  "Most hours required:", ...top.map((r) => `#${r.rank} ${r.state}: ${r.hoursForRent.toFixed(0)}h (${money(r.rent)}/mo rent, $${r.hourlyWage.toFixed(2)}/hr median wage)`), "",
  "Fewest hours required:", ...bottom.map((r) => `#${r.rank} ${r.state}: ${r.hoursForRent.toFixed(0)}h (${money(r.rent)}/mo rent, $${r.hourlyWage.toFixed(2)}/hr median wage)`), "",
  `50-state average: ${usAvgHours.toFixed(0)} hours (${(usAvgHours / 8).toFixed(1)} workdays).`,
  "",
  "This uses each state's overall median wage across all occupations, not a renter-specific or minimum-wage figure — an individual's actual hours depend heavily on their own pay and how many people in the household are working.",
  "",
  "Source: U.S. Census Bureau ACS 1-year estimates (median gross rent); U.S. Bureau of Labor Statistics OEWS (median annual wage, all occupations).",
];

const lines = [
  `Rent hours worked watch (${STAMP})`, "",
  `Census ACS ${year} median gross rent ÷ BLS OEWS ${oewsYear} median wage (all occupations), converted to hours.`, "",
  "Rank | State | Monthly rent | Median hourly wage | Hours for rent | Workdays for rent",
  "---:|---|---:|---:|---:|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${money(r.rent)} | $${r.hourlyWage.toFixed(2)} | ${r.hoursForRent.toFixed(1)} | ${r.daysForRent.toFixed(1)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "state", "monthly_rent", "median_hourly_wage", "hours_for_rent", "workdays_for_rent"],
  rows.map((r) => [r.rank, r.state, r.rent, r.hourlyWage.toFixed(2), r.hoursForRent.toFixed(1), r.daysForRent.toFixed(1)])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
