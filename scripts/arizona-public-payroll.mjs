#!/usr/bin/env node
// Arizona public-pay report. Official named payroll is not exposed by a
// statewide API, so detailed records can be supplied as a public-record CSV.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { ROOT, SOCIAL, STAMP, argValue, money, rel } from "./lib/data-common.mjs";

const input = argValue("--file");
const requestedMetric = String(argValue("--metric", "gross")).toLowerCase();
if (!["gross", "base"].includes(requestedMetric)) throw new Error("--metric must be gross or base.");
const topN = Math.max(5, Math.min(50, Number(argValue("--top", "10")) || 10));
const noImage = process.argv.includes("--no-image");
mkdirSync(SOCIAL, { recursive: true });

const OFFICIAL_SALARY_SOURCE = "Arizona Legislature FY2024 elected-official salary schedule";
const builtIn = [
  ["Katie Hobbs", "Governor", "State of Arizona", 95000, "executive-legislative"],
  ["Kris Mayes", "Attorney General", "Arizona Attorney General", 90000, "executive-legislative"],
  ["Tom Horne", "Superintendent of Public Instruction", "Arizona Department of Education", 85000, "executive-legislative"],
  ["Adrian Fontes", "Secretary of State", "Arizona Secretary of State", 70000, "executive-legislative"],
  ["Kimberly Yee", "State Treasurer", "Arizona State Treasurer", 70000, "executive-legislative"],
  ["Paul Marsh", "State Mine Inspector", "Arizona State Mine Inspector", 50000, "executive-legislative"],
  ["Warren Petersen", "Senate President", "Arizona Legislature", 24000, "executive-legislative"],
  ["Steve Montenegro", "Speaker of the House", "Arizona Legislature", 24000, "executive-legislative"],
].map(([name, title, agency, base, category]) => ({
  name, title, agency, base, gross: null, category, source: OFFICIAL_SALARY_SOURCE,
  note: title.includes("President") || title.includes("Speaker") ? "All Arizona legislators receive the same $24,000 base salary; per diem is separate." : "Published office salary; actual gross pay not available in the statewide portal.",
}));

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases = {
  name: ["name", "employeename", "fullname", "employee"],
  first: ["firstname", "first"], last: ["lastname", "last"],
  title: ["title", "jobtitle", "position", "classification"],
  agency: ["agency", "employer", "department", "organization", "university"],
  base: ["base", "basesalary", "annualsalary", "salary", "regularwages", "regularpay"],
  gross: ["gross", "grosspay", "totalpay", "actualpay", "totalwages", "compensation"],
  category: ["category", "sector", "group"], source: ["source", "datasource"], note: ["note", "notes"],
};

function amount(value) {
  const n = Number(String(value ?? "").replace(/[$,()\s]/g, "").replace(/^(-?)(.*)$/, "$1$2"));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function classify(agency, title, provided) {
  const p = norm(provided);
  const supplied = {
    stateagency: "state-agencies", stateagencies: "state-agencies",
    university: "universities", universities: "universities",
    publicsafety: "public-safety", executivelegislative: "executive-legislative",
  }[p];
  if (supplied) return supplied;
  const text = `${agency} ${title}`.toLowerCase();
  if (/university|board of regents|\basu\b|northern arizona|u of a/.test(text)) return "universities";
  if (/police|sheriff|fire|correction|public safety|trooper|marshal|peace officer/.test(text)) return "public-safety";
  if (/governor|attorney general|secretary of state|treasurer|legislature|senate|house of representatives|superintendent|mine inspector|corporation commission/.test(text)) return "executive-legislative";
  return "state-agencies";
}

function importRows(file) {
  if (!existsSync(file)) {
    const isPlaceholder = /(^|[\\/])path[\\/]to[\\/]/i.test(file);
    const detail = isPlaceholder
      ? "The --file value is an example placeholder. Replace it with the path to a real official payroll CSV."
      : `Payroll file not found: ${file}`;
    console.error(`${detail}\n\nStart with: ${rel(path.join(SOCIAL, "arizona-public-payroll-import-template.csv"))}\nThen run: npm run az-payroll -- --file social\\your-payroll-file.csv --metric base`);
    process.exit(1);
  }
  const matrix = parseCSV(readFileSync(file, "utf8"));
  if (matrix.length < 2) throw new Error("Payroll CSV has no data rows.");
  const headers = matrix[0].map(norm);
  const at = (key) => aliases[key].map(norm).map((a) => headers.indexOf(a)).find((i) => i >= 0) ?? -1;
  const ix = Object.fromEntries(Object.keys(aliases).map((key) => [key, at(key)]));
  if (ix.name < 0 && ix.first < 0 && ix.last < 0) throw new Error("CSV needs name or first_name/last_name columns.");
  if (ix.base < 0 && ix.gross < 0) throw new Error("CSV needs base_salary and/or gross_pay columns.");
  const value = (row, key) => ix[key] >= 0 ? row[ix[key]]?.trim() : "";
  return matrix.slice(1).map((row) => {
    const name = value(row, "name") || `${value(row, "first")} ${value(row, "last")}`.trim();
    const title = value(row, "title") || "Not reported";
    const agency = value(row, "agency") || "Not reported";
    return {
      name, title, agency, base: amount(value(row, "base")), gross: amount(value(row, "gross")),
      category: classify(agency, title, value(row, "category")),
      source: value(row, "source") || path.basename(file), note: value(row, "note"),
    };
  }).filter((r) => r.name && (r.base != null || r.gross != null));
}

const imported = input ? importRows(path.resolve(input)) : [];
const importedNames = new Set(imported.map((r) => norm(r.name)));
const rows = [...imported, ...builtIn.filter((r) => !importedNames.has(norm(r.name)))];
const metric = requestedMetric === "gross" && rows.some((r) => r.gross != null) ? "gross" : "base";
const ranked = rows.filter((r) => r[metric] != null).sort((a, b) => b[metric] - a[metric]).map((r, i) => ({ ...r, rank: i + 1 }));
if (!ranked.length) throw new Error(`No usable ${metric} pay values found.`);
const categories = [
  ["state-agencies", "State agencies"], ["universities", "Universities"],
  ["public-safety", "Public safety"], ["executive-legislative", "Executive and legislative"],
];
const chartRows = ranked.slice(0, topN);
const chartSVG = horizontalBarChart(chartRows.map((r, i) => ({
  label: r.name, v: r[metric], color: i === 0 ? C.s2 : C.s1,
})), { fmtTick: (v) => `$${Math.round(v / 1000)}k`, fmtVal: money });
const outBase = path.join(SOCIAL, `arizona-public-payroll-${metric}-${STAMP}`);
const html = cardHTML({
  kicker: "Arizona public-pay check", title: `Highest published ${metric === "gross" ? "actual gross pay" : "base salaries"}`,
  hero: money(ranked[0][metric]), heroLabel: `${ranked[0].name}; ${ranked[0].title}`,
  chartSVG, source: input ? "Imported public payroll records plus official Arizona salary schedules" : "Official Arizona elected-official salary schedules", vintage: STAMP,
});

function section(key, label) {
  const data = ranked.filter((r) => r.category === key).slice(0, topN);
  if (!data.length) return [label, "", "No named records loaded. Supply an official public-record CSV with --file.", ""];
  return [label, "", "Rank | Employee | Title | Agency | Base salary | Actual gross pay", "---:|---|---|---|---:|---:",
    ...data.map((r) => `${r.rank} | ${r.name} | ${r.title} | ${r.agency} | ${r.base == null ? "Not reported" : money(r.base)} | ${r.gross == null ? "Not reported" : money(r.gross)}`), ""];
}
const lines = [
  `Arizona public payroll check (${STAMP})`, "",
  input ? `Imported named payroll records: ${imported.length} from ${path.basename(input)}.` : "No detailed payroll export supplied; showing named elected officials whose office salaries are officially published.",
  `Ranking metric: ${metric === "gross" ? "actual gross pay" : "base salary"}.`, "",
  ...categories.flatMap(([key, label]) => section(key, label)),
  "Method and limitations", "----------------------",
  "Arizona OpenBooks aggregates central payroll transactions by agency, cost account, and expense category before publication; it does not expose a statewide named payroll API.",
  "University detailed transactions are maintained in separate university systems.",
  "Base salary is an annual rate. Actual gross pay can include overtime, bonuses, leave payouts, retroactive pay, or partial-year effects and must not be treated as the same measure.",
  "Imported files should be official agency exports or records obtained under Arizona public-records law. Home addresses, employee IDs, and other unnecessary personal fields are ignored.", "",
  "Facebook post", "-------------",
  input
    ? `Arizona public-pay check:\n\nThe highest ${metric === "gross" ? "actual gross pay" : "base salary"} in this official-record export is ${ranked[0].name}, ${ranked[0].title} at ${ranked[0].agency}: ${money(ranked[0][metric])}.\n\nBase salary and actual gross pay are shown separately because overtime, bonuses, leave payouts, and partial-year employment can make them very different.\n\nWhich category should I break down next: state agencies, universities, public safety, or elected offices? Comment below and share this with another Arizona taxpayer.`
    : `Arizona elected-office salary check:\n\nThe Governor's published base salary is ${money(ranked[0].base)}. The Attorney General receives ${money(ranked[1].base)}, while Arizona legislators receive $24,000 plus separately reported per diem.\n\nThese are official base salary rates, not actual gross pay or total compensation. Arizona's statewide transparency portal aggregates payroll and does not publish a downloadable named employee payroll table.\n\nDid any of these salaries surprise you? Comment below and share this with another Arizona taxpayer.`,
  "",
  "Sources:",
  "Arizona Financial Transparency Portal: https://openbooks.az.gov/",
  "Arizona Legislature elected-official salary schedule: https://www.azleg.gov/legtext/56leg/2R/summary/S.1480APPROP.DOCX.htm",
];
writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "category", "employee", "title", "agency", "base_salary", "actual_gross_pay", "source", "note"], ranked.map((r) => [r.rank, r.category, r.name, r.title, r.agency, r.base ?? "", r.gross ?? "", r.source, r.note])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
const template = path.join(SOCIAL, "arizona-public-payroll-import-template.csv");
if (!existsSync(template)) writeFileSync(template, "employee_name,job_title,agency,base_salary,gross_pay,category,source,note\n");
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
console.log(`Import template: ${rel(template)}`);
