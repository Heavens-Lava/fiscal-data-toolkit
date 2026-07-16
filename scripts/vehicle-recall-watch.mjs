#!/usr/bin/env node
// Recent NHTSA vehicle recalls from the official ODI bulk recall file.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { readZipTextFiles } from "./lib/xlsx-lite.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const URL = "https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip";
const stamp = new Date().toISOString().slice(0, 10);
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `vehicle-recall-watch-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function num(n) { return Math.round(n).toLocaleString("en-US"); }
function short(n) { return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n); }
function iso(s) { return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s; }
function clean(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
function cutoff() { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10).replace(/-/g, ""); }

const res = await fetch(URL, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
if (!res.ok) throw new Error(`NHTSA HTTP ${res.status}`);
const files = readZipTextFiles(Buffer.from(await res.arrayBuffer()));
const entry = [...files.entries()].find(([name]) => /\.(txt|lst|csv)$/i.test(name)) || [...files.entries()][0];
if (!entry) throw new Error("No text file found in NHTSA recall ZIP.");

const campaigns = new Map();
for (const line of entry[1].split(/\r?\n/)) {
  const c = line.split("\t");
  if (c.length < 20 || c[10] !== "V" || c[15] < cutoff()) continue;
  const campaign = clean(c[1]);
  if (!campaign) continue;
  const row = campaigns.get(campaign) || {
    campaign,
    make: clean(c[2]),
    models: new Set(),
    manufacturer: clean(c[7]),
    affected: Number(c[11]) || 0,
    received: iso(c[15]),
    component: clean(c[6]),
    defect: clean(c[19]),
    consequence: clean(c[20]),
    doNotDrive: clean(c[27]) === "Y",
    parkOutside: clean(c[28]) === "Y",
  };
  if (clean(c[3])) row.models.add(clean(c[3]));
  row.affected = Math.max(row.affected, Number(c[11]) || 0);
  campaigns.set(campaign, row);
}

const rows = [...campaigns.values()].map((r) => ({ ...r, models: [...r.models] }))
  .sort((a, b) => b.received.localeCompare(a.received));
if (!rows.length) throw new Error("No recent vehicle recalls found in NHTSA file.");
const largest = rows.slice().sort((a, b) => b.affected - a.affected).slice(0, 10);
const recent = rows.slice(0, 10);
const totalAffected = rows.reduce((s, r) => s + r.affected, 0);

const chartSVG = horizontalBarChart(largest.slice(0, 8).map((r) => ({
  label: (() => {
    const value = `${r.make} ${r.models.slice(0, 2).join("/")}`;
    return value.length > 29 ? `${value.slice(0, 26)}...` : value;
  })(),
  v: r.affected,
  color: r.doNotDrive || r.parkOutside ? C.neg : C.s1,
})), { fmtTick: short, fmtVal: short });
const html = cardHTML({
  kicker: "Vehicle recall watch",
  title: "Largest vehicle recalls reported in the last year",
  hero: short(largest[0].affected),
  heroLabel: `${largest[0].make}; potentially affected units`,
  chartSVG,
  source: "NHTSA Office of Defects Investigation",
  vintage: rows[0].received,
});

const top = largest[0];
const facebook = [
  "Which recent vehicle recalls potentially affect the most vehicles?",
  "",
  `Largest reported in the last year: ${top.make} ${top.models.slice(0, 3).join(", ")} - ${num(top.affected)} potentially affected vehicles.`,
  `Component: ${top.component}`,
  `NHTSA campaign: ${top.campaign}`,
  "",
  `Across ${rows.length} vehicle recall campaigns in this file, manufacturers reported about ${num(totalAffected)} potentially affected units. Campaign totals can overlap if the same vehicle is covered by more than one recall.`,
  "",
  "A make or model appearing here does not mean every vehicle is affected. Owners should check their VIN at NHTSA.gov/recalls.",
  "",
  "What year, make and model should I check in a follow-up post?",
  "",
  "Follow for weekly recall checks and share this with someone shopping for a vehicle.",
];

const table = (list) => list.map((r, i) => `${i + 1} | ${r.received} | ${r.make} | ${r.models.slice(0, 3).join(", ")} | ${num(r.affected)} | ${r.component} | ${r.campaign}`);
const lines = [
  `Vehicle recall watch (${stamp})`, "",
  "Largest recalls received by NHTSA in the latest 12 months", "",
  "Rank | Received | Make | Models | Potentially affected | Component | Campaign",
  "---:|---|---|---|---:|---|---",
  ...table(largest),
  "", "Most recently received campaigns", "",
  "Rank | Received | Make | Models | Potentially affected | Component | Campaign",
  "---:|---|---|---|---:|---|---",
  ...table(recent),
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: NHTSA Office of Defects Investigation recall flat file.",
  "Note: potential units affected are manufacturer-reported campaign totals, not confirmed unrepaired vehicles currently on the road.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["campaign", "received", "make", "models", "manufacturer", "potentially_affected", "component", "do_not_drive", "park_outside", "defect", "consequence"], rows.map((r) => [r.campaign, r.received, r.make, r.models.join("; "), r.manufacturer, r.affected, r.component, r.doNotDrive, r.parkOutside, r.defect, r.consequence])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
