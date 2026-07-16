#!/usr/bin/env node
// cdc-mortality-watch.mjs - annual US death counts by cause, direct from CDC
// WONDER's "Underlying Cause of Death, 1999-2020" database (D76). No API key,
// but CDC WONDER enforces a hard 15-second gap between requests and prefers
// one query per 2 minutes for automated use — this script makes one request.
//
// IMPORTANT CAVEAT: this specific CDC WONDER database caps at 2020. CDC has
// published newer "Single Race" datasets (e.g. D158, 2018-2023) but their
// request-parameter scheme differs from D76's in a way that couldn't be
// reverse-engineered from the public API docs/examples in reasonable time —
// every attempt hit an opaque "must also select the {1} button" error with
// broken message templates. If you need current-year numbers, CDC's own NCHS
// press releases (https://www.cdc.gov/nchs/pressroom/) publish provisional
// figures well ahead of WONDER — e.g. the 2025 provisional overdose count
// (69,973, per the May 2026 release) isn't reachable through this script.
//
// Run:  node scripts/cdc-mortality-watch.mjs
//       node scripts/cdc-mortality-watch.mjs --cause suicide
//       node scripts/cdc-mortality-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, lineChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const D = "D76";

// ICD-10 underlying-cause-of-death code sets, as used in CDC's own published
// definitions (e.g. drug overdose = X40-X44, X60-X64, X85, Y10-Y14).
const CAUSES = {
  "drug-overdose": { label: "Drug overdose", codes: ["X40", "X41", "X42", "X43", "X44", "X60", "X61", "X62", "X63", "X64", "X85", "Y10", "Y11", "Y12", "Y13", "Y14"] },
  suicide: { label: "Suicide", codes: ["*U01-*U03", "X60-X84", "Y87.0"] },
  homicide: { label: "Homicide", codes: ["*U01-*U02", "X85-Y09", "Y87.1"] },
  "motor-vehicle": { label: "Motor vehicle traffic", codes: ["V02-V04", "V09", "V12-V14", "V19-V79", "V80-V89"] },
};

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function paramList(obj) {
  let s = "";
  for (const [k, v] of Object.entries(obj)) {
    s += `<parameter>\n<name>${k}</name>\n`;
    for (const val of Array.isArray(v) ? v : [v]) s += `<value>${val}</value>\n`;
    s += "</parameter>\n";
  }
  return s;
}

async function queryDeathsByYear(icdCodes) {
  const b = { B_1: `${D}.V1-level1`, B_2: "*None*", B_3: "*None*", B_4: "*None*", B_5: "*None*" };
  const m = { M_1: `${D}.M1`, M_2: `${D}.M2`, M_3: `${D}.M3` };
  const f = {
    [`F_${D}.V1`]: ["*All*"],
    [`F_${D}.V10`]: ["*All*"],
    [`F_${D}.V2`]: icdCodes,
    [`F_${D}.V27`]: ["*All*"],
    [`F_${D}.V9`]: ["*All*"],
  };
  const i = {
    [`I_${D}.V1`]: "*All* (All Dates)",
    [`I_${D}.V10`]: "*All* (The United States)",
    [`I_${D}.V2`]: icdCodes.join(","),
    [`I_${D}.V27`]: "*All* (The United States)",
    [`I_${D}.V9`]: "*All* (The United States)",
  };
  const o = {
    O_V10_fmode: "freg", O_V1_fmode: "freg", O_V27_fmode: "freg", O_V2_fmode: "freg", O_V9_fmode: "freg",
    O_aar: "aar_none", O_aar_pop: "0000", O_age: `${D}.V5`, O_javascript: "on", O_location: `${D}.V9`,
    O_precision: "1", O_rate_per: "100000", O_show_totals: "true", O_timeout: "300",
    O_title: "cdc-mortality-watch", O_ucd: `${D}.V2`, O_urban: `${D}.V19`,
  };
  const vm = {
    [`VM_${D}.M6_${D}.V10`]: "", [`VM_${D}.M6_${D}.V17`]: "*All*", [`VM_${D}.M6_${D}.V1_S`]: "*All*",
    [`VM_${D}.M6_${D}.V7`]: "*All*", [`VM_${D}.M6_${D}.V8`]: "*All*",
  };
  const v = {
    [`V_${D}.V1`]: "", [`V_${D}.V10`]: "", [`V_${D}.V11`]: "*All*", [`V_${D}.V12`]: "*All*", [`V_${D}.V17`]: "*All*",
    [`V_${D}.V19`]: "*All*", [`V_${D}.V2`]: "", [`V_${D}.V20`]: "*All*", [`V_${D}.V21`]: "*All*", [`V_${D}.V22`]: "*All*",
    [`V_${D}.V23`]: "*All*", [`V_${D}.V24`]: "*All*", [`V_${D}.V25`]: "*All*", [`V_${D}.V27`]: "", [`V_${D}.V4`]: "*All*",
    [`V_${D}.V5`]: "*All*", [`V_${D}.V51`]: "*All*", [`V_${D}.V52`]: "*All*", [`V_${D}.V6`]: "00", [`V_${D}.V7`]: "*All*",
    [`V_${D}.V8`]: "*All*", [`V_${D}.V9`]: "",
  };
  const misc = {
    "action-Send": "Send", [`finder-stage-${D}.V1`]: "codeset", [`finder-stage-${D}.V2`]: "codeset",
    [`finder-stage-${D}.V27`]: "codeset", [`finder-stage-${D}.V9`]: "codeset", stage: "request",
  };

  const xml = `<request-parameters>\n${paramList(b)}${paramList(m)}${paramList(f)}${paramList(i)}${paramList(o)}${paramList(vm)}${paramList(v)}${paramList(misc)}</request-parameters>`;
  const body = new URLSearchParams();
  body.set("request_xml", xml);
  body.set("accept_datause_restrictions", "true");

  const res = await fetch(`https://wonder.cdc.gov/controller/datarequest/${D}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`CDC WONDER HTTP ${res.status}: ${text.slice(0, 300)}`);
  if (/Processing Error/.test(text)) {
    const msgs = [...text.matchAll(/<message>([^<]+)<\/message>/g)].map((m) => m[1]);
    throw new Error(`CDC WONDER rejected the request: ${msgs.join(" | ") || "unknown error"}`);
  }

  const rows = [...text.matchAll(/<r>([\s\S]*?)<\/r>/g)]
    .map((m) => [...m[1].matchAll(/<c\s+(?:l="([^"]*)")?(?:v="([^"]*)")?\/>/g)].map((c) => c[1] ?? c[2]))
    .filter((cells) => cells.length >= 4 && /^\d{4}$/.test(cells[0]));

  return rows.map((c) => ({
    year: Number(c[0]),
    deaths: Number(String(c[1]).replace(/,/g, "")),
    population: Number(String(c[2]).replace(/,/g, "")),
    rate: Number(c[3]),
  }));
}

const causeKey = argValue("--cause", "drug-overdose");
if (!CAUSES[causeKey]) {
  console.error(`Unknown --cause "${causeKey}". Options: ${Object.keys(CAUSES).join(", ")}`);
  process.exit(1);
}
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `cdc-mortality-watch-${causeKey}-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const years = await queryDeathsByYear(CAUSES[causeKey].codes);
if (!years.length) throw new Error("CDC WONDER returned no year rows — the response format may have changed");

const first = years[0];
const latest = years[years.length - 1];
const peak = years.reduce((a, b) => (b.deaths > a.deaths ? b : a));
const changeFromFirst = ((latest.deaths - first.deaths) / first.deaths) * 100;

const pts = years.map((y) => ({ label: String(y.year), v: y.rate }));
const chartSVG = lineChart(
  [{ color: C.s1, points: pts, endLabel: (v) => v }],
  { fmtTick: (v) => v.toFixed(0), fmtVal: (v) => v.toFixed(1), labelStep: 2, yLabel: `${CAUSES[causeKey].label} deaths per 100k` }
);

const html = cardHTML({
  kicker: "CDC mortality check",
  title: `US ${CAUSES[causeKey].label.toLowerCase()} deaths, ${first.year}-${latest.year}`,
  hero: latest.deaths.toLocaleString("en-US"),
  heroLabel: `deaths in ${latest.year} · ${latest.rate.toFixed(1)} per 100,000`,
  chartSVG,
  source: "CDC WONDER, Underlying Cause of Death 1999-2020",
  vintage: String(latest.year),
});

const facebook = [
  "CDC mortality check:",
  "",
  `${CAUSES[causeKey].label} deaths in the US: ${latest.deaths.toLocaleString("en-US")} in ${latest.year} (${latest.rate.toFixed(1)} per 100,000 people) — ${changeFromFirst >= 0 ? "up" : "down"} ${Math.abs(changeFromFirst).toFixed(0)}% from ${first.deaths.toLocaleString("en-US")} in ${first.year}. Peak in this window: ${peak.deaths.toLocaleString("en-US")} in ${peak.year}.`,
  "",
  `Important limitation: CDC WONDER's "Underlying Cause of Death, 1999-2020" database is the most recent version of this specific dataset I could get working programmatically — it does not include 2021 onward. CDC has since published newer datasets, but their query format differs enough that I couldn't verify it live in the time I gave this. For current-year figures, CDC's own NCHS press releases (cdc.gov/nchs/pressroom) publish provisional numbers faster than WONDER updates — worth checking directly rather than assuming this chart is current.`,
  "",
  "Real numbers, real source — CDC WONDER Underlying Cause of Death:",
  "https://wonder.cdc.gov/ucd-icd10.html",
];

const lines = [
  `CDC mortality check (${stamp})`,
  "",
  `Cause: ${CAUSES[causeKey].label} | ICD-10 codes: ${CAUSES[causeKey].codes.join(", ")}`,
  "",
  "Year | Deaths | Population | Rate per 100k",
  "---:|---:|---:|---:",
  ...years.map((y) => `${y.year} | ${y.deaths.toLocaleString("en-US")} | ${y.population.toLocaleString("en-US")} | ${y.rate.toFixed(1)}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["year", "deaths", "population", "rate_per_100k"], years.map((y) => [y.year, y.deaths, y.population, y.rate])));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
