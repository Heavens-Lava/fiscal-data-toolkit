#!/usr/bin/env node
import { censusRows, envValue, money } from "./lib/data-common.mjs";
import { writeStateRankingPost } from "./lib/state-ranking-post.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const year = 2024;
const data = await censusRows(year, "acs/acs1", ["B25103_002E"], "state:*", key);
writeStateRankingPost({
  topic: "property-tax-by-state", kicker: "Property-tax check", title: "Median property-tax bill for mortgaged homes",
  question: "What is the median annual property-tax bill for homeowners with a mortgage in each state?",
  rows: data.filter((row) => row.state !== "72").map((row) => ({ state: row.NAME, value: Number(row.B25103_002E) })),
  metricLabel: "median annual real-estate taxes paid", source: "U.S. Census Bureau ACS", vintage: String(year),
  sourceWebsite: "https://api.census.gov/data/2024/acs/acs1/groups/B25103.html",
  note: "These are median real-estate taxes actually paid for owner-occupied units with a mortgage. They are dollar bills, not tax rates; states with more expensive homes can rank high even with a lower effective rate.",
  tickFormat: money,
  noImage: process.argv.includes("--no-image"),
});
