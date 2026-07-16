#!/usr/bin/env node
// Agricultural production/inventory by state, from USDA NASS QuickStats.
//
// Run:  node scripts/state-agriculture-watch.mjs --commodity corn
//       node scripts/state-agriculture-watch.mjs --commodity cattle
//       (see COMMODITIES below for the full list of --commodity keys)

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, argValue, envValue, num, rel } from "./lib/data-common.mjs";

// Each entry pins an exact NASS short_desc (verified against real data) to
// avoid mixing incompatible units (e.g. corn is reported in both $ and
// bushels; cotton in both $ and 480-lb bales) — short_desc is the one field
// that disambiguates cleanly.
// referencePeriod pins the exact NASS reporting snapshot to avoid mixing
// duplicate/forecast rows: PRODUCTION commodities publish monthly in-season
// forecasts plus one final "YEAR" figure; livestock INVENTORY commodities
// are point-in-time snapshots on their own schedule (verified against real
// query results — see repo history for the investigation).
const COMMODITIES = {
  corn: { commodity_desc: "CORN", statisticcat_desc: "PRODUCTION", short_desc: "CORN, GRAIN - PRODUCTION, MEASURED IN BU", referencePeriod: "YEAR", unit: "bushels", label: "Corn" },
  wheat: { commodity_desc: "WHEAT", statisticcat_desc: "PRODUCTION", short_desc: "WHEAT - PRODUCTION, MEASURED IN BU", referencePeriod: "YEAR", unit: "bushels", label: "Wheat" },
  soybeans: { commodity_desc: "SOYBEANS", statisticcat_desc: "PRODUCTION", short_desc: "SOYBEANS - PRODUCTION, MEASURED IN BU", referencePeriod: "YEAR", unit: "bushels", label: "Soybeans" },
  cotton: { commodity_desc: "COTTON", statisticcat_desc: "PRODUCTION", short_desc: "COTTON - PRODUCTION, MEASURED IN 480 LB BALES", referencePeriod: "YEAR", unit: "480-lb bales", label: "Cotton" },
  cattle: { commodity_desc: "CATTLE", statisticcat_desc: "INVENTORY", short_desc: "CATTLE, INCL CALVES - INVENTORY", referencePeriod: "FIRST OF JAN", unit: "head", label: "Cattle" },
  hogs: { commodity_desc: "HOGS", statisticcat_desc: "INVENTORY", short_desc: "HOGS - INVENTORY", referencePeriod: "FIRST OF DEC", unit: "head", label: "Hogs" },
  milk: { commodity_desc: "MILK", statisticcat_desc: "PRODUCTION", short_desc: "MILK - PRODUCTION, MEASURED IN LB", referencePeriod: "YEAR", unit: "lb", label: "Milk" },
  chickens: { commodity_desc: "CHICKENS", statisticcat_desc: "PRODUCTION", short_desc: "CHICKENS, BROILERS - PRODUCTION, MEASURED IN HEAD", referencePeriod: "YEAR", unit: "head", label: "Broiler chickens" },
  almonds: { commodity_desc: "ALMONDS", statisticcat_desc: "PRODUCTION", short_desc: "ALMONDS, IN SHELL - PRODUCTION, MEASURED IN LB", referencePeriod: "YEAR", unit: "lb", label: "Almonds" },
  grapes: { commodity_desc: "GRAPES", statisticcat_desc: "PRODUCTION", short_desc: "GRAPES - PRODUCTION, MEASURED IN TONS", referencePeriod: "YEAR", unit: "tons", label: "Grapes" },
  eggs: { commodity_desc: "EGGS", statisticcat_desc: "PRODUCTION", short_desc: "EGGS, TABLE - PRODUCTION, MEASURED IN DOZEN", referencePeriod: "MARKETING YEAR", unit: "dozen", label: "Eggs" },
  sheep: { commodity_desc: "SHEEP", statisticcat_desc: "INVENTORY", short_desc: "SHEEP, INCL LAMBS - INVENTORY", referencePeriod: "FIRST OF JAN", unit: "head", label: "Sheep" },
  turkeys: { commodity_desc: "TURKEYS", statisticcat_desc: "PRODUCTION", short_desc: "TURKEYS - PRODUCTION, MEASURED IN HEAD", referencePeriod: "YEAR", unit: "head", label: "Turkeys" },
  honey: { commodity_desc: "HONEY", statisticcat_desc: "PRODUCTION", short_desc: "HONEY - PRODUCTION, MEASURED IN LB", referencePeriod: "MARKETING YEAR", unit: "lb", label: "Honey" },
  "dairy-cows": { commodity_desc: "CATTLE", statisticcat_desc: "INVENTORY", short_desc: "CATTLE, COWS, MILK - INVENTORY", referencePeriod: "FIRST OF JAN", unit: "head", label: "Dairy cows" },
  // Census of Agriculture years only (2022, 2017, ...) — not annual.
  goats: { commodity_desc: "GOATS", statisticcat_desc: "INVENTORY", short_desc: "GOATS - INVENTORY", referencePeriod: "END OF DEC", domain_desc: "TOTAL", unit: "head", label: "Goats", censusYearsOnly: true },
  bison: { commodity_desc: "BISON", statisticcat_desc: "INVENTORY", short_desc: "BISON - INVENTORY", referencePeriod: "END OF DEC", unit: "head", label: "Bison", censusYearsOnly: true },
};

const key = envValue("USDA_NASS_API_KEY");
if (!key) throw new Error("Missing USDA_NASS_API_KEY in .env. Free key: https://quickstats.nass.usda.gov/api");
const commodityKey = String(argValue("--commodity", "")).toLowerCase();
if (!COMMODITIES[commodityKey]) throw new Error(`--commodity must be one of: ${Object.keys(COMMODITIES).join(", ")}`);
const c = COMMODITIES[commodityKey];
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-${commodityKey}-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

async function quickStats(params) {
  const qs = new URLSearchParams({ key, format: "JSON", ...params });
  const res = await fetch(`https://quickstats.nass.usda.gov/api/api_GET/?${qs}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`USDA NASS HTTP ${res.status}: ${text.slice(0, 200)}`);
  return (JSON.parse(text).data || []);
}

// Goats/bison are only surveyed in Census of Agriculture years (2022, 2017,
// ...), not annually — everything else is a normal annual survey.
const candidateYears = c.censusYearsOnly ? [2022, 2017, 2012] : [2024, 2023, 2022, 2021];
let year, data;
for (const candidate of candidateYears) {
  const rows = await quickStats({
    commodity_desc: c.commodity_desc, statisticcat_desc: c.statisticcat_desc,
    short_desc: c.short_desc, agg_level_desc: "STATE", year: String(candidate),
    reference_period_desc: c.referencePeriod,
    ...(c.domain_desc ? { domain_desc: c.domain_desc } : {}),
  });
  if (rows.length) { year = candidate; data = rows; break; }
}
if (!year) throw new Error(`No USDA NASS state-level data found for ${c.label}.`);

const rows = data
  .map((r) => ({ state: r.state_name, value: Number(String(r.Value || "").replace(/,/g, "")) }))
  .filter((r) => r.state && r.state !== "OTHER STATES" && Number.isFinite(r.value) && r.value > 0)
  .sort((a, b) => b.value - a.value)
  .map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error(`No usable ${c.label} rows for ${year}.`);

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 10);
const nationalTotal = rows.reduce((s, r) => s + r.value, 0);

const chartSVG = horizontalBarChart(
  top.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.value, color: r.state === "Arizona" ? C.s2 : C.s1 })),
  { fmtTick: (v) => num(v), fmtVal: (v) => `${num(v)} ${c.unit}` }
);

const html = cardHTML({
  kicker: "Agriculture check",
  title: `Which states produce the most ${c.label.toLowerCase()}?`,
  hero: num(top[0].value),
  heroLabel: `${top[0].state}; ${c.label.toLowerCase()}, ${year} (${c.unit})`,
  chartSVG, source: "USDA NASS QuickStats", vintage: String(year),
});

const facebook = [
  `Which states produce the most ${c.label.toLowerCase()}?`,
  "",
  `USDA ${year} data — ${c.label.toLowerCase()} by state (${c.unit}).`,
  "",
  "Top 10:", ...top.map((r) => `#${r.rank} ${r.state}: ${num(r.value)} ${c.unit}`), "",
  az && az.rank > 10 ? `Arizona: #${az.rank} of ${rows.length}, ${num(az.value)} ${c.unit}.` : "",
  "",
  `Top state's share of these ${rows.length} states' total: ${((top[0].value / nationalTotal) * 100).toFixed(1)}%.`,
  "",
  "Source: U.S. Department of Agriculture, National Agricultural Statistics Service (NASS QuickStats).",
].filter(Boolean);

const lines = [
  `State ${c.label.toLowerCase()} watch (${STAMP})`, "", `USDA NASS QuickStats, ${year} ${c.label.toLowerCase()} (${c.unit}).`, "",
  `Rank | State | ${c.label} (${c.unit})`,
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${num(r.value)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", `${commodityKey}_${c.unit.replace(/[^a-z0-9]+/gi, "_")}`], rows.map((r) => [r.rank, r.state, r.value])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
