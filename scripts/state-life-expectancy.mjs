#!/usr/bin/env node
// State life expectancy ranking from NCHS U.S. State Life Tables, 2021.
//
// Run:  node scripts/state-life-expectancy.mjs
//       node scripts/state-life-expectancy.mjs --top 10 --exclude-dc

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const VINTAGE = "2021";
const SOURCE = "CDC/NCHS, U.S. State Life Tables, 2021";

const DATA = [
  ["California", 78.3, 75.3, 81.4],
  ["Hawaii", 79.9, 77.0, 83.1],
  ["New York", 79.0, 76.3, 81.6],
  ["Minnesota", 78.8, 76.3, 81.4],
  ["Massachusetts", 79.6, 76.9, 82.2],
  ["Connecticut", 79.2, 76.3, 82.0],
  ["New Jersey", 79.0, 76.3, 81.6],
  ["Washington", 78.2, 75.8, 80.8],
  ["Colorado", 77.7, 75.0, 80.6],
  ["Vermont", 78.4, 75.7, 81.2],
  ["Utah", 78.2, 76.3, 80.2],
  ["Oregon", 77.4, 74.8, 80.2],
  ["Idaho", 77.2, 74.8, 79.7],
  ["Rhode Island", 78.5, 75.9, 81.0],
  ["New Hampshire", 78.5, 76.1, 81.1],
  ["Wisconsin", 77.8, 75.2, 80.5],
  ["Nebraska", 77.8, 75.4, 80.3],
  ["Virginia", 76.8, 74.2, 79.4],
  ["Iowa", 77.7, 75.2, 80.4],
  ["Illinois", 77.1, 74.2, 80.0],
  ["Florida", 76.1, 73.1, 79.3],
  ["North Dakota", 77.6, 75.0, 80.5],
  ["Arizona", 75.0, 72.0, 78.3],
  ["Texas", 75.4, 72.7, 78.3],
  ["Maryland", 77.2, 74.3, 79.9],
  ["Montana", 75.8, 73.1, 78.8],
  ["South Dakota", 76.6, 74.1, 79.3],
  ["Maine", 76.7, 73.8, 79.8],
  ["Pennsylvania", 76.4, 73.6, 79.3],
  ["Kansas", 76.0, 73.4, 78.7],
  ["Delaware", 76.3, 73.3, 79.4],
  ["Nevada", 75.1, 72.4, 78.2],
  ["Michigan", 75.7, 72.9, 78.6],
  ["District of Columbia", 75.3, 71.9, 78.5],
  ["Alaska", 74.5, 72.2, 77.3],
  ["Wyoming", 75.0, 72.5, 77.7],
  ["North Carolina", 74.9, 72.0, 77.9],
  ["Georgia", 74.3, 71.6, 77.1],
  ["Indiana", 74.6, 71.8, 77.5],
  ["Ohio", 74.5, 71.7, 77.5],
  ["Missouri", 74.6, 71.6, 77.8],
  ["New Mexico", 73.0, 69.4, 77.0],
  ["South Carolina", 73.5, 70.4, 76.7],
  ["Oklahoma", 72.7, 70.0, 75.6],
  ["Arkansas", 72.5, 69.7, 75.6],
  ["Louisiana", 72.2, 68.8, 75.9],
  ["Tennessee", 72.4, 69.4, 75.5],
  ["Kentucky", 72.3, 69.6, 75.3],
  ["Alabama", 72.0, 68.9, 75.3],
  ["West Virginia", 71.0, 68.1, 74.2],
  ["Mississippi", 70.9, 67.7, 74.3],
];

const US = { state: "U.S.", life: 76.4, male: 73.5, female: 79.3, gap: 5.8 };

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function years(n) {
  return `${n.toFixed(1)} yrs`;
}

const noImage = process.argv.includes("--no-image");
const includeDc = !process.argv.includes("--exclude-dc");
const topN = Math.max(5, Math.min(20, Number(argValue("--top", "10")) || 10));
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `state-life-expectancy-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const rows = DATA
  .map(([state, life, male, female]) => ({ state, life, male, female, gap: female - male }))
  .filter((r) => includeDc || r.state !== "District of Columbia")
  .sort((a, b) => b.life - a.life)
  .map((r, i) => ({ ...r, rank: i + 1 }));

const highest = rows.slice(0, topN);
const lowest = rows.slice(-5).reverse();
const az = rows.find((r) => r.state === "Arizona");

const chartRows = [
  ...highest.slice(0, 5),
  { ...US, rank: "U.S.", us: true },
  ...lowest.slice().reverse(),
];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({
    label: r.us ? "U.S." : `#${r.rank} ${r.state}`,
    v: r.life,
    color: r.us ? C.s2 : C.s1,
  })),
  { fmtTick: (v) => v.toFixed(0), fmtVal: years }
);

const hero = highest[0];
const html = cardHTML({
  kicker: "Life expectancy check",
  title: "Which states have the longest life expectancy?",
  hero: years(hero.life),
  heroLabel: `${hero.state}, life expectancy at birth`,
  chartSVG,
  source: SOURCE,
  vintage: VINTAGE,
});

const facebook = [
  "Where you live is associated with a 9-year life-expectancy gap.",
  "",
  `#1 ${hero.state}: ${years(hero.life)}`,
  `U.S.: ${years(US.life)}`,
  ...(az ? [`Arizona: #${az.rank} (${years(az.life)}).`] : []),
  `#${lowest[0].rank} ${lowest[0].state}: ${years(lowest[0].life)}`,
  "",
  `Difference between highest and lowest: ${(hero.life - lowest[0].life).toFixed(1)} years.`,
  "",
  `These are NCHS ${VINTAGE} life-expectancy-at-birth estimates, not a prediction for any individual. The state tables are official but published with a lag.`,
  "",
  "What state comparison should I add next: preventable deaths, health coverage, income, or rural access to care?",
  "",
  "Follow for more state rankings built from public data, and share this if the 9-year gap surprised you.",
];

const lines = [
  `State life expectancy check (${stamp})`,
  "",
  `Metric: life expectancy at birth. Vintage: NCHS ${VINTAGE}.`,
  "",
  "Rank | State | Life expectancy | Male | Female | Female-male gap",
  "---:|---|---:|---:|---:|---:",
  ...highest.map((r) => `${r.rank} | ${r.state} | ${years(r.life)} | ${years(r.male)} | ${years(r.female)} | ${years(r.gap)}`),
  `U.S. | U.S. | ${years(US.life)} | ${years(US.male)} | ${years(US.female)} | ${years(US.gap)}`,
  "",
  "Lowest states",
  "",
  "Rank | State | Life expectancy | Male | Female | Female-male gap",
  "---:|---|---:|---:|---:|---:",
  ...lowest.map((r) => `${r.rank} | ${r.state} | ${years(r.life)} | ${years(r.male)} | ${years(r.female)} | ${years(r.gap)}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
  "",
  "Source: CDC/NCHS National Vital Statistics Reports, U.S. State Life Tables, 2021, Table A.",
  "Note: NCHS state life tables are published with a lag; this is the latest state table verified when this script was built.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "state", "life_expectancy_at_birth", "male", "female", "female_male_gap", "vintage"],
  rows.map((r) => [r.rank, r.state, r.life, r.male, r.female, r.gap.toFixed(1), VINTAGE])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
