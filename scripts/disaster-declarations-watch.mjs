#!/usr/bin/env node
// FEMA disaster declarations by state and incident type over a rolling window.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const NAMES = { AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming" };
const stamp = new Date().toISOString().slice(0, 10);
const noImage = process.argv.includes("--no-image");
const years = Math.max(1, Math.min(50, Number(process.argv[process.argv.indexOf("--years") + 1]) || 10));
const outBase = path.join(SOCIAL, `disaster-declarations-watch-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function cutoff() { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); return d.toISOString(); }

async function allRows() {
  const rows = [];
  const pageSize = 1000;
  for (let skip = 0; ; skip += pageSize) {
    const qs = new URLSearchParams({
      "$filter": `declarationDate ge '${cutoff()}'`,
      "$select": "disasterNumber,state,declarationType,declarationDate,incidentType,declarationTitle,incidentBeginDate",
      "$top": String(pageSize), "$skip": String(skip), "$orderby": "declarationDate desc",
    });
    const res = await fetch(`https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?${qs}`, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
    const text = await res.text();
    if (!res.ok) throw new Error(`OpenFEMA HTTP ${res.status}: ${text.slice(0, 160)}`);
    const batch = JSON.parse(text).DisasterDeclarationsSummaries || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

const raw = await allRows();
const unique = [...new Map(raw.filter((r) => NAMES[r.state]).map((r) => [`${r.disasterNumber}-${r.state}`, r])).values()];
const byState = [...unique.reduce((m, r) => m.set(r.state, (m.get(r.state) || 0) + 1), new Map())]
  .map(([abbr, count]) => ({ abbr, state: NAMES[abbr], count })).sort((a, b) => b.count - a.count).map((r, i) => ({ ...r, rank: i + 1 }));
const byType = [...unique.reduce((m, r) => m.set(r.incidentType, (m.get(r.incidentType) || 0) + 1), new Map())]
  .map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
const az = byState.find((r) => r.abbr === "AZ");
const chartRows = [...byState.slice(0, 8), ...(az && az.rank > 8 ? [az] : [])];
const chartSVG = horizontalBarChart(chartRows.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.count, color: r.abbr === "AZ" ? C.s2 : C.s1 })), {
  fmtTick: (v) => `${Math.round(v)}`, fmtVal: (v) => `${Math.round(v)} declarations`,
});
const html = cardHTML({
  kicker: "Disaster declaration check",
  title: `Federal disaster declarations by state`,
  hero: String(unique.length),
  heroLabel: `unique state declarations; latest ${years} years`,
  chartSVG,
  source: "FEMA OpenFEMA",
  vintage: stamp,
});

const facebook = [
  `${byState[0].state} received ${byState[0].count} federal disaster declarations over the last ${years} years — more than any other state. Every state, ranked:`, "",
  `#1 ${byState[0].state}: ${byState[0].count}`,
  `#2 ${byState[1].state}: ${byState[1].count}`,
  ...(az ? [`Arizona: #${az.rank} (${az.count})`] : []),
  `Most common incident type: ${byType[0].type} (${byType[0].count})`, "",
  "This counts unique FEMA declarations within each state. It does not measure deaths, property damage, disaster severity, or federal dollars spent. Fire-management declarations are included.", "",
  "Which comparison should come next: declarations per resident, disaster type, or federal assistance dollars?", "",
  "Follow for monthly public-safety data and share this with someone who has lived through a declared disaster.",
];

const lines = [
  `Disaster declaration watch (${stamp})`, "", `Unique FEMA state declarations since ${cutoff().slice(0, 10)}: ${unique.length}.`, "",
  "Rank | State | Declarations", "---:|---|---:", ...byState.map((r) => `${r.rank} | ${r.state} | ${r.count}`),
  "", "Incident types", "", "Rank | Type | Declarations", "---:|---|---:", ...byType.map((r, i) => `${i + 1} | ${r.type} | ${r.count}`),
  "", "Most recent declarations", "", "Date | State | Type | Title | Disaster number", "---|---|---|---|---:",
  ...unique.slice().sort((a, b) => b.declarationDate.localeCompare(a.declarationDate)).slice(0, 15).map((r) => `${r.declarationDate.slice(0, 10)} | ${NAMES[r.state]} | ${r.incidentType} | ${String(r.declarationTitle).trim()} | ${r.disasterNumber}`),
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: FEMA OpenFEMA Disaster Declarations Summaries.",
  "Note: declaration counts are administrative events, not a direct measure of disaster frequency or severity.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "state_abbr", "declarations", "window_years", "window_start"], byState.map((r) => [r.rank, r.state, r.abbr, r.count, years, cutoff().slice(0, 10)])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
