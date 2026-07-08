#!/usr/bin/env node
// marriage-rates.mjs - Census marriage-by-age cohort snapshot.
// Source: U.S. Census Bureau, 2021 SIPP article published Aug. 31, 2022.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  C,
  cardHTML,
  horizontalBarChart,
  screenshot,
  toCSV,
} from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const SOURCE_URL = "https://www.census.gov/library/stories/2022/08/does-marrying-younger-mean-marrying-more-often.html";

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

const noImage = process.argv.includes("--no-image");
const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, `marriage-rates-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const rows = [
  { cohort: "Born 1940-44", sex: "Women", pct: 79.6 },
  { cohort: "Born 1940-44", sex: "Men", pct: 65.3 },
  { cohort: "Born 1990-94", sex: "Women", pct: 30.3 },
  { cohort: "Born 1990-94", sex: "Men", pct: 20.3 },
];

const womenDrop = rows[0].pct - rows[2].pct;
const menDrop = rows[1].pct - rows[3].pct;

const chartSVG = horizontalBarChart(
  rows.map((r) => ({
    label: `${r.cohort}, ${r.sex}`,
    v: r.pct,
    color: r.sex === "Women" ? C.s2 : C.s1,
  })),
  { fmtTick: (v) => `${Math.round(v)}%`, fmtVal: (v) => `${v.toFixed(1)}%` }
);

const html = cardHTML({
  kicker: "Marriage rates",
  title: "Marriage by 25 fell sharply across birth cohorts",
  hero: "-49 pts",
  heroLabel: "women married by 25, 1940-44 vs. 1990-94",
  chartSVG,
  source: "U.S. Census Bureau, 2021 SIPP",
  vintage: "Published Aug. 31, 2022",
});

const facebook = [
  "Marriage by age 25 changed a lot across birth cohorts.",
  "",
  "Census Bureau SIPP data:",
  "",
  "Born 1940-44:",
  "Women married by 25: 79.6%",
  "Men married by 25: 65.3%",
  "",
  "Born 1990-94:",
  "Women married by 25: 30.3%",
  "Men married by 25: 20.3%",
  "",
  `Change: women down ${womenDrop.toFixed(1)} percentage points; men down ${menDrop.toFixed(1)} points.`,
  "",
  "The data does not say why. It does show a major shift in when Americans marry.",
  "",
  "Source: U.S. Census Bureau, 2021 Survey of Income and Program Participation.",
  SOURCE_URL,
];

const lines = [
  `Marriage rates check (${stamp})`,
  "",
  "Share ever married by age 25:",
  "",
  "Cohort | Women | Men",
  "---|---:|---:",
  `Born 1940-44 | ${rows[0].pct.toFixed(1)}% | ${rows[1].pct.toFixed(1)}%`,
  `Born 1990-94 | ${rows[2].pct.toFixed(1)}% | ${rows[3].pct.toFixed(1)}%`,
  "",
  `Change: women down ${womenDrop.toFixed(1)} percentage points; men down ${menDrop.toFixed(1)} percentage points.`,
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
  "",
  "Data table",
  "----------",
  "Cohort | Sex | Married by age 25",
  "---|---|---:",
  ...rows.map((r) => `${r.cohort} | ${r.sex} | ${r.pct.toFixed(1)}%`),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["cohort", "sex", "married_by_age_25_pct"],
  rows.map((r) => [r.cohort, r.sex, r.pct])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
