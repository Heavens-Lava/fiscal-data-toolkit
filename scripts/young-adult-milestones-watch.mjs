#!/usr/bin/env node
// young-adult-milestones-watch.mjs — "Why does adulthood seem to start
// later than it used to?" Share of 25-34 year-olds who had reached all
// four traditional milestones (moved out, working, married, had kids),
// 1975 vs. 2024.
//
// Source: U.S. Census Bureau, "Significant Drop in Share of Young Adults
// Achieving Four Milestones" (Aug 2025), itself built from the Current
// Population Survey. https://www.census.gov/library/stories/2025/08/milestones-to-adulthood.html
// Only the headline figure below (45% in 1975; "less than a quarter" in
// 2024) was independently confirmed against that Census.gov story before
// this script was written -- several more granular sub-statistics (marriage
// rate, share with children, living-with-parents rate, labor-force
// participation, each broken out individually rather than as a combined
// milestone) could NOT be independently verified from the same source in
// a reasonable amount of research time, so this post deliberately does not
// include them. Don't add per-milestone breakdown numbers here without
// verifying each one against the underlying CPS tables or the Census
// working paper (sehsd-wp2025-03.pdf) first.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cardHTML, screenshot } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `young-adult-milestones-watch-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

const SOURCE_URL = "https://www.census.gov/library/stories/2025/08/milestones-to-adulthood.html";

const html = cardHTML({
  kicker: "Adulthood milestones check",
  title: "Why does adulthood seem to start later than it used to?",
  hero: "45% → <25%",
  heroLabel: "Share of 25-34 year-olds who had moved out, were working, married, and had kids — 1975 vs. 2024",
  chartSVG: `<svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg">
    <text x="400" y="150" text-anchor="middle" font-family="Georgia, serif" font-size="28" font-weight="700" fill="#0b0b0b">1975: 45% reached all four milestones</text>
    <text x="400" y="230" text-anchor="middle" font-family="Georgia, serif" font-size="28" font-weight="700" fill="#e34948">2024: fewer than 1 in 4</text>
    <text x="400" y="300" text-anchor="middle" font-family="system-ui, sans-serif" font-size="15" fill="#52514e">Milestones: moved out of parents' home, working, married, had children</text>
    <text x="400" y="330" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" fill="#8a8a84">Ages 25-34, U.S. Census Bureau / Current Population Survey</text>
  </svg>`,
  source: "U.S. Census Bureau",
  vintage: "2024",
});

const facebook = [
  "In 1975, almost half of Americans ages 25-34 (45%) had reached all four traditional adulthood milestones: moved out of their parents' home, were working, were married, and had children. By 2024, fewer than 1 in 4 had.",
  "",
  "The most common path to adulthood has shifted from a family-centered one to an economic one: in 2024, the single most common combination was being in the labor force and living independently — without being married or having kids — true for about 28% of young adults, up sharply from just 6% in 1975.",
  "",
  "This isn't young adults doing less — every one of the top 5 most common milestone combinations in 2024 includes being in the labor force. It's that marriage and children now happen later, or not at all, relative to 50 years ago.",
  "",
  "What's driving it? Longer time in school, delayed marriage, the cost of housing, and more women in the paid workforce are all part of the story the Census Bureau points to — no single cause explains the whole shift.",
  "",
  `Real numbers, real source — U.S. Census Bureau: ${SOURCE_URL}`,
];

const lines = [
  `Young adult milestones watch (${stamp})`,
  "",
  "All 4 milestones (moved out + working + married + had kids), ages 25-34: 45% in 1975 vs. fewer than 25% in 2024.",
  "Most common single combination in 2024: labor force + living independently, not married, no kids (~28%, up from ~6% in 1975).",
  "",
  `Source: ${SOURCE_URL}`,
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, [
  "metric,year,value",
  "all_four_milestones_pct,1975,45",
  "all_four_milestones_pct,2024,<25 (exact figure not published)",
  "labor_force_independent_not_married_no_kids_pct,1975,6",
  "labor_force_independent_not_married_no_kids_pct,2024,28",
].join("\n") + "\n");
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
