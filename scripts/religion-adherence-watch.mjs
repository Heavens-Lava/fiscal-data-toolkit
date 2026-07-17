#!/usr/bin/env node
// religion-adherence-watch.mjs - formal religious congregation adherence by
// state, from the 2020 U.S. Religion Census (Association of Statisticians
// of American Religious Bodies / ARDA). No API key required — fetches the
// official published workbook directly.
//
// Important: there is no federal government dataset on religion (the Census
// Bureau is barred by law/policy from asking about religious affiliation).
// This is the closest audited-adjacent alternative — congregations
// self-report membership counts to ASARB on a fixed methodology, published
// roughly once a decade (2020, 2010, 2000, ...), not annually.
//
// Run:  node scripts/religion-adherence-watch.mjs
//       node scripts/religion-adherence-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, rankedTwoColumnHTML, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { readSheetRowsByName } from "./lib/xlsx-lite.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const SOURCE_URL = "https://www.usreligioncensus.org/sites/default/files/2023-06/2020_USRC_Summaries.xlsx";
const SOURCE_PAGE = "https://www.usreligioncensus.org/node/1639";

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function compact(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}

const topN = 15;
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `religion-adherence-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

console.log("  Fetching 2020 U.S. Religion Census state summary workbook...");
const res = await fetch(SOURCE_URL);
if (!res.ok) throw new Error(`U.S. Religion Census HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
const sheetRows = readSheetRowsByName(buf, "2020 State Summary");

const header = sheetRows[0];
const idx = (name) => header.indexOf(name);
const iState = idx("State Name"), iPop = idx("2020 Population"), iCong = idx("Congregations"),
  iAdh = idx("Adherents"), iPct = idx("Adherents as % of Population");
if ([iState, iPop, iCong, iAdh, iPct].some((i) => i < 0)) {
  throw new Error(`Expected columns not found in state summary sheet. Header: ${JSON.stringify(header)}`);
}

const rows = sheetRows.slice(1)
  .filter((r) => r[iState] && Number.isFinite(r[iPct]))
  .map((r) => ({
    name: String(r[iState]).replace(/\bOf\b/g, "of"),
    population: r[iPop],
    congregations: r[iCong],
    adherents: r[iAdh],
    pct: r[iPct] * 100,
  }))
  .filter((r) => r.name !== "United States")
  .sort((a, b) => b.pct - a.pct)
  .map((r, i) => ({ ...r, rank: i + 1 }));

if (rows.length < 40) throw new Error(`Only ${rows.length} states parsed — expected 50+DC`);

const highest = rows.slice(0, topN);
const lowest = rows.slice(-topN).reverse();
const az = rows.find((r) => r.name === "Arizona");
const totalPop = rows.reduce((s, r) => s + r.population, 0);
const totalAdh = rows.reduce((s, r) => s + r.adherents, 0);
const nationalPct = (totalAdh / totalPop) * 100;
const gap = highest[0].pct - lowest[0].pct;

const html = rankedTwoColumnHTML({
  kicker: "Religion check",
  title: "Formal religious congregation adherence by state, 2020 — highest vs. lowest",
  leftLabel: "Highest adherence rate",
  rightLabel: "Lowest adherence rate",
  leftRows: highest.map((r) => ({ name: r.name, value: r.pct })),
  rightRows: lowest.map((r) => ({ name: r.name, value: r.pct })),
  domainMin: 0,
  domainMax: 100,
  fmtVal: (v) => `${v.toFixed(0)}%`,
  source: "U.S. Religion Census 2020 (ASARB/ARDA)",
  vintage: "2020",
  showFlags: false,
});

const facebook = [
  "Religion check:",
  "",
  `Note upfront: the Census Bureau is legally barred from asking about religion, so there's no federal data here. This is the 2020 U.S. Religion Census — religious bodies self-report congregation membership to a research consortium (ASARB) on a fixed methodology, published about once a decade.`,
  "",
  `By that measure, ${highest[0].name} has the highest formal religious adherence rate — ${highest[0].pct.toFixed(0)}% of its population counted as adherents of a congregation. ${lowest[0].name} has the lowest, at ${lowest[0].pct.toFixed(0)}% — a ${gap.toFixed(0)}-point gap between the two.`,
  "",
  `Arizona: #${az.rank} of ${rows.length}, at ${az.pct.toFixed(0)}% adherence (${compact(az.adherents)} adherents across ${az.congregations.toLocaleString("en-US")} congregations).`,
  "",
  `Nationally: ${compact(totalAdh)} adherents across ${rows.reduce((s, r) => s + r.congregations, 0).toLocaleString("en-US")} congregations — about ${nationalPct.toFixed(0)}% of the population.`,
  "",
  `Caveat: "adherents" means people formally counted by a congregation (members, their children, and estimated regular participants) — not everyone who holds a religious belief identifies with a formal congregation, so this measures institutional religious affiliation, not personal belief or spirituality. The methodology has also historically undercounted some historically Black Protestant denominations and unaffiliated/nondenominational congregations relative to their true size, though 2020 improved on this. Treat this as "formal congregation membership," not a belief survey.`,
  "",
  "Real numbers, real source — U.S. Religion Census 2020, Association of Statisticians of American Religious Bodies:",
  SOURCE_PAGE,
];

const lines = [
  `Religion check (${stamp})`,
  "",
  `${rows.length} states+DC, 2020 U.S. Religion Census`,
  `Highest: ${highest[0].name} (${highest[0].pct.toFixed(1)}%) | Lowest: ${lowest[0].name} (${lowest[0].pct.toFixed(1)}%) | Gap: ${gap.toFixed(1)}pp`,
  `Arizona: #${az.rank} of ${rows.length} (${az.pct.toFixed(1)}%)`,
  `National: ${nationalPct.toFixed(1)}% adherence, ${totalAdh.toLocaleString("en-US")} adherents`,
  "",
  "Rank | State | Adherence rate (highest column)",
  "---:|---|---:",
  ...highest.map((r, i) => `${i + 1} | ${r.name} | ${r.pct.toFixed(1)}%`),
  "",
  "Rank | State | Adherence rate (lowest column)",
  "---:|---|---:",
  ...lowest.map((r, i) => `${i + 1} | ${r.name} | ${r.pct.toFixed(1)}%`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "state", "population", "congregations", "adherents", "adherence_pct"],
  rows.map((r) => [r.rank, r.name, r.population, r.congregations, r.adherents, r.pct])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) {
  const height = 210 + topN * 34 + 40 + 60;
  screenshot(`${outBase}.html`, `${outBase}.png`, { width: 1200, height });
}

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
