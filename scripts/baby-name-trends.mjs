#!/usr/bin/env node
// National and Arizona baby-name trends from Social Security card applications.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { readZipTextFiles } from "./lib/xlsx-lite.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const stamp = new Date().toISOString().slice(0, 10);
const noImage = process.argv.includes("--no-image");
const span = Math.max(5, Math.min(30, Number(process.argv[process.argv.indexOf("--years") + 1]) || 10));
const outBase = path.join(SOCIAL, `baby-name-trends-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function num(n) { return Math.round(n).toLocaleString("en-US"); }
async function zip(url) {
  const res = await fetch(url, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
  if (!res.ok) throw new Error(`SSA HTTP ${res.status}: ${url}`);
  return readZipTextFiles(Buffer.from(await res.arrayBuffer()));
}
function rank(rows) {
  const out = [];
  for (const sex of ["F", "M"]) {
    rows.filter((r) => r.sex === sex).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).forEach((r, i) => out.push({ ...r, rank: i + 1 }));
  }
  return out;
}
function trends(latestRows, baseRows, minCount) {
  const old = new Map(baseRows.map((r) => [`${r.sex}-${r.name}`, r]));
  const now = new Map(latestRows.map((r) => [`${r.sex}-${r.name}`, r]));
  const rising = latestRows.filter((r) => r.count >= minCount).map((r) => ({ ...r, oldRank: old.get(`${r.sex}-${r.name}`)?.rank || 9999, move: (old.get(`${r.sex}-${r.name}`)?.rank || 9999) - r.rank })).sort((a, b) => b.move - a.move).slice(0, 10);
  const falling = baseRows.filter((r) => r.count >= minCount).map((r) => ({ ...r, newRank: now.get(`${r.sex}-${r.name}`)?.rank || 9999, move: (now.get(`${r.sex}-${r.name}`)?.rank || 9999) - r.rank })).sort((a, b) => b.move - a.move).slice(0, 10);
  return { rising, falling };
}

const [nationalZip, stateZip] = await Promise.all([
  zip("https://www.ssa.gov/oact/babynames/names.zip"),
  zip("https://www.ssa.gov/oact/babynames/state/namesbystate.zip"),
]);
const nationalYears = [...nationalZip.keys()].map((x) => Number(x.match(/yob(\d{4})\.txt/i)?.[1])).filter(Number.isFinite);
const azEntry = [...stateZip.entries()].find(([name]) => /(^|\/)AZ\.TXT$/i.test(name));
if (!azEntry) throw new Error("Arizona file not found in SSA state ZIP.");
const azAll = azEntry[1].trim().split(/\r?\n/).map((line) => { const [state, sex, year, name, count] = line.split(","); return { state, sex, year: Number(year), name, count: Number(count) }; });
const azYears = [...new Set(azAll.map((r) => r.year))];
const latestYear = Math.min(Math.max(...nationalYears), Math.max(...azYears));
const baseYear = latestYear - span;
const parseNational = (year) => {
  const entry = [...nationalZip.entries()].find(([name]) => new RegExp(`yob${year}\\.txt$`, "i").test(name));
  if (!entry) throw new Error(`SSA national file missing for ${year}`);
  return entry[1].trim().split(/\r?\n/).map((line) => { const [name, sex, count] = line.split(","); return { sex, name, count: Number(count) }; });
};
const nationalLatest = rank(parseNational(latestYear));
const nationalBase = rank(parseNational(baseYear));
const azLatest = rank(azAll.filter((r) => r.year === latestYear));
const azBase = rank(azAll.filter((r) => r.year === baseYear));
const nationalTrend = trends(nationalLatest, nationalBase, 1000);
const azTrend = trends(azLatest, azBase, 40);
const azTop = [...azLatest.filter((r) => r.rank <= 5)].sort((a, b) => a.sex.localeCompare(b.sex) || a.rank - b.rank);

const chartSVG = horizontalBarChart(azTop.map((r) => ({ label: `${r.sex === "F" ? "Girls" : "Boys"} #${r.rank} ${r.name}`, v: r.count, color: r.sex === "F" ? C.s1 : C.s2 })), {
  fmtTick: (v) => `${Math.round(v)}`, fmtVal: (v) => `${num(v)} births`,
});
const girl = azLatest.find((r) => r.sex === "F" && r.rank === 1);
const boy = azLatest.find((r) => r.sex === "M" && r.rank === 1);
const html = cardHTML({
  kicker: "Baby-name trend check",
  title: `Arizona's most popular baby names`,
  hero: girl.name,
  heroLabel: `#1 girls' name; ${boy.name} was #1 for boys`,
  chartSVG,
  source: "Social Security Administration",
  vintage: String(latestYear),
});

const rankLabel = (rank) => rank === 9999 ? "outside the list" : `#${rank}`;
const facebook = [
  `What were Arizona's most popular baby names in ${latestYear}?`, "",
  `Girls: #1 ${girl.name} (${num(girl.count)}), #2 ${azLatest.find((r) => r.sex === "F" && r.rank === 2).name}`,
  `Boys: #1 ${boy.name} (${num(boy.count)}), #2 ${azLatest.find((r) => r.sex === "M" && r.rank === 2).name}`, "",
  `One of Arizona's biggest ${span}-year risers: ${azTrend.rising[0].name} (${azTrend.rising[0].sex === "F" ? "girls" : "boys"}), from ${rankLabel(azTrend.rising[0].oldRank)} to ${rankLabel(azTrend.rising[0].rank)}.`,
  `One of the biggest fallers: ${azTrend.falling[0].name}, from ${rankLabel(azTrend.falling[0].rank)} to ${rankLabel(azTrend.falling[0].newRank)}.`, "",
  "SSA counts names from Social Security card applications. Very rare names are excluded for privacy, and spelling variations are counted separately.", "",
  "Is your name rising, falling, or holding steady? Put it in the comments and I can check it.", "",
  "Follow for more data about how American life changes over time, and share this with a parent or grandparent.",
];

const trendLines = (rows, direction) => rows.map((r, i) => `${i + 1} | ${r.name} | ${r.sex === "F" ? "Girls" : "Boys"} | ${rankLabel(direction === "up" ? r.oldRank : r.rank)} | ${rankLabel(direction === "up" ? r.rank : r.newRank)} | ${num(r.count)}`);
const lines = [
  `Baby-name trends (${stamp})`, "", `Latest SSA birth year: ${latestYear}. Trend comparison: ${baseYear} to ${latestYear}.`, "",
  "Arizona top names", "", "Sex | Rank | Name | Births", "---|---:|---|---:", ...azTop.map((r) => `${r.sex === "F" ? "Girls" : "Boys"} | ${r.rank} | ${r.name} | ${num(r.count)}`),
  "", "Arizona fastest-rising names", "", "Rank | Name | Sex | Old rank | New rank | Latest births", "---:|---|---|---:|---:|---:", ...trendLines(azTrend.rising, "up"),
  "", "Arizona largest rank declines", "", "Rank | Name | Sex | Old rank | New rank | Base-year births", "---:|---|---|---:|---:|---:", ...trendLines(azTrend.falling, "down"),
  "", "National fastest-rising names", "", "Rank | Name | Sex | Old rank | New rank | Latest births", "---:|---|---|---:|---:|---:", ...trendLines(nationalTrend.rising, "up"),
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: Social Security Administration baby-name data from Social Security card applications.",
  "Note: names with fewer than five occurrences in a geography/year are excluded by SSA; rank movement can be volatile for smaller state counts.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["geography", "year", "sex", "rank", "name", "births"], [...azLatest.map((r) => ["Arizona", latestYear, r.sex, r.rank, r.name, r.count]), ...nationalLatest.slice(0, 200).map((r) => ["United States", latestYear, r.sex, r.rank, r.name, r.count]) ]));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
