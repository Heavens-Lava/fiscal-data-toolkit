#!/usr/bin/env node
// Rent + center-based childcare (infant & preschooler) + utilities (electricity
// + natural gas) for a family with two young kids, by state.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { readFirstSheetRows } from "./lib/xlsx-lite.mjs";
import { SOCIAL, STAMP, argValue, censusRows, envValue, money, pct, rel, uniqueRows } from "./lib/data-common.mjs";
import { NATIONAL_AVG_ANNUAL_GAS_MCF, fetchElectricity, fetchGas } from "./lib/eia-utilities.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const eiaKey = envValue("EIA_API_KEY");
if (!eiaKey) throw new Error("Missing EIA_API_KEY in .env.");
const view = String(argValue("--view", "burden")).toLowerCase();
if (!["burden", "cost"].includes(view)) throw new Error("--view must be burden or cost.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `family-cost-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const workbookUrl = "https://www.dol.gov/sites/dolgov/files/WB/NDCP2022-state-level-estimates-and-rankings.xlsx";
const workbookRes = await fetch(workbookUrl, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
if (!workbookRes.ok) throw new Error(`DOL workbook HTTP ${workbookRes.status}`);
const sheet = readFirstSheetRows(Buffer.from(await workbookRes.arrayBuffer()));
const [header, ...body] = sheet;
const idx = Object.fromEntries(header.map((name, i) => [String(name).trim(), i]));
const year = Math.max(...body.map((r) => Number(r[idx.STUDYYEAR])).filter(Number.isFinite));
const childRows = body.filter((r) => Number(r[idx.STUDYYEAR]) === year && r[idx.TYPE] === "Center")
  .map((r) => ({ state: r[idx.STATE_NAME], infantWeekly: Number(r[idx.MEDIAN_INFANT_PRICE]), preschoolWeekly: Number(r[idx.MEDIAN_PRESCHOOL_PRICE]) }))
  .filter((r) => r.infantWeekly > 0 && r.preschoolWeekly > 0);

const [acs, electricity, gas] = await Promise.all([
  censusRows(year, "acs/acs1/profile", ["DP04_0134E", "DP03_0062E"], "state:*", key),
  fetchElectricity(eiaKey),
  fetchGas(eiaKey),
]);
const acsByState = new Map(acs.map((r) => [r.NAME, { rent: Number(r.DP04_0134E), income: Number(r.DP03_0062E), stateCode: r.state }]));
const rows = childRows.map((r) => {
  const local = acsByState.get(r.state);
  const annualElectric = electricity.byState.get(r.state);
  const annualGas = gas.byState.get(r.state);
  if (!local || local.stateCode === "72" || !annualElectric || !annualGas) return null;
  const annualRent = local.rent * 12;
  const infantCare = r.infantWeekly * 52;
  const preschoolCare = r.preschoolWeekly * 52;
  const combined = annualRent + infantCare + preschoolCare + annualElectric + annualGas;
  return { ...r, ...local, annualRent, infantCare, preschoolCare, annualElectric, annualGas, combined, incomeShare: combined / local.income * 100 };
}).filter(Boolean);
if (!rows.length) throw new Error("No matched DOL, Census, and EIA family-cost rows.");
const byCost = [...rows].sort((a, b) => b.combined - a.combined).map((r, i) => ({ ...r, costRank: i + 1 }));
const costRank = new Map(byCost.map((r) => [r.state, r.costRank]));
const byBurden = [...rows].sort((a, b) => b.incomeShare - a.incomeShare).map((r, i) => ({ ...r, burdenRank: i + 1 }));
const burdenRank = new Map(byBurden.map((r) => [r.state, r.burdenRank]));
const ranked = (view === "cost" ? byCost : byBurden).map((r, i) => ({
  ...r, costRank: costRank.get(r.state), burdenRank: burdenRank.get(r.state), rank: i + 1,
}));

const az = ranked.find((r) => r.state === "Arizona");
const top = ranked.slice(0, 5);
const bottom = ranked.slice(-5).reverse();
const chartRows = uniqueRows([...top, az, ...bottom.toReversed()], "state");
const chartSVG = horizontalBarChart(chartRows.map((r) => ({
  label: `#${r.rank} ${r.state}`, v: view === "cost" ? r.combined : r.incomeShare, color: r.state === "Arizona" ? C.s2 : C.s1,
})), { fmtTick: view === "cost" ? (v) => `$${Math.round(v / 1000)}k` : (v) => `${Math.round(v)}%`, fmtVal: view === "cost" ? money : (v) => pct(v) });
const html = cardHTML({
  kicker: "Family cost check",
  title: view === "cost" ? "Rent, childcare + utilities, family with 2 young kids" : "Rent, childcare + utilities as a share of income, family with 2 young kids",
  hero: view === "cost" ? money(top[0].combined) : pct(top[0].incomeShare), heroLabel: `${top[0].state}; rent + care + utilities for two children versus median income`,
  chartSVG, source: "U.S. DOL NDCP; U.S. Census Bureau ACS; U.S. EIA", vintage: String(year),
});
const facebook = [
  `How much of a typical household income can rent, childcare, and utilities consume?`,
  `${ranked[0].state} ranks highest at ${view === "cost" ? money(ranked[0].combined) : pct(ranked[0].incomeShare)}, while ${ranked.at(-1).state} ranks lowest at ${view === "cost" ? money(ranked.at(-1).combined) : pct(ranked.at(-1).incomeShare)}.`, "",
  `This ${year} scenario combines statewide median gross rent, center-based care for one infant and one preschooler, average residential electricity bills, and estimated natural gas.`, "",
  view === "cost" ? "State | Annual rent + childcare + utilities" : "State | Share of median household income",
  ...ranked.map((r) => `#${r.rank} ${r.state} | ${view === "cost" ? `${money(r.combined)}/year (${money(r.combined / 12)}/month)` : pct(r.incomeShare)}`), "",
  az ? `Arizona ranks #${az.rank}: ${money(az.annualRent)} rent + ${money(az.infantCare)} infant care + ${money(az.preschoolCare)} preschool care + ${money(az.annualElectric)} electricity + ${money(az.annualGas)} estimated gas = ${money(az.combined)}, or ${pct(az.incomeShare)} of median household income.` : "", "",
  `This comparison includes ${ranked.length} states with complete matched estimates. It is not a complete family budget: food, healthcare, transportation, taxes and other expenses are excluded. Statewide medians also hide large local differences, and not every household has childcare or natural-gas costs.`, "",
  "Which household should I calculate next: one child, two school-age children, or a single parent? Comment below and share this with a parent of young children.", "",
  "Sources:", "• U.S. Department of Labor National Database of Childcare Prices", "• U.S. Census Bureau ACS", "• U.S. Energy Information Administration",
  "Source website: https://www.dol.gov/agencies/wb/topics/childcare/price-by-age-care-setting",
  "Census and EIA information retrieved programmatically via API; childcare figures were read programmatically from the Department of Labor's published workbook.",
  "Graph made by Jeffrey Macy.",
].filter(Boolean);
const lines = [
  `Family cost watch (${STAMP})`, "", `Scenario: median gross rent + center-based care for one infant and one preschooler + average residential electricity + estimated natural gas. Vintage: ${year}.`, "",
  view === "cost" ? "State | Annual rent + childcare + utilities" : "State | Rent + childcare + utilities share of income",
  "---|---:",
  ...ranked.map((r) => `#${r.rank} ${r.state} | ${view === "cost" ? money(r.combined) : pct(r.incomeShare)}`), "",
  "Facebook post", "-------------", facebook.join("\n"), "",
  `Note: Ranking shown is by ${view === "cost" ? "combined annual cost" : "combined cost as a share of median household income"}. DOL childcare prices are weekly state medians x52; Census gross rent is monthly x12; electricity is EIA's reported monthly revenue/customers x12 (actual state billing data); natural gas is EIA's state residential price x a national-average annual usage assumption of ${NATIONAL_AVG_ANNUAL_GAS_MCF} Mcf/year, not state-specific consumption.`,
];
writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["display_rank", "cost_rank", "burden_rank", "state", "annual_rent", "annual_infant_center_care", "annual_preschool_center_care", "annual_electricity", "annual_gas_estimate", "combined", "median_household_income", "income_share_pct", "vintage"],
  ranked.map((r) => [r.rank, r.costRank, r.burdenRank, r.state, r.annualRent, r.infantCare, r.preschoolCare, r.annualElectric, r.annualGas, r.combined, r.income, r.incomeShare, year])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
