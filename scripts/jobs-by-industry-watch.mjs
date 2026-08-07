#!/usr/bin/env node
// Which industries are actually adding or cutting jobs right now — BLS
// Current Employment Statistics, year-over-year change by sector, mirrored
// on FRED (no key required). Detailed BLS occupation-level growth
// *projections* (e.g. "fastest growing occupations to 2034") are only
// published as static tables behind BLS's bot-blocked web pages and aren't
// available via any API — this uses the closest genuinely live, keyless,
// always-current equivalent: actual industry employment change, not a
// decade-old speculative projection.
//
// Run:  node scripts/jobs-by-industry-watch.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, fred, horizontalBarChart, last, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, num, rel } from "./lib/data-common.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `jobs-by-industry-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

function closest(series, targetDate) {
  const ms = Date.parse(targetDate);
  return series.reduce((best, pt) => (Math.abs(Date.parse(pt.d) - ms) < Math.abs(Date.parse(best.d) - ms) ? pt : best));
}
function oneYearAgo(series) {
  const latestMs = Date.parse(last(series).d);
  return closest(series, new Date(latestMs - 365 * 86_400_000).toISOString().slice(0, 10));
}

const SECTORS = [
  { name: "Mining & logging", id: "USMINE" },
  { name: "Construction", id: "USCONS" },
  { name: "Manufacturing", id: "MANEMP" },
  { name: "Trade, transport & utilities", id: "USTRADE" },
  { name: "Information", id: "USINFO" },
  { name: "Financial activities", id: "USFIRE" },
  { name: "Professional & business services", id: "USPBS" },
  { name: "Education & health services", id: "USEHS" },
  { name: "Leisure & hospitality", id: "USLAH" },
  { name: "Government", id: "USGOVT" },
];

const series = await Promise.all(SECTORS.map((s) => fred(s.id)));
const payems = await fred("PAYEMS");
const asOf = last(payems).d.slice(0, 7);

const rows = SECTORS.map((s, i) => {
  const now = last(series[i]).v;
  const ago = oneYearAgo(series[i]).v;
  const chg = now - ago; // thousands of jobs
  const pct = (chg / ago) * 100;
  return { name: s.name, now, chg, pct };
}).sort((a, b) => b.pct - a.pct);

const gainer = rows[0];
const loser = rows[rows.length - 1];
const shrinking = rows.filter((r) => r.pct < 0);

const chartSVG = horizontalBarChart(
  rows.map((r) => ({ label: r.name, v: r.pct, color: r.pct >= 0 ? C.s1 : C.neg })),
  { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` }
);

const html = cardHTML({
  kicker: "Jobs by industry check",
  title: "Which industries are adding — or cutting — jobs right now?",
  hero: `${gainer.pct >= 0 ? "+" : ""}${gainer.pct.toFixed(1)}%`,
  heroLabel: `${gainer.name}; year-over-year employment change, ${asOf}`,
  chartSVG, source: "Bureau of Labor Statistics, Current Employment Statistics (via FRED)", vintage: asOf,
});

const facebook = [
  `${gainer.name} is adding jobs the fastest right now. ${shrinking.length} of ${rows.length} sectors are actually shrinking — led by ${loser.name}.`,
  "",
  `BLS Current Employment Statistics, year-over-year change through ${asOf}:`,
  "",
  ...rows.map((r) => `${r.name}: ${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}% (${r.chg >= 0 ? "+" : ""}${num(r.chg * 1000)} jobs)`),
  "",
  "This measures actual employment change over the last 12 months, not a projection — it's a live read on where the labor market is expanding or contracting today, sector by sector, seasonally adjusted.",
  "",
  "Source: Bureau of Labor Statistics, Current Employment Statistics (CES), via FRED.",
].filter(Boolean);

const lines = [
  `Jobs by industry watch (${STAMP})`, "", `BLS CES, year-over-year employment change by sector, ${asOf}.`, "",
  "Sector | YoY % change | YoY jobs change",
  "---|---:|---:",
  ...rows.map((r) => `${r.name} | ${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}% | ${r.chg >= 0 ? "+" : ""}${num(r.chg * 1000)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["sector", "yoy_pct_change", "yoy_jobs_change", "as_of"], rows.map((r) => [r.name, r.pct.toFixed(1), Math.round(r.chg * 1000), asOf])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
