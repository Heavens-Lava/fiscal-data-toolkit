#!/usr/bin/env node
// Federal pay rankings from OPM Federal Workforce Data (FWD).

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { ROOT, SOCIAL, STAMP, argValue, money, num, pct, rel } from "./lib/data-common.mjs";

const API = "https://data.opm.gov/api/v1/files";
const view = String(argValue("--view", "occupation")).toLowerCase();
const views = { occupation: "occupations", agency: "agencies", state: "states", city: "cities", range: "ranges" };
if (!views[view]) throw new Error("Unknown --view. Use occupation, agency, state, city, or range.");
const topN = Math.max(5, Math.min(25, Number(argValue("--top", "10")) || 10));
const noImage = process.argv.includes("--no-image");
const refresh = process.argv.includes("--refresh");
const cacheDir = path.join(ROOT, ".cache", "opm");
mkdirSync(cacheDir, { recursive: true });
mkdirSync(SOCIAL, { recursive: true });

async function json(url) {
  const res = await fetch(url, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
  if (!res.ok) throw new Error(`OPM HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
  return res.json();
}

const files = await json(`${API}/employment?current=true`);
const latest = files.sort((a, b) => `${b.year}${String(b.month).padStart(2, "0")}`.localeCompare(`${a.year}${String(a.month).padStart(2, "0")}`))[0];
if (!latest) throw new Error("OPM returned no current employment files.");
const month = Number(latest.month);
const vintage = `${latest.year}-${String(month).padStart(2, "0")}`;
const parquet = path.join(cacheDir, `${latest.filename}.parquet`);

if (refresh || !existsSync(parquet)) {
  console.log(`Downloading OPM Federal Employment data for ${vintage}...`);
  const url = `${API}/employment/${latest.year}/${month}/${latest.version}/download`;
  const res = await fetch(url, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
  if (!res.ok) throw new Error(`OPM download HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(parquet));
}

const helper = path.join(ROOT, "scripts", "lib", "opm-pay-aggregate.py");
let proc = spawnSync("python", [helper, parquet], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (proc.error?.code === "ENOENT") proc = spawnSync("py", ["-3", helper, parquet], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (proc.status !== 0) throw new Error((proc.stderr || proc.stdout || proc.error?.message || "OPM aggregation failed").trim());
const data = JSON.parse(proc.stdout);
const thresholds = { occupation: 100, agency: 250, state: 1000, city: 250 };

function ranked(key) {
  return data[key].filter((r) => r.employees >= thresholds[view])
    .sort((a, b) => b.average_salary - a.average_salary)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

const sections = {
  occupations: data.occupations.filter((r) => r.employees >= 100).sort((a, b) => b.average_salary - a.average_salary).map((r, i) => ({ ...r, rank: i + 1 })),
  agencies: data.agencies.filter((r) => r.employees >= 250).sort((a, b) => b.average_salary - a.average_salary).map((r, i) => ({ ...r, rank: i + 1 })),
  states: data.states.filter((r) => r.employees >= 1000).sort((a, b) => b.average_salary - a.average_salary).map((r, i) => ({ ...r, rank: i + 1 })),
  cities: data.cities.filter((r) => r.employees >= 250).sort((a, b) => b.average_salary - a.average_salary).map((r, i) => ({ ...r, rank: i + 1 })),
};
const rangeRows = data.ranges.map((r) => ({ ...r, share: r.employees / data.published_salary_employees * 100 }));
const selected = view === "range" ? rangeRows : ranked(views[view]);
const display = view === "range" ? selected : selected.slice(0, topN);
const short = (value, max = 30) => value.length > max ? `${value.slice(0, max - 3)}...` : value;
const labels = { occupation: "occupations", agency: "agencies", state: "states", city: "cities", range: "salary ranges" };
const chartSVG = horizontalBarChart(display.map((r, i) => ({
  label: view === "range" ? r.name : short(`#${r.rank} ${r.name}`),
  v: view === "range" ? r.share : r.average_salary,
  color: i === 0 ? C.s2 : C.s1,
})), { fmtTick: view === "range" ? (v) => `${v.toFixed(0)}%` : (v) => `$${Math.round(v / 1000)}k`, fmtVal: view === "range" ? (v) => pct(v) : money });
const hero = display[0];
const outBase = path.join(SOCIAL, `federal-workforce-pay-${view}-${STAMP}`);
const html = cardHTML({
  kicker: "Federal workforce pay check",
  title: view === "range" ? "Where federal salaries fall" : `Highest average pay by ${labels[view].replace(/s$/, "")}`,
  hero: view === "range" ? pct(hero.share) : money(hero.average_salary),
  heroLabel: hero.name,
  chartSVG, source: "U.S. Office of Personnel Management Federal Workforce Data", vintage,
});

function table(title, rows) {
  return [title, "", "Rank | Name | Published employees | Average annual salary", "---:|---|---:|---:",
    ...rows.slice(0, topN).map((r) => `${r.rank} | ${r.name} | ${num(r.employees)} | ${money(r.average_salary)}`), ""];
}
const coverage = data.published_salary_employees / data.total_employees * 100;
const facebook = [
  "Which federal jobs have the highest average salaries?", "",
  `Medical Officers lead the published OPM occupation data at ${money(sections.occupations[0].average_salary)} a year, followed by ${sections.occupations[1].name.toLowerCase()} at ${money(sections.occupations[1].average_salary)}.`, "",
  `Among agencies with at least 250 published salary records, ${sections.agencies[0].name} ranks first at ${money(sections.agencies[0].average_salary)}.`, "",
  `Important context: OPM publishes salary for ${pct(coverage)} of the ${num(data.total_employees)} federal civilian employees represented in this snapshot. These are averages of annualized basic pay, not overtime, bonuses, benefits, or total compensation.`, "",
  "Which comparison should I post next: agencies, occupations, states, cities, or salary ranges? Comment below and share this with someone who would find the numbers useful.", "",
  "Source: U.S. Office of Personnel Management Federal Workforce Data.",
].join("\n");
const lines = [
  `Federal workforce pay check (${STAMP})`, "",
  `OPM snapshot: ${vintage}. Federal civilian employees represented: ${num(data.total_employees)}.`,
  `Published salary records: ${num(data.published_salary_employees)} (${pct(coverage)}); OPM redacts salary for some records.`,
  `Average among records with published salaries: ${money(data.published_average_salary)}.`, "",
  ...table("Highest-paid occupations", sections.occupations),
  ...table("Highest-paid agencies", sections.agencies),
  ...table("Highest-paid duty-station states", sections.states),
  ...table("Highest-paid duty-station cities", sections.cities),
  "Salary ranges (published records only)", "", "Range | Employees | Share", "---|---:|---:",
  ...rangeRows.map((r) => `${r.name} | ${num(r.employees)} | ${pct(r.share)}`), "",
  "Notes", "-----",
  "Pay is annualized adjusted basic pay, not total compensation, overtime, bonuses, or benefits.",
  "Rankings exclude small groups: occupations under 100 employees, agencies/cities under 250, and states under 1,000.",
  "Averages use only records whose salary OPM publishes, so redaction can affect comparisons.", "",
  "Facebook post", "-------------", facebook, "",
  "Source: U.S. Office of Personnel Management Federal Workforce Data (EHRI).",
  "https://data.opm.gov/",
];
const csvRows = Object.entries(sections).flatMap(([dimension, rows]) => rows.map((r) => [dimension, r.rank, r.name, r.employees, r.average_salary, vintage]));
writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["dimension", "rank", "name", "published_employees", "average_annual_salary", "vintage"], csvRows));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
