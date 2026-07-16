#!/usr/bin/env node
// How Americans divide an average day, from the latest BLS ATUS table 1.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const URL = "https://www.bls.gov/news.release/atus.t01.htm";
const stamp = new Date().toISOString().slice(0, 10);
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `american-time-use-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function text(s) { return String(s).replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim(); }
function hours(n) { const h = Math.floor(n); const m = Math.round((n - h) * 60); return `${h}h ${String(m).padStart(2, "0")}m`; }

const res = await fetch(URL, { headers: { "User-Agent": "Mozilla/5.0 fiscal-data-toolkit/1.0" } });
const htmlText = await res.text();
if (!res.ok) throw new Error(`BLS HTTP ${res.status}`);
const vintage = htmlText.match(/(20\d{2}) annual averages/i)?.[1] || "latest";
const parsed = [];
for (const match of htmlText.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
  const cells = [...match[0].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((m) => text(m[1]));
  if (cells.length < 2) continue;
  const nums = cells.slice(1).map((x) => Number(x.replace(/[^\d.-]/g, ""))).filter(Number.isFinite);
  if (nums.length) parsed.push({ activity: cells[0].replace(/\s*\(\d+\)\s*$/, ""), total: nums[0], men: nums[1], women: nums[2] });
}

const wanted = [
  ["Sleeping", "Sleeping"],
  ["Leisure and sports", "Leisure and sports"],
  ["Working and work-related activities", "Work and work-related"],
  ["Household activities", "Household activities"],
  ["Eating and drinking", "Eating and drinking"],
  ["Purchasing goods and services", "Purchasing goods/services"],
  ["Caring for and helping household members", "Household care"],
  ["Educational activities", "Education"],
];
const rows = wanted.map(([source, label]) => {
  const r = parsed.find((x) => x.activity.startsWith(source));
  if (!r) throw new Error(`Could not find BLS ATUS row: ${source}`);
  return { ...r, label };
});

const chartSVG = horizontalBarChart(rows.map((r, i) => ({ label: r.label, v: r.total, color: i === 0 ? C.s2 : C.s1 })), {
  fmtTick: (v) => `${v.toFixed(0)}h`, fmtVal: hours,
});
const html = cardHTML({
  kicker: "American time-use check",
  title: "How Americans divide an average day",
  hero: hours(rows[0].total),
  heroLabel: "sleeping, averaged across every day and person age 15+",
  chartSVG,
  source: "U.S. Bureau of Labor Statistics ATUS",
  vintage,
});

const sleep = rows.find((r) => r.label === "Sleeping");
const leisure = rows.find((r) => r.label === "Leisure and sports");
const work = rows.find((r) => r.label === "Work and work-related");
const household = rows.find((r) => r.label === "Household activities");
const facebook = [
  "How does the average American divide a 24-hour day?", "",
  `Sleeping: ${hours(sleep.total)}`,
  `Leisure and sports: ${hours(leisure.total)}`,
  `Work and work-related activities: ${hours(work.total)}`,
  `Household activities: ${hours(household.total)}`, "",
  "These are averages across all people age 15 and older and all days of the week. The work average includes retirees, students, unemployed people, weekends and days off; workers who worked that day averaged much more.", "",
  "Which category differs most from your own day?", "",
  "Follow for more data about everyday American life and share this with someone who says there are never enough hours in the day.",
];

const lines = [
  `American time-use check (${stamp})`, "", `BLS American Time Use Survey, ${vintage} annual averages.`, "",
  "Activity | All people | Men | Women", "---|---:|---:|---:",
  ...rows.map((r) => `${r.label} | ${hours(r.total)} | ${hours(r.men)} | ${hours(r.women)}`),
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: U.S. Bureau of Labor Statistics American Time Use Survey, table 1.",
  "Note: primary activities only; simultaneous secondary activities are not counted separately.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["activity", "hours_all", "hours_men", "hours_women", "vintage"], rows.map((r) => [r.label, r.total, r.men, r.women, vintage])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
