#!/usr/bin/env node
// How much revenue e-commerce actually brings in across the U.S. economy —
// Census Bureau's Annual Integrated Economic Survey e-commerce statistics.
// Note: "e-commerce" here means any sale placed over an internet/EDI-based
// system (including B2B electronic ordering), not just online retail
// shopping — which is why manufacturing and wholesale trade, not retail,
// turn out to be the most e-commerce-heavy sectors.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, envValue, money, num, pct, rel } from "./lib/data-common.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `us-ecommerce-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

let year, data;
for (const candidate of [2023, 2022, 2021]) {
  const qs = new URLSearchParams({ get: "NAICS,RCPT_ECOMM_VAL,RCPT_TOT_VAL,ECOMM_DPCT", for: "us:*", time: String(candidate), key });
  const res = await fetch(`https://api.census.gov/data/timeseries/aies/ecom?${qs}`);
  if (!res.ok) continue;
  const json = await res.json();
  if (json.length > 1) { data = json; year = candidate; break; }
}
if (!year) throw new Error("No Census e-commerce vintage available.");

const [header, ...body] = data;
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const byNAICS = new Map(body.map((r) => [r[idx.NAICS], { ecomm: Number(r[idx.RCPT_ECOMM_VAL]), total: Number(r[idx.RCPT_TOT_VAL]), pct: Number(r[idx.ECOMM_DPCT]) }]));

// Top-level NAICS sectors covered by this survey ("selected sectors" — no
// agriculture, construction, mining, or public administration). Wholesale
// trade (NAICS 42) has no single combined row in this release, so its two
// subsectors (423 durable, 424 nondurable goods) are summed instead.
const SECTORS = [
  { code: "31-33", label: "Manufacturing" },
  { code: "44-45", label: "Retail trade" },
  { code: "48-49", label: "Transportation & warehousing" },
  { code: "51", label: "Information" },
  { code: "52", label: "Finance & insurance" },
  { code: "53", label: "Real estate & rental" },
  { code: "54", label: "Professional & technical services" },
  { code: "56", label: "Administrative & support services" },
  { code: "61", label: "Educational services" },
  { code: "62", label: "Health care & social assistance" },
  { code: "71", label: "Arts, entertainment & recreation" },
  { code: "72", label: "Accommodation & food services" },
  { code: "81", label: "Other services" },
  { code: "22", label: "Utilities" },
];
const wholesale423 = byNAICS.get("423") || { ecomm: 0, total: 0 };
const wholesale424 = byNAICS.get("424") || { ecomm: 0, total: 0 };
const wholesale = { ecomm: wholesale423.ecomm + wholesale424.ecomm, total: wholesale423.total + wholesale424.total };
const rows = [
  { label: "Wholesale trade", ecomm: wholesale.ecomm, total: wholesale.total, sharePct: wholesale.total ? (wholesale.ecomm / wholesale.total) * 100 : 0 },
  ...SECTORS.map(({ code, label }) => {
    const d = byNAICS.get(code);
    return d ? { label, ecomm: d.ecomm, total: d.total, sharePct: d.pct } : null;
  }).filter(Boolean),
].filter((r) => r.ecomm > 0).sort((a, b) => b.ecomm - a.ecomm);

const grandTotalEcomm = rows.reduce((s, r) => s + r.ecomm, 0) * 1000; // survey values are in $1,000s
const retail = rows.find((r) => r.label === "Retail trade");

const fmtCompactUsd = (v) => v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : `$${(v / 1e9).toFixed(0)}B`;
const top = rows.slice(0, 10);
const chartSVG = horizontalBarChart(
  top.map((r) => ({ label: r.label, v: r.ecomm * 1000, color: r.label === "Retail trade" ? C.s2 : C.s1 })),
  { fmtTick: (v) => `$${(v / 1e12).toFixed(1)}T`, fmtVal: fmtCompactUsd }
);

const html = cardHTML({
  kicker: "E-commerce check",
  title: "How much revenue does e-commerce actually bring in?",
  hero: `$${(grandTotalEcomm / 1e12).toFixed(1)}T`,
  heroLabel: `total e-commerce sales across major U.S. industries, ${year}`,
  chartSVG, source: "U.S. Census Bureau", vintage: String(year),
});

const facebook = [
  "How much money does \"the internet\" actually bring in?",
  "",
  `Census Bureau data, ${year} — e-commerce sales (orders placed electronically, including business-to-business systems) across major U.S. industries.`,
  "",
  `Total: about $${(grandTotalEcomm / 1e12).toFixed(1)} trillion in e-commerce sales in ${year}, across the industries this survey covers.`,
  "",
  "By industry (e-commerce sales):", ...top.map((r) => `${r.label}: ${money(r.ecomm * 1000)} (${pct(r.sharePct)} of that industry's total sales)`), "",
  retail ? `For comparison, online retail shopping — what most people picture as "e-commerce" — is ${money(retail.ecomm * 1000)}, just ${pct(retail.sharePct)} of all retail sales.` : "",
  "",
  "Note: \"e-commerce\" in this data means any sale placed through an internet-connected or electronic system, including business-to-business ordering platforms — that's why manufacturing and wholesale trade rank far above retail. This is not just online shopping.",
  "",
  "Source: U.S. Census Bureau, Annual Integrated Economic Survey (e-commerce statistics).",
].filter(Boolean);

const lines = [
  `US e-commerce watch (${STAMP})`, "", `Census Bureau, ${year} e-commerce sales by industry.`, "",
  "Industry | E-commerce sales | Share of industry's total sales",
  "---|---:|---:",
  ...rows.map((r) => `${r.label} | ${money(r.ecomm * 1000)} | ${pct(r.sharePct)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["industry", "ecommerce_sales_usd", "total_sales_usd", "ecommerce_share_pct"], rows.map((r) => [r.label, r.ecomm * 1000, r.total * 1000, r.sharePct])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
