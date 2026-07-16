#!/usr/bin/env node
import { censusRows, envValue, money } from "./lib/data-common.mjs";
import { writeStateRankingPost } from "./lib/state-ranking-post.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const year = 2024;
const data = await censusRows(year, "acs/acs1/profile", ["DP04_0101E"], "state:*", key);
writeStateRankingPost({
  topic: "homeowner-monthly-cost", kicker: "Homeowner cost check",
  title: "Monthly costs for homeowners with a mortgage",
  question: "What do homeowners with a mortgage actually pay each month across the states and D.C.?",
  rows: data.filter((row) => row.state !== "72").map((row) => ({ state: row.NAME, value: Number(row.DP04_0101E), incomeNeeded: Number(row.DP04_0101E) * 12 / 0.30 })),
  metricLabel: "median monthly owner costs", source: "U.S. Census Bureau ACS", vintage: String(year),
  sourceWebsite: "https://api.census.gov/data/2024/acs/acs1/profile/groups/DP04.html",
  note: "This is the ACS median for current homeowners with a mortgage, not a quote for buying today. It includes mortgage payments, real-estate taxes, property insurance, utilities, fuels, mobile-home costs, and applicable condo fees. The 30% income figure is a simple affordability benchmark, not a lending rule.",
  tickFormat: money,
  rowDetail: (row) => `${money(row.value)}/month; about ${money(row.incomeNeeded)}/year income at a 30% benchmark`,
  extraColumns: [{ key: "incomeNeeded" }],
  noImage: process.argv.includes("--no-image"),
});
