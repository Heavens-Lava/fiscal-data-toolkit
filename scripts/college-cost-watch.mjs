#!/usr/bin/env node
// college-cost-watch.mjs - among the largest US colleges by enrollment, what
// does it actually cost, how much debt do graduates carry, and what do they
// earn 10 years later. Dept. of Education College Scorecard. Needs a free
// api.data.gov key (same one as campaign-finance-watch.mjs / crime-trend-watch.mjs)
// — sign up at https://api.data.gov/signup/ and set FEC_API_KEY in .env.
//
// Run:  node scripts/college-cost-watch.mjs
//       node scripts/college-cost-watch.mjs --min-size 10000
//       node scripts/college-cost-watch.mjs --no-image

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function getKey() {
  if (process.env.FEC_API_KEY) return process.env.FEC_API_KEY;
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^FEC_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function money(n) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

const key = getKey();
if (!key) {
  console.error("Missing College Scorecard key. Get a free key at https://api.data.gov/signup/ and set FEC_API_KEY in .env.");
  process.exit(1);
}

const minSize = Number(argValue("--min-size", "20000"));
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `college-cost-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const fields = [
  "school.name", "school.state",
  "latest.student.size",
  "latest.cost.tuition.in_state",
  "latest.cost.tuition.out_of_state",
  "latest.aid.median_debt.completers.overall",
  "latest.earnings.10_yrs_after_entry.median",
].join(",");

const qs = new URLSearchParams({
  api_key: key,
  "school.operating": "1",
  "school.degrees_awarded.predominant": "3", // predominantly bachelor's-degree-granting
  fields,
  per_page: "100",
  sort: "latest.student.size:desc",
});
const res = await fetch(`https://api.data.gov/ed/collegescorecard/v1/schools?${qs}`);
const text = await res.text();
if (!res.ok) throw new Error(`College Scorecard HTTP ${res.status}: ${text.slice(0, 300)}`);
const json = JSON.parse(text);

const rows = json.results
  .map((r) => ({
    name: r["school.name"],
    state: r["school.state"],
    size: r["latest.student.size"],
    tuitionIn: r["latest.cost.tuition.in_state"],
    tuitionOut: r["latest.cost.tuition.out_of_state"],
    debt: r["latest.aid.median_debt.completers.overall"],
    earnings: r["latest.earnings.10_yrs_after_entry.median"],
  }))
  .filter((r) => r.size >= minSize && Number.isFinite(r.debt) && Number.isFinite(r.earnings))
  .sort((a, b) => b.size - a.size)
  .slice(0, 10);

if (!rows.length) throw new Error(`No schools with enrollment >= ${minSize} and complete cost/debt/earnings data`);

const avgDebtToEarnings = rows.reduce((s, r) => s + r.debt / r.earnings, 0) / rows.length;
const bestValue = rows.reduce((a, b) => (b.earnings / b.debt > a.earnings / a.debt ? b : a));
const worstValue = rows.reduce((a, b) => (b.earnings / b.debt < a.earnings / a.debt ? b : a));

const chartSVG = horizontalBarChart(
  rows.map((r, i) => ({
    label: r.name.length > 30 ? `${r.name.slice(0, 27)}...` : r.name,
    v: r.debt,
    color: r.name === bestValue.name ? C.s2 : r.name === worstValue.name ? C.neg : C.s1,
  })),
  { fmtTick: (v) => `$${Math.round(v / 1000)}k`, fmtVal: money }
);

const html = cardHTML({
  kicker: "College cost check",
  title: "Among the largest US colleges: median debt at graduation",
  hero: money(rows[0].debt),
  heroLabel: `${rows[0].name} · median debt at graduation`,
  chartSVG,
  source: "US Dept. of Education College Scorecard",
  vintage: "latest available cohort",
});

const facebook = [
  "College cost check:",
  "",
  `Among the 10 largest US colleges/universities by enrollment (min. ${minSize.toLocaleString("en-US")} students, bachelor's-predominant): median student debt at graduation ranges from ${money(Math.min(...rows.map((r) => r.debt)))} to ${money(Math.max(...rows.map((r) => r.debt)))}, and median earnings 10 years after enrollment range from ${money(Math.min(...rows.map((r) => r.earnings)))} to ${money(Math.max(...rows.map((r) => r.earnings)))}.`,
  "",
  `Best debt-to-earnings ratio in this group: ${bestValue.name} — ${money(bestValue.debt)} median debt against ${money(bestValue.earnings)} median earnings (debt is ${((bestValue.debt / bestValue.earnings) * 100).toFixed(0)}% of earnings). Worst: ${worstValue.name} — debt is ${((worstValue.debt / worstValue.earnings) * 100).toFixed(0)}% of earnings.`,
  "",
  `Average across this group: debt equal to about ${(avgDebtToEarnings * 100).toFixed(0)}% of 10-year earnings.`,
  "",
  "Caveat: \"earnings 10 years after entry\" mixes graduates and non-graduates, and median debt is only for students who completed a credential — the two figures aren't measuring the exact same population, so treat the ratio as a rough value signal, not a precise ROI calculation. Only includes federally-reporting Title IV schools with enough data to be included in the Scorecard.",
  "",
  "Real numbers, real source — US Dept. of Education College Scorecard:",
  "https://collegescorecard.ed.gov/data/",
];

const lines = [
  `College cost check (${stamp})`,
  "",
  `Largest bachelor's-predominant US colleges (min. ${minSize.toLocaleString("en-US")} students)`,
  "",
  "Rank | School | State | Enrollment | In-State Tuition | Median Debt | Median Earnings (10yr)",
  "---:|---|---|---:|---:|---:|---:",
  ...rows.map((r, i) => `${i + 1} | ${r.name} | ${r.state} | ${r.size.toLocaleString("en-US")} | ${money(r.tuitionIn)} | ${money(r.debt)} | ${money(r.earnings)}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "school", "state", "enrollment", "tuition_in_state", "tuition_out_of_state", "median_debt", "median_earnings_10yr"],
  rows.map((r, i) => [i + 1, r.name, r.state, r.size, r.tuitionIn, r.tuitionOut, r.debt, r.earnings])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
