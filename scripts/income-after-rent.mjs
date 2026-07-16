#!/usr/bin/env node
import { censusRows, envValue, money } from "./lib/data-common.mjs";
import { writeStateRankingPost } from "./lib/state-ranking-post.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const year = 2024;
const data = await censusRows(year, "acs/acs1", ["B25064_001E", "B25119_003E"], "state:*", key);
writeStateRankingPost({
  topic: "income-after-rent", kicker: "Rent paycheck check", title: "Monthly renter income left after gross rent",
  question: "After gross rent, how much monthly renter-household income is left in each state?",
  rows: data.filter((row) => row.state !== "72").map((row) => {
    const rent = Number(row.B25064_001E), renterIncome = Number(row.B25119_003E);
    return { state: row.NAME, rent, renterIncome, value: renterIncome / 12 - rent };
  }),
  metricLabel: "monthly renter income remaining after gross rent", source: "U.S. Census Bureau ACS", vintage: String(year),
  sourceWebsite: "https://api.census.gov/data/2024/acs/acs1/groups/B25119.html",
  note: "Gross rent includes rent plus renter-paid utilities. This subtracts the state median gross rent from one-twelfth of renter-household median income. Because these are separate medians, it is a state comparison, not the budget of one specific household.",
  tickFormat: money,
  rowDetail: (row) => `${money(row.value)}/month left (${money(row.renterIncome / 12)} renter income minus ${money(row.rent)} gross rent)`,
  extraColumns: [{ key: "renterIncome" }, { key: "rent" }],
  noImage: process.argv.includes("--no-image"),
});
