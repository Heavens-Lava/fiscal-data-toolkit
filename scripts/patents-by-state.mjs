#!/usr/bin/env node
// patents-by-state.mjs — granted U.S. patents by inventor state for a given
// year, ranked by raw count and by patents per 100,000 residents.
//
// Source: USPTO Open Data Portal Patent File Wrapper API (api.uspto.gov) —
// requires a free API key (identity-verified via ID.me at data.uspto.gov/myodp,
// unlike most other keys in this toolkit). Population for the per-capita rate
// comes from Census PEP (same source/pattern as state-population-watch.mjs).
//
// Run:
//   node scripts/patents-by-state.mjs
//   node scripts/patents-by-state.mjs --year 2024
//   node scripts/patents-by-state.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, engagementCTA, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, STATES, argValue, censusRows, envValue, num, rel } from "./lib/data-common.mjs";

const uspto = envValue("USPTO_API_KEY");
if (!uspto) throw new Error("Missing USPTO_API_KEY in .env. Get one at https://data.uspto.gov/myodp (requires ID.me identity verification).");
const censusKey = envValue("CENSUS_API_KEY");
const year = Number(argValue("--year", String(new Date().getFullYear() - 1)));
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `patents-by-state-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function patentCount(stateAbbr, attempt = 0) {
  // Quote the state code — otherwise Oregon's "OR" abbreviation is parsed as
  // the Lucene boolean OR operator instead of a literal value, silently
  // returning zero results for that one state.
  const q = `applicationMetaData.inventorBag.correspondenceAddressBag.geographicRegionCode:"${stateAbbr}" AND applicationMetaData.grantDate:[${year}-01-01 TO ${year}-12-31]`;
  const url = `https://api.uspto.gov/api/v1/patent/applications/search?q=${encodeURIComponent(q)}&limit=1`;
  const res = await fetch(url, { headers: { "X-Api-Key": uspto, Accept: "application/json" } });
  if (res.status === 404) return 0; // "no matching records" — a real zero, not an error
  if (res.status === 429 && attempt < 5) { await sleep(1000 * (attempt + 1)); return patentCount(stateAbbr, attempt + 1); }
  const text = await res.text();
  if (!res.ok) throw new Error(`USPTO API HTTP ${res.status} for ${stateAbbr}: ${text.slice(0, 200)}`);
  return JSON.parse(text).count || 0;
}

// Small sequential batches with a pause between them — the API rate-limits
// aggressively enough that 8-wide concurrency triggers 429s.
async function mapBatched(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
    if (i + size < items.length) await sleep(400);
  }
  return out;
}

console.log(`Fetching granted-patent counts by state for ${year} (51 queries)...`);
const counts = await mapBatched(STATES, 3, (s) => patentCount(s.abbr));
const rows = STATES.map((s, i) => ({ ...s, patents: counts[i] }));

let population = new Map();
if (censusKey) {
  for (const vintage of [2023, 2022, 2021]) {
    try {
      const body = await censusRows(vintage, "pep/charv", ["POP", "YEAR", "MONTH"], "state:*", censusKey);
      const julyRows = body.filter((r) => r.MONTH === "7");
      if (julyRows.length) { population = new Map(julyRows.map((r) => [r.state, Number(r.POP)])); break; }
    } catch { /* try prior vintage */ }
  }
}
for (const r of rows) {
  const pop = population.get(r.fips);
  r.per100k = pop ? (r.patents / pop) * 100000 : null;
}

const totalPatents = rows.reduce((s, r) => s + r.patents, 0);
const byCount = [...rows].sort((a, b) => b.patents - a.patents);
const byPerCapita = population.size ? [...rows].filter((r) => r.per100k !== null).sort((a, b) => b.per100k - a.per100k) : [];
const top10 = byCount.slice(0, 10);
const leader = byCount[0];

const chartSVG = horizontalBarChart(
  top10.map((r) => ({ label: r.name, v: r.patents, color: C.s1 })),
  { fmtTick: (v) => num(v), fmtVal: (v) => num(v) }
);

const perCapitaLeader = byPerCapita[0];
const title = perCapitaLeader
  ? `${perCapitaLeader.name} patents more per person than any other state`
  : `Which states invent the most? Granted U.S. patents, ${year}`;
const html = cardHTML({
  kicker: "Patents by state",
  title,
  hero: num(leader.patents),
  heroLabel: `${leader.name} — most granted patents in ${year}`,
  chartSVG,
  source: "USPTO Open Data Portal",
  vintage: String(year),
});

const facebook = [
  ...(perCapitaLeader ? [
    `${perCapitaLeader.name} produced the most granted patents per resident in ${year} — ${perCapitaLeader.per100k.toFixed(1)} per 100,000 people — even though California dominates the raw count (it's just bigger):`,
  ] : [`Which U.S. states invent the most? Granted patents by inventor's home state, ${year}:`]),
  "",
  ...top10.map((r, i) => `${i + 1}. ${r.name}: ${num(r.patents)} patents`),
  "",
  `Total across all states + DC: ${num(totalPatents)} granted patents in ${year}.`,
  "",
  "Counted by the grant date and the inventor's listed home state/territory (not the assignee company's headquarters) — a patent with inventors in multiple states counts toward each.",
  "",
  engagementCTA("ranking", "patents-by-state"),
  "",
  "Source website: https://data.uspto.gov/myodp",
  "Information retrieved programmatically via API.",
  "Graph made by Jeffrey Macy.",
];

const lines = [
  `Patents by state (${STAMP}) — granted U.S. patents, ${year}`, "",
  "Rank | State | Patents" + (byPerCapita.length ? " | Per 100k residents" : ""),
  "---:|---|---:" + (byPerCapita.length ? "|---:" : ""),
  ...byCount.map((r, i) => `${i + 1} | ${r.name} | ${num(r.patents)}` + (byPerCapita.length ? ` | ${r.per100k !== null ? r.per100k.toFixed(1) : "n/a"}` : "")),
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: USPTO Open Data Portal, Patent File Wrapper API (https://data.uspto.gov/myodp). Population: U.S. Census Bureau Population Estimates Program.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "state", "abbr", "patents", "per_100k"],
  byCount.map((r, i) => [i + 1, r.name, r.abbr, r.patents, r.per100k !== null ? r.per100k.toFixed(2) : ""])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
