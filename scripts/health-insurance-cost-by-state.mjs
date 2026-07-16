#!/usr/bin/env node
import { readSheetRowsByName } from "./lib/xlsx-lite.mjs";
import { STATES, money } from "./lib/data-common.mjs";
import { writeStateRankingPost } from "./lib/state-ranking-post.mjs";

const year = 2024;
const clean = (value) => Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
async function fetchState(state) {
  const file = `${state.name.replaceAll(" ", "")}${year}.xlsx`;
  const url = `https://meps.ahrq.gov/data_stats/summ_tables/insr/excel/${year}/${file}`;
  const response = await fetch(url, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
  if (!response.ok) return null;
  const rows = readSheetRowsByName(Buffer.from(await response.arrayBuffer()), "Table II");
  const family = rows.find((row) => row[0] === "II.D.2");
  const deductible = rows.find((row) => row[0] === "II.F.2");
  const value = clean(family?.[2]), singleDeductible = clean(deductible?.[2]);
  return value > 0 ? { state: state.name, value, singleDeductible } : null;
}
const rows = [];
for (let i = 0; i < STATES.length; i += 8) {
  rows.push(...(await Promise.all(STATES.slice(i, i + 8).map(fetchState))).filter(Boolean));
}
writeStateRankingPost({
  topic: "health-insurance-cost-by-state", kicker: "Health-insurance cost check",
  title: "Employee contribution for family health coverage",
  question: "How much do enrolled private-sector employees contribute toward family health-insurance premiums across the states and D.C.?",
  rows, metricLabel: "average annual employee family-premium contribution", source: "AHRQ MEPS Insurance Component", vintage: String(year),
  sourceWebsite: "https://meps.ahrq.gov/mepsweb/data_stats/state_tables.jsp",
  note: "This measures the employee-paid portion of employer-sponsored family premiums at private-sector establishments, not the full premium or total healthcare spending. The accompanying data also report the average individual deductible for enrolled employees with single coverage whose plan has a deductible.",
  retrievalNote: "Information retrieved programmatically from an official downloadable dataset.",
  tickFormat: (value) => `$${Math.round(value / 1000)}k`,
  rowDetail: (row) => `${money(row.value)}/year family-premium contribution; ${money(row.singleDeductible)} average single-coverage deductible`,
  extraColumns: [{ key: "singleDeductible" }],
  noImage: process.argv.includes("--no-image"),
});
