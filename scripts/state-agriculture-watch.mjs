#!/usr/bin/env node
// Agricultural production/inventory by state, from USDA NASS QuickStats.
//
// Run:  node scripts/state-agriculture-watch.mjs --commodity corn
//       node scripts/state-agriculture-watch.mjs --commodity cattle
//       (see COMMODITIES below for the full list of --commodity keys)

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
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
// dollarShortDesc: a verified-matching "..., MEASURED IN $" short_desc at
// STATE level for the same statisticcat_desc/reference period as the base
// unit series (checked against live 2024 data before adding — several
// candidates that look plausible turned out to be discontinued or scoped
// differently: COTTON's $ series stops in the 1990s, GRAPES has none at
// STATE level, CORN and CHICKENS only have a SALES $ series that doesn't
// share PRODUCTION's scope, and every INVENTORY (head-count) commodity has
// no true "$ value of the herd" equivalent — "SALES, MEASURED IN $" for
// those is annual marketings revenue, a different concept from a livestock
// census count, so it's deliberately left off rather than mislabeled).
const COMMODITIES = {
  corn: { commodity_desc: "CORN", statisticcat_desc: "PRODUCTION", short_desc: "CORN, GRAIN - PRODUCTION, MEASURED IN BU", referencePeriod: "YEAR", unit: "bushels", label: "Corn" },
  wheat: { commodity_desc: "WHEAT", statisticcat_desc: "PRODUCTION", short_desc: "WHEAT - PRODUCTION, MEASURED IN BU", referencePeriod: "YEAR", unit: "bushels", label: "Wheat", dollarShortDesc: "WHEAT - PRODUCTION, MEASURED IN $" },
  soybeans: { commodity_desc: "SOYBEANS", statisticcat_desc: "PRODUCTION", short_desc: "SOYBEANS - PRODUCTION, MEASURED IN BU", referencePeriod: "YEAR", unit: "bushels", label: "Soybeans", dollarShortDesc: "SOYBEANS - PRODUCTION, MEASURED IN $" },
  cotton: { commodity_desc: "COTTON", statisticcat_desc: "PRODUCTION", short_desc: "COTTON - PRODUCTION, MEASURED IN 480 LB BALES", referencePeriod: "YEAR", unit: "480-lb bales", label: "Cotton" },
  cattle: { commodity_desc: "CATTLE", statisticcat_desc: "INVENTORY", short_desc: "CATTLE, INCL CALVES - INVENTORY", referencePeriod: "FIRST OF JAN", unit: "head", label: "Cattle" },
  hogs: { commodity_desc: "HOGS", statisticcat_desc: "INVENTORY", short_desc: "HOGS - INVENTORY", referencePeriod: "FIRST OF DEC", unit: "head", label: "Hogs" },
  milk: { commodity_desc: "MILK", statisticcat_desc: "PRODUCTION", short_desc: "MILK - PRODUCTION, MEASURED IN LB", referencePeriod: "YEAR", unit: "lb", label: "Milk", dollarShortDesc: "MILK - PRODUCTION, MEASURED IN $" },
  chickens: { commodity_desc: "CHICKENS", statisticcat_desc: "PRODUCTION", short_desc: "CHICKENS, BROILERS - PRODUCTION, MEASURED IN HEAD", referencePeriod: "YEAR", unit: "head", label: "Broiler chickens" },
  almonds: { commodity_desc: "ALMONDS", statisticcat_desc: "PRODUCTION", short_desc: "ALMONDS, IN SHELL - PRODUCTION, MEASURED IN LB", referencePeriod: "YEAR", unit: "lb", label: "Almonds" },
  grapes: { commodity_desc: "GRAPES", statisticcat_desc: "PRODUCTION", short_desc: "GRAPES - PRODUCTION, MEASURED IN TONS", referencePeriod: "YEAR", unit: "tons", label: "Grapes" },
  eggs: { commodity_desc: "EGGS", statisticcat_desc: "PRODUCTION", short_desc: "EGGS, TABLE - PRODUCTION, MEASURED IN DOZEN", referencePeriod: "MARKETING YEAR", unit: "dozen", label: "Eggs", dollarShortDesc: "EGGS - PRODUCTION, MEASURED IN $" },
  sheep: { commodity_desc: "SHEEP", statisticcat_desc: "INVENTORY", short_desc: "SHEEP, INCL LAMBS - INVENTORY", referencePeriod: "FIRST OF JAN", unit: "head", label: "Sheep" },
  turkeys: { commodity_desc: "TURKEYS", statisticcat_desc: "PRODUCTION", short_desc: "TURKEYS - PRODUCTION, MEASURED IN HEAD", referencePeriod: "YEAR", unit: "head", label: "Turkeys", dollarShortDesc: "TURKEYS - PRODUCTION, MEASURED IN $" },
  honey: { commodity_desc: "HONEY", statisticcat_desc: "PRODUCTION", short_desc: "HONEY - PRODUCTION, MEASURED IN LB", referencePeriod: "MARKETING YEAR", unit: "lb", label: "Honey", dollarShortDesc: "HONEY - PRODUCTION, MEASURED IN $" },
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

let dollarByState = new Map();
if (c.dollarShortDesc) {
  const dollarRows = await quickStats({
    commodity_desc: c.commodity_desc, statisticcat_desc: "PRODUCTION",
    short_desc: c.dollarShortDesc, agg_level_desc: "STATE", year: String(year),
    reference_period_desc: c.referencePeriod,
  });
  dollarByState = new Map(
    dollarRows
      .map((r) => [r.state_name, Number(String(r.Value || "").replace(/,/g, ""))])
      .filter(([state, v]) => state && state !== "OTHER STATES" && Number.isFinite(v) && v > 0)
  );
}

// NASS returns state names in ALL CAPS ("NORTH DAKOTA"); title-case for display,
// but join against dollarByState using the raw r.state_name key it was built with.
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());

const rows = data
  .map((r) => ({ state: r.state_name && titleCase(r.state_name), value: Number(String(r.Value || "").replace(/,/g, "")), dollarValue: dollarByState.get(r.state_name) }))
  .filter((r) => r.state && r.state !== "Other States" && Number.isFinite(r.value) && r.value > 0)
  .sort((a, b) => b.value - a.value)
  .map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error(`No usable ${c.label} rows for ${year}.`);

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 10);
const nationalTotal = rows.reduce((s, r) => s + r.value, 0);
const hasDollar = rows.some((r) => Number.isFinite(r.dollarValue));
const nationalDollarTotal = hasDollar ? rows.reduce((s, r) => s + (r.dollarValue || 0), 0) : null;
const impliedPricePerUnit = hasDollar ? nationalDollarTotal / nationalTotal : null;
const money = (n) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${Math.round(a).toLocaleString("en-US")}`;
};

const compact = (n) => {
  const value = Math.abs(n);
  if (value >= 1e9) return `${(n / 1e9).toFixed(value >= 10e9 ? 0 : 1)}B`;
  if (value >= 1e6) return `${(n / 1e6).toFixed(value >= 10e6 ? 0 : 1)}M`;
  if (value >= 1e3) return `${(n / 1e3).toFixed(value >= 10e3 ? 0 : 1)}k`;
  return Math.round(n).toLocaleString("en-US");
};

// Bar-end labels have limited width, especially on the #1 bar (near-full-length);
// the axis ticks already establish the unit scale, so keep this to the $ value
// alone when available (new information) rather than repeating "N bushels" too —
// the full "N bushels ($X)" detail still appears in the text caption/table below.
const podiumColors = ["#d69e2e", "#9aa3a8", "#b76e45"];
const chartSVG = horizontalBarChart(
  top.map((r, index) => ({
    label: `#${r.rank} ${r.state}`,
    v: r.value,
    color: podiumColors[index] || (r.state === "Arizona" ? "#e4ad55" : "#3b9c95"),
  })),
  {
    fmtTick: compact,
    fmtVal: (v) => `${compact(v)} ${c.unit}`,
  }
);

const topShare = (top[0].value / nationalTotal) * 100;
const html = cardHTML({
  kicker: "Agriculture check",
  title: commodityKey === "wheat" ? "Where America's wheat comes from" : `Which states produce the most ${c.label.toLowerCase()}?`,
  hero: `${topShare.toFixed(1)}%`,
  heroLabel: `${top[0].state}'s share of reported U.S. production`,
  chartSVG, source: "USDA NASS QuickStats", vintage: String(year),
});

const facebook = [
  commodityKey === "wheat"
    ? "Where does America's bread come from?"
    : commodityKey === "soybeans"
    ? `${top[0].state} harvested ${compact(top[0].value)} bushels of soybeans in ${year}—${topShare.toFixed(1)}% of the production reported by these ${rows.length} states.`
    : commodityKey === "cotton"
    ? `${top[0].state} produced ${compact(top[0].value)} cotton bales in ${year}—more than twice as many as #2 ${top[1].state}.`
    : hasDollar
    ? `${top[0].state}'s ${c.label.toLowerCase()} production was worth ${money(top[0].dollarValue)} in ${year} — more than any other state.`
    : `Which states produce the most ${c.label.toLowerCase()}?`,
  "",
  commodityKey === "wheat"
    ? `${top[0].state} produced ${num(top[0].value)} bushels in ${year}—${topShare.toFixed(1)}% of the total reported by these ${rows.length} states. USDA valued North Dakota's crop at ${money(top[0].dollarValue)}.`
    : commodityKey === "soybeans"
    ? `USDA valued ${top[0].state}'s soybean crop at ${money(top[0].dollarValue)} and the combined crop across these states at ${money(nationalDollarTotal)}.`
    : commodityKey === "cotton"
    ? `${top[0].state} accounted for ${topShare.toFixed(1)}% of the cotton reported by these ${rows.length} states.`
    : hasDollar
    ? `USDA reports ${num(top[0].value)} ${c.unit} from ${top[0].state}, valued at ${money(top[0].dollarValue)}. Across all ${rows.length} reporting states, the crop's average value was about ${(impliedPricePerUnit >= 1 ? `$${impliedPricePerUnit.toFixed(2)}` : `${(impliedPricePerUnit * 100).toFixed(0)} cents`)} per ${c.unit.replace(/s$/, "")}.`
    : `USDA ${year} data — ${c.label.toLowerCase()} by state (${c.unit}).`,
  "",
  "Top 10:",
  ...top.map((r) => `#${r.rank} ${r.state}: ${num(r.value)} ${c.unit}${Number.isFinite(r.dollarValue) ? ` (${money(r.dollarValue)})` : ""}`),
  "",
  az && az.rank > 10 ? `Arizona: #${az.rank} of ${rows.length}, ${num(az.value)} ${c.unit}${Number.isFinite(az.dollarValue) ? ` (${money(az.dollarValue)})` : ""}.` : null,
  "",
  ["wheat", "soybeans", "cotton"].includes(commodityKey) ? null : `Top state's share of these ${rows.length} states' total: ${topShare.toFixed(1)}%.`,
  hasDollar && !["wheat", "soybeans"].includes(commodityKey) ? `Combined value across these ${rows.length} states: ${money(nationalDollarTotal)}.` : null,
  "",
  "What crop should we cover next? Comment below.",
  "",
  "Source: U.S. Department of Agriculture, National Agricultural Statistics Service (NASS QuickStats).",
  "Source website: https://quickstats.nass.usda.gov/",
  "Data retrieved programmatically via API.",
  "Chart created by Jeffrey Macy.",
].filter((line) => line !== null && line !== undefined && line !== false);

const lines = [
  `State ${c.label.toLowerCase()} watch (${STAMP})`, "", `USDA NASS QuickStats, ${year} ${c.label.toLowerCase()} (${c.unit}).`, "",
  `Rank | State | ${c.label} (${c.unit})${hasDollar ? " | Value ($)" : ""}`,
  hasDollar ? "---:|---|---:|---:" : "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${num(r.value)}${hasDollar ? ` | ${Number.isFinite(r.dollarValue) ? money(r.dollarValue) : "—"}` : ""}`), "",
  "Facebook post", "-------------", facebook.join("\n").replace(/\n{3,}/g, "\n\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "state", `${commodityKey}_${c.unit.replace(/[^a-z0-9]+/gi, "_")}`, ...(hasDollar ? [`${commodityKey}_value_usd`] : [])],
  rows.map((r) => [r.rank, r.state, r.value, ...(hasDollar ? [Number.isFinite(r.dollarValue) ? r.dollarValue : ""] : [])])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
