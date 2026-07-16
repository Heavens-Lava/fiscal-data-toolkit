#!/usr/bin/env node
// Named large rental owners, paired with the Census/HUD national rental-unit total.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, envValue, getJSON, num, parseTable, pct, rel } from "./lib/data-common.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `largest-rental-owners-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const qs = new URLSearchParams({
  get: "CHARACTERISTIC,ESTIMATE_UNITS",
  TABLE_CODE: "2", ST_L1: "204", FGSZ: "0", BGR: "1", ucgid: "0100000US", key,
});
const rhfs = parseTable(await getJSON(`https://api.census.gov/data/2024/rhfs?${qs}`, "Census RHFS"));
const totalUnits = Number(rhfs.find((row) => row.CHARACTERISTIC === "Total")?.ESTIMATE_UNITS) * 1000;
const entityUnits = Number(rhfs.find((row) => row.CHARACTERISTIC === "LLP, LP or LLC")?.ESTIMATE_UNITS) * 1000;
if (!Number.isFinite(totalUnits) || !Number.isFinite(entityUnits)) throw new Error("RHFS rental-unit totals were not returned.");

// NMHC figures are units owned as of Jan. 1, 2026. Public-company figures are
// year-end 2025 totals reported in each company's SEC Form 10-K.
const owners = [
  { owner: "Greystar", units: 119160, type: "Multifamily apartments", source: "NMHC 2026" },
  { owner: "Morgan Properties", units: 110475, type: "Multifamily apartments", source: "NMHC 2026" },
  { owner: "MAA", units: 103083, type: "Multifamily apartments", source: "NMHC 2026" },
  { owner: "Invitation Homes", units: 86192, type: "Wholly owned single-family homes", source: "2025 SEC 10-K" },
  { owner: "American Homes 4 Rent", units: 61479, type: "Single-family properties", source: "2025 SEC 10-K" },
].map((row, index) => ({ ...row, rank: index + 1, nationalShare: row.units / totalUnits * 100 }));

const chartSVG = horizontalBarChart(owners.map((row, index) => ({
  label: row.owner,
  v: row.units / 1000,
  color: index < 3 ? C.s1 : C.s2,
})), {
  fmtTick: (value) => `${Math.round(value)}K`,
  fmtVal: (value) => `${Math.round(value)}K`,
});

const html = cardHTML({
  kicker: "Rental ownership check",
  title: "Large named U.S. rental owners",
  hero: num(owners[0].units),
  heroLabel: "units owned by Greystar; 2026 NMHC ranking",
  chartSVG,
  source: "Census/HUD RHFS, NMHC and SEC filings",
  vintage: "2024-2026",
});

const facebook = [
  "Does one LLC own 42.7% of America's rental housing? No.", "",
  `The Census/HUD estimate means ${num(entityUnits)} rental units are legally held through LLPs, LPs or LLCs. It does not identify one company, and an LLC can represent either a local landlord or a national investment firm.`, "",
  "Some of the largest named rental owners:",
  ...owners.map((row) => `#${row.rank} ${row.owner}: ${num(row.units)} ${row.type.toLowerCase()}`), "",
  `Greystar's ${num(owners[0].units)} owned units equal about ${pct(owners[0].nationalShare, 2)} of the roughly ${num(totalUnits)} rental units in the national RHFS estimate. Ownership can be much more concentrated within individual cities than this national comparison suggests.`, "",
  "Owned and managed are different: Greystar manages more than one million apartments, but the 2026 NMHC ownership ranking reports 119,160 owned units. Invitation Homes also reports jointly owned and managed-only homes separately from its 86,192 wholly owned homes.", "",
  "The national Census data does not publish the names behind individual LLCs. Identifying those requires county parcel records and corporate-registration research.", "",
  "Should the next breakdown focus on Arizona, Maricopa County, or another state? Comment with the place you want checked.", "",
  "Sources:", "• U.S. Census Bureau/HUD Rental Housing Finance Survey", "• 2026 NMHC owner ranking", "• SEC company filings",
  "Source website: https://www.census.gov/data/developers/data-sets/rhfs.html",
  "2026 NMHC ranking: https://www.multifamilyexecutive.com/top-50/2026-nmhc-top-50-owners",
  "SEC filings: https://www.sec.gov/edgar/search/",
  "Census totals and published company disclosures were processed programmatically; named-owner figures were compiled from the cited rankings and filings.",
  "Graph made by Jeffrey Macy.",
];

const lines = [
  `Large named U.S. rental owners (${STAMP})`, "",
  "Owner | Units owned",
  "---|---:",
  ...owners.map((row) => `#${row.rank} ${row.owner} | ${num(row.units)}`), "",
  "Facebook post", "-------------", facebook.join("\n"), "",
  "Notes: NMHC multifamily figures are units owned as of Jan. 1, 2026. Invitation Homes and AMH figures come from year-end 2025 SEC filings. This is a selected cross-sector comparison, not a complete ranking of every public, private or government landlord. RHFS excludes public housing.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "owner", "units_owned", "rental_type", "source", "share_of_rhfs_total_pct"],
  owners.map((row) => [row.rank, row.owner, row.units, row.type, row.source, row.nationalShare]),
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`)).join(" / ")}`);
