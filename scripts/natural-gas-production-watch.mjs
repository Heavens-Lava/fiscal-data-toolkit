#!/usr/bin/env node
// U.S. dry natural gas production vs. the rest of the world, from EIA's
// International Energy Statistics.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, envValue, rel } from "./lib/data-common.mjs";

const eiaKey = envValue("EIA_API_KEY");
if (!eiaKey) throw new Error("Missing EIA_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `natural-gas-production-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const url = "https://api.eia.gov/v2/international/data/";
const latestQs = new URLSearchParams({
  api_key: eiaKey, frequency: "annual", "data[0]": "value",
  "facets[activityId][]": "1", "facets[productId][]": "26", "facets[unit][]": "BCF",
  "sort[0][column]": "period", "sort[0][direction]": "desc", length: "1",
});
const latestRes = await fetch(`${url}?${latestQs}`);
if (!latestRes.ok) throw new Error(`EIA API HTTP ${latestRes.status}`);
const period = (await latestRes.json()).response?.data?.[0]?.period;
if (!period) throw new Error("Could not determine latest EIA international period.");

const qs = new URLSearchParams({
  api_key: eiaKey, frequency: "annual", "data[0]": "value",
  "facets[activityId][]": "1", "facets[productId][]": "26", "facets[unit][]": "BCF",
  start: period, end: period, length: "300",
});
const res = await fetch(`${url}?${qs}`);
if (!res.ok) throw new Error(`EIA API HTTP ${res.status}`);
const json = await res.json();

const rows = (json.response?.data || [])
  .filter((r) => r.countryRegionTypeId === "c" && Number(r.value) > 0)
  .map((r) => ({ country: r.countryRegionName, bcf: Number(r.value) }))
  .sort((a, b) => b.bcf - a.bcf)
  .map((r, i) => ({ ...r, rank: i + 1 }));
if (!rows.length) throw new Error("No EIA international natural gas production rows.");

const top = rows.slice(0, 10);
const us = rows.find((r) => r.country === "United States");
const worldTotal = rows.reduce((s, r) => s + r.bcf, 0);

const chartSVG = horizontalBarChart(
  top.map((r) => ({ label: `#${r.rank} ${r.country}`, v: r.bcf, color: r.country === "United States" ? C.s2 : C.s1 })),
  { fmtTick: (v) => `${Math.round(v / 1000)}k`, fmtVal: (v) => `${Math.round(v).toLocaleString()} Bcf` }
);

const html = cardHTML({
  kicker: "Energy production check",
  title: "Dry natural gas production, by country",
  hero: `${Math.round(us.bcf).toLocaleString()} Bcf`,
  heroLabel: `United States; #${us.rank} of ${rows.length} countries, ${period}`,
  chartSVG, source: "U.S. EIA International Energy Statistics", vintage: period,
});

const facebook = [
  "America produces more natural gas than any other country on Earth.",
  "",
  `EIA's ${period} data (most recent complete year): dry natural gas production by country.`,
  "",
  "Top 10 producers:", ...top.map((r) => `#${r.rank} ${r.country}: ${Math.round(r.bcf).toLocaleString()} billion cubic feet`), "",
  `The U.S. alone accounts for ${((us.bcf / worldTotal) * 100).toFixed(1)}% of production among these ${rows.length} countries, and produces more than #2 (${rows[1].country}) and #3 (${rows[2].country}) combined.`,
  "",
  "Note: this is production volume, not consumption or exports — the U.S. also consumes most of what it produces domestically, unlike top exporters like Qatar.",
  "",
  "Source: U.S. Energy Information Administration, International Energy Statistics.",
].filter(Boolean);

const lines = [
  `Natural gas production watch (${STAMP})`, "", `EIA International Energy Statistics, ${period} dry natural gas production.`, "",
  "Rank | Country | Production (Bcf)",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.country} | ${Math.round(r.bcf).toLocaleString()}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "country", "production_bcf"], rows.map((r) => [r.rank, r.country, r.bcf])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
