#!/usr/bin/env node
// Recent FDA food recall enforcement reports, grouped by likely reason.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const stamp = new Date().toISOString().slice(0, 10);
const noImage = process.argv.includes("--no-image");
const days = Math.max(30, Math.min(730, Number(process.argv[process.argv.indexOf("--days") + 1]) || 365));
const outBase = path.join(SOCIAL, `food-recall-watch-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function dateDigits(d) { return d.toISOString().slice(0, 10).replace(/-/g, ""); }
function iso(s) { return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s; }
function clean(s, max = 110) { const x = String(s || "").replace(/\s+/g, " ").trim(); return x.length > max ? `${x.slice(0, max - 3)}...` : x; }
function reason(text) {
  const s = text.toLowerCase();
  if (/salmonella|listeria|e\. coli|pathogen|bacteria|botulis|mold/.test(s)) return "Pathogen or contamination";
  if (/undeclared|allergen|milk|peanut|tree nut|wheat|soy|egg|sesame/.test(s)) return "Undeclared allergen";
  if (/foreign material|metal|plastic|glass|wood|rubber/.test(s)) return "Foreign material";
  if (/label|misbrand|nutrition|ingredient/.test(s)) return "Labeling or misbranding";
  return "Other reason";
}

const start = new Date(); start.setUTCDate(start.getUTCDate() - days);
const query = `report_date:[${dateDigits(start)} TO ${dateDigits(new Date())}]`;
async function fetchReports() {
  const reports = [];
  for (let skip = 0; skip < 25000; skip += 1000) {
    const qs = new URLSearchParams({ search: query, sort: "report_date:desc", limit: "1000", skip: String(skip) });
    const res = await fetch(`https://api.fda.gov/food/enforcement.json?${qs}`, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
    const text = await res.text();
    if (!res.ok) throw new Error(`openFDA HTTP ${res.status}: ${text.slice(0, 180)}`);
    const page = JSON.parse(text).results || [];
    reports.push(...page);
    if (page.length < 1000) break;
  }
  return reports;
}

const reports = await fetchReports();
const rows = reports.filter((r) => r.classification === "Class I" || r.classification === "Class II").map((r) => ({
  reportDate: iso(r.report_date), classification: r.classification, product: clean(r.product_description),
  firm: clean(r.recalling_firm, 70), reason: clean(r.reason_for_recall, 180), reasonGroup: reason(r.reason_for_recall || ""),
  distribution: clean(r.distribution_pattern, 90), status: r.status, recallNumber: r.recall_number,
}));
if (!rows.length) throw new Error("No Class I or II food recall reports found in the selected window.");

const groups = [...rows.reduce((m, r) => m.set(r.reasonGroup, (m.get(r.reasonGroup) || 0) + 1), new Map())]
  .map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
const classI = rows.filter((r) => r.classification === "Class I").length;
const chartSVG = horizontalBarChart(groups.map((r, i) => ({ label: r.name, v: r.count, color: i === 0 ? C.neg : C.s1 })), {
  fmtTick: (v) => `${Math.round(v)}`, fmtVal: (v) => `${Math.round(v)} reports`,
});
const html = cardHTML({
  kicker: "Food recall watch",
  title: `Why were serious food recalls reported?`,
  hero: rows.length.toLocaleString("en-US"),
  heroLabel: `Class I and II reports; latest ${days} days`,
  chartSVG,
  source: "FDA openFDA enforcement reports",
  vintage: rows[0].reportDate,
});

const facebook = [
  `What caused the most serious food recall reports over the last ${days} days?`, "",
  `Class I and II enforcement reports: ${rows.length.toLocaleString("en-US")}`,
  `Class I, the highest FDA hazard classification: ${classI.toLocaleString("en-US")}`,
  `Most common reason group: ${groups[0].name} (${groups[0].count})`, "",
  `Most recent report: ${rows[0].product} (${rows[0].classification}, ${rows[0].reportDate}).`, "",
  "An FDA enforcement report is not the same as a count of unique products or packages, and a listed recall may already be completed or terminated. Check FDA notices and the product label before acting.", "",
  "Which category should I track separately: allergens, pathogens, foreign material, or baby food?", "",
  "Follow for weekly recall checks and share this with someone who checks food labels.",
];

const lines = [
  `Food recall watch (${stamp})`, "", `Class I and II FDA enforcement reports from ${iso(dateDigits(start))} through ${stamp}.`, "",
  "Reason group | Reports", "---|---:", ...groups.map((r) => `${r.name} | ${r.count}`),
  "", "Most recent reports", "",
  "Report date | Class | Product | Firm | Reason group | Status | Recall number",
  "---|---|---|---|---|---|---",
  ...rows.slice(0, 20).map((r) => `${r.reportDate} | ${r.classification} | ${r.product} | ${r.firm} | ${r.reasonGroup} | ${r.status} | ${r.recallNumber}`),
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: FDA openFDA Food Enforcement Reports API.",
  "Note: classifications describe relative health hazard; report records should not be treated as real-time shelf availability.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["report_date", "classification", "product", "recalling_firm", "reason_group", "reason", "distribution", "status", "recall_number"], rows.map((r) => [r.reportDate, r.classification, r.product, r.firm, r.reasonGroup, r.reason, r.distribution, r.status, r.recallNumber])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
