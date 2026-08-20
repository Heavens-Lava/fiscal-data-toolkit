#!/usr/bin/env node
// childcare-vs-tuition-watch.mjs — "In which states does a year of infant
// daycare cost more than a year of in-state public university tuition?"
// DOL National Database of Childcare Prices (infant, center-based) vs.
// College Scorecard's enrollment-weighted average in-state tuition at
// public, bachelor's-predominant institutions, by state.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { readFirstSheetRows } from "./lib/xlsx-lite.mjs";
import { SOCIAL, STAMP, STATES, envValue, money, rel } from "./lib/data-common.mjs";

const scorecardKey = envValue("COLLEGE_SCORECARD_API_KEY") || "DEMO_KEY";
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `childcare-vs-tuition-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

// ── Childcare: DOL National Database of Childcare Prices, same workbook
// and parsing already verified working in family-cost-watch.mjs. ─────────
const workbookUrl = "https://www.dol.gov/sites/dolgov/files/WB/NDCP2022-state-level-estimates-and-rankings.xlsx";
const workbookRes = await fetch(workbookUrl, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
if (!workbookRes.ok) throw new Error(`DOL workbook HTTP ${workbookRes.status}`);
const sheet = readFirstSheetRows(Buffer.from(await workbookRes.arrayBuffer()));
const [header, ...body] = sheet;
const idx = Object.fromEntries(header.map((name, i) => [String(name).trim(), i]));
const childcareYear = Math.max(...body.map((r) => Number(r[idx.STUDYYEAR])).filter(Number.isFinite));
const childcareByState = new Map(
  body.filter((r) => Number(r[idx.STUDYYEAR]) === childcareYear && r[idx.TYPE] === "Center")
    .map((r) => ({ state: r[idx.STATE_NAME], infantWeekly: Number(r[idx.MEDIAN_INFANT_PRICE]) }))
    .filter((r) => r.infantWeekly > 0)
    .map((r) => [r.state, r.infantWeekly * 52])
);

// ── Tuition: College Scorecard, public + bachelor's-predominant
// institutions, enrollment-weighted average in-state tuition per state. ──
const abbrToName = new Map(STATES.map((s) => [s.abbr, s.name]));
const tuitionSumByAbbr = new Map();
const tuitionWeightByAbbr = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page = 0;
for (;;) {
  const qs = new URLSearchParams({
    api_key: scorecardKey,
    "school.ownership": "1", // public
    "school.degrees_awarded.predominant": "3", // bachelor's-predominant
    fields: "school.state,latest.cost.tuition.in_state,latest.student.size",
    per_page: "100", page: String(page),
  });
  let res, attempt = 0;
  for (;;) {
    res = await fetch(`https://api.data.gov/ed/collegescorecard/v1/schools?${qs}`);
    if (res.status !== 429) break;
    attempt++;
    if (attempt > 5) throw new Error("College Scorecard HTTP 429 (rate limited) after 5 retries -- consider registering a free api.data.gov key instead of DEMO_KEY.");
    await sleep(2000 * attempt);
  }
  if (!res.ok) throw new Error(`College Scorecard HTTP ${res.status}`);
  const json = await res.json();
  const results = json.results || [];
  for (const r of results) {
    const tuition = r["latest.cost.tuition.in_state"];
    const size = r["latest.student.size"];
    const st = r["school.state"];
    if (!st || !Number.isFinite(tuition) || !Number.isFinite(size) || size <= 0) continue;
    tuitionSumByAbbr.set(st, (tuitionSumByAbbr.get(st) || 0) + tuition * size);
    tuitionWeightByAbbr.set(st, (tuitionWeightByAbbr.get(st) || 0) + size);
  }
  const total = json.metadata?.total ?? 0;
  page++;
  if (page * 100 >= total || !results.length) break;
  await sleep(1500);
}
const tuitionByState = new Map();
for (const [abbr, sum] of tuitionSumByAbbr) {
  const weight = tuitionWeightByAbbr.get(abbr);
  const name = abbrToName.get(abbr);
  if (name && weight > 0) tuitionByState.set(name, sum / weight);
}

const rows = [...childcareByState.entries()]
  .map(([state, annualChildcare]) => {
    const tuition = tuitionByState.get(state);
    if (!Number.isFinite(tuition)) return null;
    return { state, annualChildcare, tuition, gap: annualChildcare - tuition };
  })
  .filter(Boolean)
  .sort((a, b) => b.gap - a.gap)
  .map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error("No matched childcare/tuition rows.");

const childcareCostsMore = rows.filter((r) => r.gap > 0);
const top = rows.slice(0, 5);
const bottom = rows.slice(-5).reverse();
const az = rows.find((r) => r.state === "Arizona");

const chartRows = [...top, ...bottom.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.gap, color: r.gap > 0 ? C.neg : C.s1 })),
  { fmtTick: (v) => `$${Math.round(v / 1000)}k`, fmtVal: money }
);

const html = cardHTML({
  kicker: "Childcare vs. tuition check",
  title: "In which states does a year of daycare cost more than a year of college?",
  hero: `${childcareCostsMore.length}/${rows.length}`,
  heroLabel: "states where infant daycare costs more than in-state public tuition",
  chartSVG, source: "U.S. DOL NDCP vs. College Scorecard", vintage: String(childcareYear),
});

const facebook = [
  `In ${childcareCostsMore.length} of ${rows.length} states, a year of center-based infant daycare costs more than a year of in-state tuition at a public university. In ${top[0].state}, daycare runs ${money(top[0].annualChildcare)}/year versus ${money(top[0].tuition)}/year for tuition — a ${money(Math.abs(top[0].gap))} gap.`,
  "",
  `Method: DOL's median weekly infant center-based childcare price (×52) vs. an enrollment-weighted average of in-state tuition at public, bachelor's-predominant colleges and universities in each state (College Scorecard).`,
  "",
  "Biggest childcare-over-tuition gaps:", ...top.map((r) => `#${r.rank} ${r.state}: ${money(r.annualChildcare)} daycare vs. ${money(r.tuition)} tuition (${r.gap > 0 ? "+" : ""}${money(r.gap)})`), "",
  "Smallest gaps (or tuition costs more):", ...bottom.map((r) => `#${r.rank} ${r.state}: ${money(r.annualChildcare)} daycare vs. ${money(r.tuition)} tuition (${r.gap > 0 ? "+" : ""}${money(r.gap)})`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${money(az.annualChildcare)} daycare vs. ${money(az.tuition)} tuition.` : "",
  "",
  `This comparison includes ${rows.length} states with complete matched DOL childcare and College Scorecard tuition data. It compares one specific childcare type (center-based, one infant) against public in-state tuition only -- it excludes room and board, textbooks, and other college costs, and doesn't account for childcare subsidies, financial aid, or scholarships either side might actually receive.`,
  "",
  "Sources: U.S. Department of Labor National Database of Childcare Prices; U.S. Department of Education College Scorecard.",
].filter(Boolean);

const lines = [
  `Childcare vs. tuition watch (${STAMP})`, "",
  `DOL NDCP ${childcareYear} median weekly infant center-based childcare price (x52) vs. College Scorecard enrollment-weighted average in-state public tuition, by state.`, "",
  "Rank | State | Annual infant daycare | Avg in-state public tuition | Gap (daycare minus tuition)",
  "---:|---|---:|---:|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${money(r.annualChildcare)} | ${money(r.tuition)} | ${r.gap > 0 ? "+" : ""}${money(r.gap)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "state", "annual_infant_daycare", "avg_instate_public_tuition", "gap"],
  rows.map((r) => [r.rank, r.state, r.annualChildcare, r.tuition.toFixed(0), r.gap.toFixed(0)])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
