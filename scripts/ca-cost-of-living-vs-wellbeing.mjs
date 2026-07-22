#!/usr/bin/env node
// ca-cost-of-living-vs-wellbeing.mjs — Does California/Hawaii's high cost of
// living translate into worse poverty and mental-health outcomes than cheap
// states? Three official/audited sources, one story:
//   1. Cost of living  — BEA Regional (SASUMMARY, LineCode 13: Regional Price
//      Parity, 100 = US average)
//   2. Poverty rate    — Census ACS 1-year (Table S1701)
//   3. Depression       — CDC BRFSS (topic "Depression", question "Ever told
//      you that you have a form of depression?", break_out=Overall)
//
// Run:  node scripts/ca-cost-of-living-vs-wellbeing.mjs
//       node scripts/ca-cost-of-living-vs-wellbeing.mjs --no-image
//
// Keys: BEA_API_KEY (free: apps.bea.gov/API/signup) and CENSUS_API_KEY (free:
//       api.census.gov/data/key_signup.html) in .env. CDC's BRFSS endpoint is
//       keyless.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, esc, engagementCTA, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

try {
  for (const line of readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
} catch { /* no .env file — fall through to environment */ }

const BEA_KEY = process.env.BEA_API_KEY;
const CENSUS_KEY = process.env.CENSUS_API_KEY;
if (!BEA_KEY) { console.error("  BEA_API_KEY not set. Free key: https://apps.bea.gov/API/signup/"); process.exit(1); }
if (!CENSUS_KEY) { console.error("  CENSUS_API_KEY not set. Free key: https://api.census.gov/data/key_signup.html"); process.exit(1); }

const noImage = process.argv.includes("--no-image");
const stamp = () => new Date().toISOString().slice(0, 10);
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");

// Five-state comparison, ordered cheapest -> most expensive (BEA RPP order),
// so the same top-to-bottom order across all three panels lets the reader
// track one state's position across metrics.
const STATES = [
  { abbr: "MS", name: "Mississippi", accent: false },
  { abbr: "WV", name: "West Virginia", accent: false },
  { abbr: "US", name: "U.S. average", accent: false, isUS: true },
  { abbr: "HI", name: "Hawaii", accent: true },
  { abbr: "CA", name: "California", accent: true },
];

console.log("  Fetching BEA Regional Price Parity (cost of living)...");
const rppQs = new URLSearchParams({
  UserID: BEA_KEY, ResultFormat: "JSON", method: "GetData",
  DataSetName: "Regional", TableName: "SASUMMARY", LineCode: 13, GeoFips: "STATE", Year: "LAST5",
});
const rppRes = await fetch(`https://apps.bea.gov/api/data?${rppQs}`);
if (!rppRes.ok) throw new Error(`BEA HTTP ${rppRes.status}`);
const rppData = (await rppRes.json()).BEAAPI.Results.Data;
// BEA includes a placeholder row for the upcoming vintage (DataValue "0",
// NoteRef "(NA)...") before it's actually released — exclude those from the
// "latest year" pick or every value silently comes back as 0.
const rppYear = rppData
  .filter((r) => Number(r.DataValue) > 0)
  .reduce((a, r) => (r.TimePeriod > a ? r.TimePeriod : a), "0");
const rppByName = new Map(
  rppData.filter((r) => r.TimePeriod === rppYear).map((r) => [r.GeoName.replace(/ \*+$/, ""), Number(r.DataValue)])
);

console.log("  Fetching Census ACS poverty rate (Table S1701)...");
const povStateRes = await fetch(`https://api.census.gov/data/2024/acs/acs1/subject?get=NAME,S1701_C03_001E&for=state:*&key=${CENSUS_KEY}`);
if (!povStateRes.ok) throw new Error(`Census ACS HTTP ${povStateRes.status}`);
const povStateRows = await povStateRes.json();
const povByName = new Map(povStateRows.slice(1).map((r) => [r[0], Number(r[1])]));
const povUsRes = await fetch(`https://api.census.gov/data/2024/acs/acs1/subject?get=NAME,S1701_C03_001E&for=us:*&key=${CENSUS_KEY}`);
const povUsRow = (await povUsRes.json())[1];
const povUS = Number(povUsRow[1]);

console.log("  Fetching CDC BRFSS depression prevalence...");
const deprQs = new URLSearchParams({
  $where: "topic='Depression' AND break_out='Overall' AND response='Yes' AND year='2024' AND locationabbr in ('CA','HI','MS','WV','US')",
  $limit: "10",
});
const deprRes = await fetch(`https://data.cdc.gov/resource/dttw-5yxu.json?${deprQs}`);
if (!deprRes.ok) throw new Error(`CDC BRFSS HTTP ${deprRes.status}`);
const deprRows = await deprRes.json();
const deprByAbbr = new Map(deprRows.map((r) => [r.locationabbr, Number(r.data_value)]));
const deprYear = deprRows[0]?.year;

// ── assemble rows ────────────────────────────────────────────────────────────
const rows = STATES.map((s) => ({
  ...s,
  rpp: s.isUS ? 100 : rppByName.get(s.name),
  poverty: s.isUS ? povUS : povByName.get(s.name),
  depression: deprByAbbr.get(s.abbr),
}));
for (const r of rows) {
  if (![r.rpp, r.poverty, r.depression].every(Number.isFinite))
    throw new Error(`Missing data for ${r.name}: ${JSON.stringify(r)}`);
}

console.log("\n  State                Cost of Living   Poverty Rate   Depression Ever Dx");
console.log("  ───────────────────  ──────────────   ────────────   ────────────────────");
for (const r of rows)
  console.log(`  ${r.name.padEnd(20)}  ${r.rpp.toFixed(1).padStart(14)}   ${r.poverty.toFixed(1).padStart(11)}%   ${r.depression.toFixed(1).padStart(19)}%`);

// ── chart: 3 stacked horizontal-bar panels, same state order throughout ──────
function panel(title, points, fmtVal, fmtTick) {
  const svg = horizontalBarChart(points, { fmtTick, fmtVal });
  return `<div class="panel"><div class="panel-title">${esc(title)}</div><div class="panel-plot">${svg}</div></div>`;
}
const colorFor = (r) => (r.accent ? C.s1 : C.muted);

const panelsHTML = [
  panel("Cost of living (BEA Regional Price Parity, 100 = U.S. average)",
    rows.map((r) => ({ label: r.name, v: r.rpp, color: colorFor(r) })),
    (v) => v.toFixed(0), (v) => v.toFixed(0)),
  panel("Poverty rate (Census ACS, 2024)",
    rows.map((r) => ({ label: r.name, v: r.poverty, color: colorFor(r) })),
    (v) => `${v.toFixed(1)}%`, (v) => `${v.toFixed(0)}%`),
  panel(`Ever told they have a depressive disorder (CDC BRFSS, ${deprYear})`,
    rows.map((r) => ({ label: r.name, v: r.depression, color: colorFor(r) })),
    (v) => `${v.toFixed(1)}%`, (v) => `${v.toFixed(0)}%`),
].join("");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
body { width:1200px; background:${C.surface}; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.card { width:100%; padding:44px 48px 36px; display:flex; flex-direction:column; }
.kicker { font-size:15px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:${C.muted}; }
h1 { font-size:32px; font-weight:650; color:${C.ink}; margin-top:10px; max-width:980px; line-height:1.25; }
.sub { font-size:16px; color:${C.ink2}; margin-top:8px; max-width:980px; line-height:1.4; }
.legend { display:flex; gap:24px; margin-top:16px; }
.key { display:flex; align-items:center; gap:8px; font-size:15px; color:${C.ink2}; }
.dot { width:12px; height:12px; border-radius:50%; display:inline-block; }
.panels { margin-top:14px; }
.panel { margin-top:18px; }
.panel-title { font-size:15px; font-weight:650; color:${C.ink2}; margin-bottom:2px; }
.panel-plot svg { width:100%; display:block; }
.foot { display:flex; justify-content:space-between; font-size:14px; color:${C.muted}; margin-top:18px; }
</style></head><body><div class="card">
  <div class="kicker">Cost of living vs. well-being</div>
  <h1>High cost of living doesn't mean California and Hawaii come out worse</h1>
  <div class="sub">California and Hawaii have two of the nation's highest costs of living — yet both post lower poverty rates and lower depression rates than cheaper states like Mississippi and West Virginia.</div>
  <div class="legend">
    <span class="key"><span class="dot" style="background:${C.s1}"></span>High cost of living (CA, HI)</span>
    <span class="key"><span class="dot" style="background:${C.muted}"></span>Comparison (low-cost states + U.S.)</span>
  </div>
  <div class="panels">${panelsHTML}</div>
  <div class="foot"><span>Sources: BEA Regional Price Parities (${rppYear}) · Census ACS S1701 (2024) · CDC BRFSS (${deprYear}) · Chart: Jeff Macy</span><span>U.S. depression figure is the state median, not population-weighted</span></div>
</div></body></html>`;

const facebook = [
  `California's cost of living index is ${rows.find((r) => r.abbr === "CA").rpp.toFixed(1)} and Hawaii's is ${rows.find((r) => r.abbr === "HI").rpp.toFixed(1)} (100 = U.S. average) — among the highest in the country.`,
  "",
  `But their poverty rates (CA ${rows.find((r) => r.abbr === "CA").poverty.toFixed(1)}%, HI ${rows.find((r) => r.abbr === "HI").poverty.toFixed(1)}%) are both BELOW the national average (${povUS.toFixed(1)}%) — and well below cheap-to-live-in states like Mississippi (${rows.find((r) => r.abbr === "MS").poverty.toFixed(1)}%) and West Virginia (${rows.find((r) => r.abbr === "WV").poverty.toFixed(1)}%).`,
  "",
  `Same pattern on mental health: the share of adults ever told they have a depressive disorder is CA ${rows.find((r) => r.abbr === "CA").depression.toFixed(1)}% and HI ${rows.find((r) => r.abbr === "HI").depression.toFixed(1)}%, versus MS ${rows.find((r) => r.abbr === "MS").depression.toFixed(1)}% and WV ${rows.find((r) => r.abbr === "WV").depression.toFixed(1)}% (CDC BRFSS, ${deprYear}).`,
  "",
  "High cost of living clearly strains household budgets — but on these two federal measures, it isn't translating into more poverty or worse mental health versus the cheapest states in the country.",
  "",
  "Sources: BEA Regional Price Parities · Census ACS (Table S1701) · CDC BRFSS.",
  "",
  engagementCTA("generic", `ca-col-wellbeing-${stamp()}`),
];

mkdirSync(SOCIAL, { recursive: true });
const outBase = path.join(SOCIAL, `ca-cost-of-living-vs-wellbeing-${stamp()}`);
writeFileSync(`${outBase}.html`, html);
writeFileSync(`${outBase}.csv`, toCSV(
  ["state", "cost_of_living_rpp", "poverty_rate_pct", "depression_ever_dx_pct"],
  rows.map((r) => [r.name, r.rpp, r.poverty, r.depression])
));
writeFileSync(`${outBase}.txt`, [
  `California cost of living vs. well-being (${stamp()})`, "", "Facebook post", "-------------", facebook.join("\n"),
].join("\n"));
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`, { width: 1200, height: 1180 });

console.log("\n" + facebook.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
