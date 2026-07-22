#!/usr/bin/env node
// patents-by-company.mjs — which companies hold the most granted U.S.
// patents in a given year? Same USPTO Open Data Portal API and key as
// patents-by-state.mjs, filtered by assignee/applicant name instead of
// inventor state.
//
// Methodology note: the API has no "group by assignee" aggregation, so this
// checks a curated list of ~20 major global patent filers (verified against
// the database beforehand) rather than scanning every applicant in the
// dataset — it's "the leader among companies we checked," not a claim to
// have found literally the #1 patent recipient in America. The Facebook
// caption says this explicitly.
//
// Run:
//   node scripts/patents-by-company.mjs
//   node scripts/patents-by-company.mjs --year 2024
//   node scripts/patents-by-company.mjs --no-image

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, engagementCTA, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function getUsptoKey() {
  if (process.env.USPTO_API_KEY) return process.env.USPTO_API_KEY;
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^USPTO_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}
function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function num(n) { return Math.round(n).toLocaleString("en-US"); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// name: display label. query: verified assignee-name prefix as filed with
// USPTO (checked against the live database — company legal names and filing
// subsidiaries, e.g. Microsoft/Ford/Amazon/GM file under a distinct IP
// holding subsidiary, not the parent brand name).
const COMPANIES = [
  { name: "Samsung Electronics", query: "Samsung Electronics" },
  { name: "IBM", query: "International Business Machines" },
  { name: "Qualcomm", query: "Qualcomm Incorporated" },
  { name: "TSMC", query: "Taiwan Semiconductor Manufacturing" },
  { name: "Apple", query: "Apple Inc" },
  { name: "LG Electronics", query: "LG Electronics" },
  { name: "Huawei", query: "Huawei Technologies" },
  { name: "Canon", query: "Canon Kabushiki" },
  { name: "Google", query: "Google LLC" },
  { name: "Micron", query: "Micron Technology" },
  { name: "Toyota", query: "Toyota Jidosha" },
  { name: "Intel", query: "Intel Corporation" },
  { name: "Microsoft", query: "Microsoft Technology Licensing" },
  { name: "Sony", query: "Sony Group" },
  { name: "Amazon", query: "Amazon Technologies" },
  { name: "Hyundai / Kia", query: "Hyundai Motor" },
  { name: "Ford", query: "Ford Global Technologies" },
  { name: "GM", query: "GM Global Technology" },
  { name: "Meta", query: "Meta Platforms" },
  { name: "Boeing", query: "The Boeing Company" },
  { name: "General Electric", query: "General Electric" },
];

const uspto = getUsptoKey();
if (!uspto) throw new Error("Missing USPTO_API_KEY in .env. Get one at https://data.uspto.gov/myodp (requires ID.me identity verification).");
const year = Number(argValue("--year", String(new Date().getFullYear() - 1)));
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `patents-by-company-${localDateStamp()}`);
mkdirSync(SOCIAL, { recursive: true });

async function patentCount(query, attempt = 0) {
  const q = `applicationMetaData.applicantBag.applicantNameText:"${query}*" AND applicationMetaData.grantDate:[${year}-01-01 TO ${year}-12-31]`;
  const url = `https://api.uspto.gov/api/v1/patent/applications/search?q=${encodeURIComponent(q)}&limit=1`;
  const res = await fetch(url, { headers: { "X-Api-Key": uspto, Accept: "application/json" } });
  if (res.status === 404) return 0;
  if (res.status === 429 && attempt < 5) { await sleep(1000 * (attempt + 1)); return patentCount(query, attempt + 1); }
  const text = await res.text();
  if (!res.ok) throw new Error(`USPTO API HTTP ${res.status} for ${query}: ${text.slice(0, 200)}`);
  return JSON.parse(text).count || 0;
}

async function mapBatched(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
    if (i + size < items.length) await sleep(400);
  }
  return out;
}

console.log(`Fetching granted-patent counts for ${COMPANIES.length} major companies, ${year}...`);
const counts = await mapBatched(COMPANIES, 3, (c) => patentCount(c.query));
const rows = COMPANIES.map((c, i) => ({ ...c, patents: counts[i] })).sort((a, b) => b.patents - a.patents);
const leader = rows[0];
const top10 = rows.slice(0, 10);

const chartSVG = horizontalBarChart(
  top10.map((r) => ({ label: r.name, v: r.patents, color: C.s1 })),
  { fmtTick: (v) => num(v), fmtVal: (v) => num(v) }
);

const runnerUp = top10[1];
const leadMultiple = runnerUp ? leader.patents / runnerUp.patents : null;
const html = cardHTML({
  kicker: "Patents by company",
  title: leadMultiple
    ? `${leader.name} out-patented every other major company in ${year}`
    : `Which companies patent the most? ${year}`,
  hero: num(leader.patents),
  heroLabel: `${leader.name} — most granted patents among companies tracked`,
  chartSVG,
  source: "USPTO Open Data Portal",
  vintage: String(year),
});

const facebook = [
  leadMultiple
    ? `${leader.name} was granted ${num(leader.patents)} U.S. patents in ${year} — ${((leadMultiple - 1) * 100).toFixed(0)}% more than #2 (${runnerUp.name}, ${num(runnerUp.patents)}). Here's how the top patent filers stack up:`
    : `Which companies hold the most U.S. patents? Granted patents in ${year}, among ${COMPANIES.length} major global filers:`,
  "",
  ...top10.map((r, i) => `${i + 1}. ${r.name}: ${num(r.patents)} patents`),
  "",
  `This checks a curated list of major global companies known for heavy patent filing — not every applicant in the database, so it's "the leader among companies we tracked," not a claim to have scanned literally every assignee in America.`,
  "",
  "Counted by grant date and the applicant/assignee name on file — some companies file through IP-holding subsidiaries (e.g. Ford through \"Ford Global Technologies,\" Microsoft through \"Microsoft Technology Licensing\") rather than the parent brand name.",
  "",
  engagementCTA("ranking", "patents-by-company"),
  "",
  "Source website: https://data.uspto.gov/myodp",
  "Information retrieved programmatically via API.",
  "Graph made by Jeffrey Macy.",
];

const lines = [
  `Patents by company (${localDateStamp()}) — granted U.S. patents, ${year}`, "",
  "Rank | Company | Patents",
  "---:|---|---:",
  ...rows.map((r, i) => `${i + 1} | ${r.name} | ${num(r.patents)}`),
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: USPTO Open Data Portal, Patent File Wrapper API (https://data.uspto.gov/myodp). Curated list of major companies, not an exhaustive scan of all assignees.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "company", "assignee_query", "patents"],
  rows.map((r, i) => [i + 1, r.name, r.query, r.patents])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
