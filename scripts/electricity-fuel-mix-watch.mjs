#!/usr/bin/env node
// Where America's electricity comes from — national generation by fuel
// source, from EIA Form EIA-923 operational data.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, envValue, num, pct, rel } from "./lib/data-common.mjs";

const eiaKey = envValue("EIA_API_KEY");
if (!eiaKey) throw new Error("Missing EIA_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `electricity-fuel-mix-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

// Top-level, non-overlapping EIA operational fuel-type codes (verified to
// sum close to "ALL" — see scripts/lib/eia-utilities.mjs comment history for
// the reconciliation check against overlapping sub-categories like "all
// renewables" vs individual wind/solar/hydro, which double-count if mixed).
const CATEGORIES = [
  { id: "NGO", label: "Natural gas" },
  { id: "COW", label: "Coal" },
  { id: "REN", label: "Renewables (wind, solar, hydro, biomass, geothermal)" },
  { id: "NUC", label: "Nuclear" },
  { id: "PET", label: "Petroleum" },
  { id: "OTH", label: "Other" },
];

const url = "https://api.eia.gov/v2/electricity/electric-power-operational-data/data/";
const latestQs = new URLSearchParams({
  api_key: eiaKey, frequency: "annual", "data[0]": "generation",
  "facets[fueltypeid][]": "ALL", "facets[sectorid][]": "99", "facets[location][]": "US",
  "sort[0][column]": "period", "sort[0][direction]": "desc", length: "1",
});
const latestRes = await fetch(`${url}?${latestQs}`);
if (!latestRes.ok) throw new Error(`EIA API HTTP ${latestRes.status}`);
const period = (await latestRes.json()).response?.data?.[0]?.period;
if (!period) throw new Error("Could not determine latest EIA electricity period.");

const qs = new URLSearchParams({
  api_key: eiaKey, frequency: "annual", "data[0]": "generation",
  "facets[sectorid][]": "99", "facets[location][]": "US", start: period, end: period, length: "5000",
});
const res = await fetch(`${url}?${qs}`);
if (!res.ok) throw new Error(`EIA API HTTP ${res.status}`);
const json = await res.json();
const byFuel = new Map((json.response?.data || []).map((d) => [d.fueltypeid, Number(d.generation)]));

const rows = CATEGORIES
  .map((c) => ({ ...c, gwh: byFuel.get(c.id) }))
  .filter((r) => Number.isFinite(r.gwh))
  .sort((a, b) => b.gwh - a.gwh);
if (!rows.length) throw new Error("No EIA national fuel-mix rows.");
const total = rows.reduce((s, r) => s + r.gwh, 0);
const withShare = rows.map((r) => ({ ...r, share: (r.gwh / total) * 100 }));

const chartSVG = horizontalBarChart(
  withShare.map((r) => ({ label: r.label, v: r.share, color: r.id === "NGO" ? C.s1 : r.id === "REN" ? C.s2 : C.neg })),
  { fmtTick: (v) => `${Math.round(v)}%`, fmtVal: (v) => pct(v) }
);

const html = cardHTML({
  kicker: "Electricity mix check",
  title: "Where America's electricity comes from",
  hero: pct(withShare[0].share),
  heroLabel: `${withShare[0].label}, ${period}`,
  chartSVG, source: "U.S. EIA (Form EIA-923)", vintage: period,
});

const facebook = [
  "Where does America's electricity actually come from?",
  "",
  `EIA ${period} data — national electricity generation by fuel source.`,
  "",
  ...withShare.map((r) => `${r.label}: ${pct(r.share)} (${num(r.gwh)} GWh)`), "",
  "Note: \"Renewables\" here bundles wind, solar, hydro, biomass, and geothermal together per EIA's own reporting category — it is not broken out further in this post. Shares may not sum to exactly 100% due to a small net adjustment for pumped-storage hydro (which consumes as well as generates power).",
  "",
  "Source: U.S. Energy Information Administration, Form EIA-923 (electric power operational data).",
].filter(Boolean);

const lines = [
  `Electricity fuel mix watch (${STAMP})`, "", `EIA Form EIA-923, ${period} national generation by fuel source.`, "",
  "Fuel source | Generation (GWh) | Share",
  "---|---:|---:",
  ...withShare.map((r) => `${r.label} | ${num(r.gwh)} | ${pct(r.share)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["fuel_source", "generation_gwh", "share_pct"], withShare.map((r) => [r.label, r.gwh, r.share])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
