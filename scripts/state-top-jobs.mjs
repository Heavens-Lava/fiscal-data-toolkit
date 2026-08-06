#!/usr/bin/env node
// state-top-jobs.mjs — top-paying occupations in a given state, from BLS OEWS
// (Occupational Employment and Wage Statistics), state-area series. No API key.
//
// Run:  node scripts/state-top-jobs.mjs --state UT
//       node scripts/state-top-jobs.mjs --state AZ --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, engagementCTA, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

// A fixed, curated cross-section (medicine, finance, law, tech, management) —
// not exhaustive, but a consistent, repeatable set across any state so runs
// are comparable to each other.
const OCCUPATIONS = {
  "291215": "Family Medicine Physicians",
  "113031": "Financial Managers",
  "231011": "Lawyers",
  "151252": "Software Developers",
  "111021": "General/Operations Managers",
  "151244": "Network/Computer Systems Admins",
};

const STATE_FIPS7 = {
  AL: "0100000", AK: "0200000", AZ: "0400000", AR: "0500000", CA: "0600000", CO: "0800000",
  CT: "0900000", DE: "1000000", DC: "1100000", FL: "1200000", GA: "1300000", HI: "1500000",
  ID: "1600000", IL: "1700000", IN: "1800000", IA: "1900000", KS: "2000000", KY: "2100000",
  LA: "2200000", ME: "2300000", MD: "2400000", MA: "2500000", MI: "2600000", MN: "2700000",
  MS: "2800000", MO: "2900000", MT: "3000000", NE: "3100000", NV: "3200000", NH: "3300000",
  NJ: "3400000", NM: "3500000", NY: "3600000", NC: "3700000", ND: "3800000", OH: "3900000",
  OK: "4000000", OR: "4100000", PA: "4200000", RI: "4400000", SC: "4500000", SD: "4600000",
  TN: "4700000", TX: "4800000", UT: "4900000", VT: "5000000", VA: "5100000", WA: "5300000",
  WV: "5400000", WI: "5500000", WY: "5600000",
};
const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function stamp() {
  return new Date().toISOString().slice(0, 10);
}
function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}
function money(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

const abbr = String(argValue("--state", "AZ")).toUpperCase();
const fips7 = STATE_FIPS7[abbr];
const stateName = STATE_NAMES[abbr];
if (!fips7) {
  console.error(`Unknown --state "${abbr}". Use a two-letter state abbreviation, e.g. --state UT.`);
  process.exit(1);
}
const noImage = process.argv.includes("--no-image");

console.log(`Fetching BLS OEWS state wage data for ${stateName}...`);
const ids = Object.keys(OCCUPATIONS).map((soc) => `OEUS${fips7}000000${soc}13`);
const res = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ seriesid: ids, startyear: "2025", endyear: "2025" }),
});
if (!res.ok) throw new Error(`BLS API HTTP ${res.status}`);
const json = await res.json();
if (json.status !== "REQUEST_SUCCEEDED") throw new Error((json.message || [json.status]).join("; "));

const rows = json.Results.series
  .map((s) => {
    const soc = s.seriesID.slice(17, 23);
    const value = s.data?.[0]?.value;
    return value ? { soc, label: OCCUPATIONS[soc], wage: Number(value) } : null;
  })
  .filter(Boolean)
  .sort((a, b) => b.wage - a.wage);

if (!rows.length) throw new Error(`No BLS OEWS data returned for ${stateName} — series may not be published at this area/occupation combination.`);

const top = rows[0];
const chartSVG = horizontalBarChart(
  rows.map((r, i) => ({ label: r.label, v: r.wage, color: i === 0 ? C.s2 : C.s1 })),
  { fmtTick: (v) => `$${Math.round(v / 1000)}k`, fmtVal: money }
);

const html = cardHTML({
  kicker: "State job market check",
  title: `Top-paying jobs in ${stateName}`,
  hero: money(top.wage),
  heroLabel: `${top.label} · median annual wage, 2025`,
  chartSVG,
  source: "BLS Occupational Employment and Wage Statistics (OEWS)",
  vintage: "2025",
});

const facebook = [
  `In ${stateName}, ${top.label.toLowerCase()} have the highest median pay of this group: ${money(top.wage)}/year.`,
  "",
  `Full lineup: ${rows.map((r) => `${r.label} ${money(r.wage)}`).join(", ")}.`,
  "",
  "Source: BLS Occupational Employment and Wage Statistics, 2025 state estimates.",
  "",
  engagementCTA("cost", `${slug(abbr)}-top-jobs-${stamp()}`),
];

const lines = [
  `Top-paying jobs in ${stateName} (${stamp()})`,
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
  "",
  "Data table",
  "----------",
  "Occupation | Median annual wage | State",
  "---|---:|---",
  ...rows.map((r) => `${r.label} | ${money(r.wage)} | ${stateName}`),
  "",
  "Source: BLS OEWS, 2025 state estimates.",
];

const outBase = path.join(SOCIAL, `state-top-jobs-${slug(abbr)}-${stamp()}`);
mkdirSync(SOCIAL, { recursive: true });
writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["occupation", "median_annual_wage", "state"], rows.map((r) => [r.label, r.wage, stateName])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
