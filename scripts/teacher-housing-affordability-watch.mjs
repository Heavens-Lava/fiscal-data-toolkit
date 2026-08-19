#!/usr/bin/env node
// teacher-housing-affordability-watch.mjs — "Could a teacher afford the
// typical home in their own state?" Median home value (Census ACS) ÷ live
// BLS OEWS median elementary-teacher salary, by state. Uses the same
// verified BLS OEWS series pattern as public-service-pay-watch.mjs --job
// teacher, rather than a hardcoded salary table.
//
// Run:  node scripts/teacher-housing-affordability-watch.mjs
//       node scripts/teacher-housing-affordability-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, censusRows, envValue, money, rel } from "./lib/data-common.mjs";

const censusKey = envValue("CENSUS_API_KEY");
if (!censusKey) throw new Error("Missing CENSUS_API_KEY in .env.");
const blsKey = envValue("BLS_API_KEY");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `teacher-housing-affordability-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

let year, acs;
for (const candidate of [2024, 2023, 2022]) {
  try {
    acs = await censusRows(candidate, "acs/acs1/profile", ["DP04_0089E"], "state:*", censusKey);
    if (acs.length) { year = candidate; break; }
  } catch { /* try prior ACS vintage */ }
}
if (!year) throw new Error("No Census ACS home-value vintage available.");
const homeValueByFips = new Map(acs.map((r) => [r.state, Number(r.DP04_0089E)]));

// BLS OEWS: SOC 25-2022 (Elementary school teachers, except special ed),
// datatype 13 = median annual wage. Same series construction verified
// working in public-service-pay-watch.mjs.
const TEACHER_SOC = "252022";
const targets = STATES.map((state) => ({ ...state, id: `OEUS${state.fips7}000000${TEACHER_SOC}13` }));
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
  const homeValue = homeValueByFips.get(state?.fips);
  if (!state || !point || !Number.isFinite(Number(point.value)) || !Number.isFinite(homeValue) || homeValue <= 0) continue;
  const salary = Number(point.value);
  wageYears.push(point.year);
  rows.push({ state: state.name, salary, homeValue, multiple: homeValue / salary });
}
if (!rows.length) throw new Error("No matched teacher-salary/home-value rows.");
rows.sort((a, b) => b.multiple - a.multiple);
rows.forEach((r, i) => { r.rank = i + 1; });
const wageYear = wageYears[0] || "2025";

const top = rows.slice(0, 5);
const bottom = rows.slice(-5).reverse();
const usAvg = rows.reduce((s, r) => s + r.multiple, 0) / rows.length;
const az = rows.find((r) => r.state === "Arizona");

const chartRows = [...top, ...bottom.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.multiple, color: r.rank <= 5 ? C.neg : C.s1 })),
  { fmtTick: (v) => `${v.toFixed(0)}x`, fmtVal: (v) => `${v.toFixed(1)}x` }
);

const html = cardHTML({
  kicker: "Teacher housing affordability check",
  title: "Could a teacher afford the typical home in their own state?",
  hero: `${top[0].multiple.toFixed(1)}x`,
  heroLabel: `${top[0].state}; home value ÷ median teacher salary`,
  chartSVG, source: "Census ACS median home value ÷ BLS OEWS median teacher salary", vintage: `${year} home value, ${wageYear} wages`,
});

const facebook = [
  `In ${top[0].state}, the typical home costs ${top[0].multiple.toFixed(1)}x a teacher's median annual salary (${money(top[0].homeValue)} vs. ${money(top[0].salary)}/yr). In ${bottom[0].state}, it's just ${bottom[0].multiple.toFixed(1)}x. Every state, ranked:`,
  "",
  `Method: Census ACS ${year} median owner-occupied home value ÷ BLS OEWS ${wageYear} median annual salary for elementary school teachers, by state.`,
  "",
  "Least affordable for teachers:", ...top.map((r) => `#${r.rank} ${r.state}: ${r.multiple.toFixed(1)}x (${money(r.homeValue)} home, ${money(r.salary)}/yr teacher salary)`), "",
  "Most affordable for teachers:", ...bottom.map((r) => `#${r.rank} ${r.state}: ${r.multiple.toFixed(1)}x (${money(r.homeValue)} home, ${money(r.salary)}/yr teacher salary)`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${az.multiple.toFixed(1)}x.` : "",
  "",
  `50-state average: ${usAvg.toFixed(1)}x.`,
  "",
  "This is a simple price-to-salary multiple, not a mortgage affordability calculation — it doesn't account for down payment, interest rate, property tax, or insurance. A teacher's actual household may also have a second income.",
  "",
  "Source: U.S. Census Bureau ACS 1-year estimates (median home value); U.S. Bureau of Labor Statistics OEWS (median annual wage, elementary school teachers).",
].filter(Boolean);

const lines = [
  `Teacher housing affordability watch (${STAMP})`, "",
  `Census ACS ${year} median home value ÷ BLS OEWS ${wageYear} median elementary-teacher salary, by state.`, "",
  "Rank | State | Median home value | Median teacher salary | Multiple",
  "---:|---|---:|---:|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${money(r.homeValue)} | ${money(r.salary)} | ${r.multiple.toFixed(1)}x`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "state", "median_home_value", "median_teacher_salary", "multiple"],
  rows.map((r) => [r.rank, r.state, r.homeValue, r.salary, r.multiple.toFixed(2)])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
