#!/usr/bin/env node
// Average auto insurance expenditure per insured vehicle, by state.
//
// Unlike every other script in this toolkit, this one is NOT a live API
// pull: NAIC only publishes this report every 1-2 years, as a PDF (no API).
// Data is manually transcribed in lib/naic-auto-insurance-2023.mjs from
// NAIC's own "Auto Insurance Database Average Premium Supplement" — see
// that file for the refresh procedure and a caution about PDF text
// extraction misaligning rows.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, money, rel } from "./lib/data-common.mjs";
import { AVG_EXPENDITURE_PER_VEHICLE, COUNTRYWIDE_AVG_EXPENDITURE, PUBLISHED, REPORT_YEAR, SOURCE_URL } from "./lib/naic-auto-insurance-2023.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `auto-insurance-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const rows = Object.entries(AVG_EXPENDITURE_PER_VEHICLE)
  .map(([state, value]) => ({ state, value, monthly: value / 12 }))
  .sort((a, b) => b.value - a.value)
  .map((r, i) => ({ ...r, rank: i + 1 }));
const countrywideMonthly = COUNTRYWIDE_AVG_EXPENDITURE / 12;

const az = rows.find((r) => r.state === "Arizona");
const highest = rows.slice(0, 5);
const lowest = rows.slice(-5).reverse();

const chartRows = [...highest, ...lowest.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({ label: `#${r.rank} ${r.state}`, v: r.value, color: r.state === "Arizona" ? C.s2 : r.rank <= 5 ? C.neg : C.s1 })),
  { fmtTick: (v) => `$${Math.round(v / 1000)}k`, fmtVal: money }
);

const html = cardHTML({
  kicker: "Auto insurance check",
  title: "Average auto insurance cost per vehicle, by state",
  hero: money(highest[0].value),
  heroLabel: `${highest[0].state}; average expenditure per insured vehicle, ${REPORT_YEAR} (${money(highest[0].monthly)}/mo)`,
  chartSVG, source: "NAIC Auto Insurance Database", vintage: `${REPORT_YEAR} (published ${PUBLISHED})`,
});

const facebook = [
  "How much does auto insurance really cost where you live?",
  "",
  `NAIC's ${REPORT_YEAR} data (their most recent, published ${PUBLISHED} — this report only comes out every 1-2 years, not annually): average expenditure per insured vehicle by state. Monthly figures below are just the annual amount divided by 12, not a separate NAIC monthly figure.`,
  "",
  "Highest:", ...highest.map((r) => `#${r.rank} ${r.state}: ${money(r.value)}/year (${money(r.monthly)}/mo)`), "",
  "Lowest:", ...lowest.map((r) => `#${r.rank} ${r.state}: ${money(r.value)}/year (${money(r.monthly)}/mo)`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${money(az.value)}/year (${money(az.monthly)}/mo).` : "",
  "",
  `Countrywide average: ${money(COUNTRYWIDE_AVG_EXPENDITURE)}/year (${money(countrywideMonthly)}/mo).`,
  "",
  "This is cost PER INSURED VEHICLE, not per person or per household — a two-car household pays roughly double this. It also blends all coverage levels and driver risk profiles statewide, so your actual quote depends heavily on your driving record, vehicle, and coverage choices.",
  "",
  `Source: National Association of Insurance Commissioners (NAIC), state insurance regulators — Auto Insurance Database Average Premium Supplement, ${REPORT_YEAR} data.`,
  SOURCE_URL,
].filter(Boolean);

const lines = [
  `Auto insurance watch (${STAMP})`, "",
  `NAIC Auto Insurance Database, ${REPORT_YEAR} data (published ${PUBLISHED} — updated by NAIC roughly every 1-2 years, not a live/annual feed). Monthly = annual ÷ 12, not a separately published NAIC figure.`, "",
  "Rank | State | Avg expenditure per insured vehicle (annual) | Monthly",
  "---:|---|---:|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${money(r.value)} | ${money(r.monthly)}`), "",
  `Countrywide | ${money(COUNTRYWIDE_AVG_EXPENDITURE)} | ${money(countrywideMonthly)}`, "",
  "Facebook post", "-------------", facebook.join("\n"), "",
  `Note: figures are NAIC's "Average Expenditure" per insured vehicle (liability + collision + comprehensive, statewide blend of all drivers/coverage levels) — not per person or per household. Monthly amounts are the annual figure divided by 12, not an independently published NAIC statistic. This dataset is manually updated when NAIC republishes it, unlike the rest of this toolkit's live API feeds. Source: ${SOURCE_URL}`,
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "avg_expenditure_per_vehicle_annual", "avg_expenditure_per_vehicle_monthly"], rows.map((r) => [r.rank, r.state, r.value, r.monthly])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
