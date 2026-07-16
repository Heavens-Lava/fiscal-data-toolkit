#!/usr/bin/env node
// State pay rankings for teachers, police officers, and firefighters from BLS OEWS.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, argValue, envValue, money, rel, uniqueRows } from "./lib/data-common.mjs";

const JOBS = {
  teacher: { soc: "252022", label: "Elementary school teachers" },
  police: { soc: "333051", label: "Police and sheriff's patrol officers" },
  firefighter: { soc: "332011", label: "Firefighters" },
};
const selected = String(argValue("--job", "teacher")).toLowerCase();
if (!JOBS[selected]) throw new Error(`Unknown --job ${selected}. Use teacher, police, or firefighter.`);
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `public-service-pay-${selected}-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });
const blsKey = envValue("BLS_API_KEY");

const targets = STATES.map((state) => {
  const id = `OEUS${state.fips7}000000${JOBS[selected].soc}13`;
  return { ...state, id };
});
const byId = new Map(targets.map((r) => [r.id, r]));
const series = [];
let cachedRows = null;
try {
  const batchSize = blsKey ? 50 : 25;
  for (let i = 0; i < targets.length; i += batchSize) {
    const ids = targets.slice(i, i + batchSize).map((r) => r.id);
    const body = { seriesid: ids, startyear: "2025", endyear: "2025" };
    if (blsKey) body.registrationkey = blsKey;
    const res = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`BLS HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== "REQUEST_SUCCEEDED") throw new Error((json.message || [json.status]).join("; "));
    series.push(...json.Results.series);
  }
} catch (error) {
  if (existsSync(`${outBase}.csv`)) {
    console.warn(`BLS refresh unavailable (${error.message}). Rebuilding from the saved ${STAMP} data.\n`);
    cachedRows = readFileSync(`${outBase}.csv`, "utf8").trim().split(/\r?\n/).slice(1).map((line) => {
      const [rank, name, abbr, occupation, soc, wage, year] = line.split(",");
      return { rank: Number(rank), name, abbr, occupation, soc, wage: Number(wage), year: Number(year) };
    });
  } else {
    throw error;
  }
}
const rows = cachedRows || series.map((s) => {
  const state = byId.get(s.seriesID);
  const point = s.data?.find((d) => Number(d.value) > 0);
  return state && point ? { ...state, wage: Number(point.value), year: Number(point.year) } : null;
}).filter(Boolean).sort((a, b) => b.wage - a.wage).map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error("No BLS state wage rows returned.");

const az = rows.find((r) => r.abbr === "AZ");
const top = rows.slice(0, 5);
const bottom = rows.slice(-5).reverse();
const stateMedian = [...rows].sort((a, b) => a.wage - b.wage)[Math.floor(rows.length / 2)].wage;
const spread = top[0].wage - bottom[0].wage;
const chartRows = uniqueRows([...top, az, ...bottom.toReversed()], "abbr");
const chartSVG = horizontalBarChart(chartRows.map((r) => ({
  label: `#${r.rank} ${r.name}`, v: r.wage, color: r.abbr === "AZ" ? C.s2 : C.s1,
})), { fmtTick: (v) => `$${Math.round(v / 1000)}k`, fmtVal: money });
const label = JOBS[selected].label;
const html = cardHTML({
  kicker: "Public-service pay check", title: `${label}: median pay by state`,
  hero: money(top[0].wage), heroLabel: `${top[0].name}; median annual wage`, chartSVG,
  source: "BLS Occupational Employment and Wage Statistics", vintage: String(top[0].year),
});
const facebook = [
  `How much do ${label.toLowerCase()} earn from state to state?`, "",
  `The published median-wage gap between the highest and lowest states is ${money(spread)}.`, "",
  "Highest:", ...top.slice(0, 3).map((r) => `#${r.rank} ${r.name}: ${money(r.wage)}`), "",
  az ? `Arizona: #${az.rank}, ${money(az.wage)}.` : "",
  "Lowest:", ...bottom.slice(0, 3).map((r) => `#${r.rank} ${r.name}: ${money(r.wage)}`), "",
  `Middle state in this ranking: ${money(stateMedian)}.`, "",
  `BLS published usable estimates for ${rows.length} states or districts in this comparison. These are occupation-wide median wages, not starting salaries, and they do not adjust for local prices, overtime, benefits, seniority, or differences in job duties.`, "",
  "Which public job should I add next: paramedics, social workers, corrections officers, or librarians? Comment below and share this with someone working in public service.", "",
  "Source: U.S. Bureau of Labor Statistics Occupational Employment and Wage Statistics.",
].filter(Boolean);
const lines = [
  `Public-service pay: ${label} (${STAMP})`, "", "State | Median annual wage", "---|---:",
  ...rows.map((r) => `#${r.rank} ${r.name} | ${money(r.wage)}`), "",
  "Facebook post", "-------------", facebook.join("\n"), "",
  `Note: ${rows.length} state or district estimates were published for this occupation. Unavailable or suppressed estimates are omitted.`,
];
writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "abbr", "occupation", "soc", "median_annual_wage", "year"], rows.map((r) => [r.rank, r.name, r.abbr, label, JOBS[selected].soc, r.wage, r.year])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
