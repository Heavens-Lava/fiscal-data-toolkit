#!/usr/bin/env node
import { STATES, envValue } from "./lib/data-common.mjs";
import { writeStateRankingPost } from "./lib/state-ranking-post.mjs";

const key = envValue("BLS_API_KEY");
const targets = STATES.map((state) => ({ ...state, id: `JTS000000${state.fips}0000000UOR` }));
const byId = new Map(targets.map((state) => [state.id, state]));
const series = [];
for (let i = 0; i < targets.length; i += key ? 50 : 25) {
  const body = { seriesid: targets.slice(i, i + (key ? 50 : 25)).map((state) => state.id), latest: true };
  if (key) body.registrationkey = key;
  const response = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`BLS API HTTP ${response.status}`);
  const json = await response.json();
  if (json.status !== "REQUEST_SUCCEEDED") throw new Error((json.message || [json.status]).join("; "));
  series.push(...json.Results.series);
}
const rows = series.map((item) => {
  const state = byId.get(item.seriesID), point = item.data?.find((entry) => Number.isFinite(Number(entry.value)));
  return state && point ? { state: state.name, value: Number(point.value), period: `${point.periodName} ${point.year}` } : null;
}).filter(Boolean);
const vintage = rows[0]?.period || "December 2025";
writeStateRankingPost({
  topic: "job-openings-competition", kicker: "Labor-market competition",
  title: "Unemployed people per job opening, by state",
  question: "How many unemployed people are competing for each job opening in every state?",
  rows, metricLabel: "unemployed people per job opening", source: "BLS JOLTS", vintage,
  sourceWebsite: "https://www.bls.gov/charts/state-job-openings-and-labor-turnover/state-unemployed-persons-per-job-opening-seasonally-adjusted.htm",
  note: "A higher number means more unemployed people per available opening; a lower number means openings outnumber unemployed workers. JOLTS state estimates are model-based and cover total nonfarm jobs.",
  valueFormat: (value) => `${value.toFixed(1)} people`, tickFormat: (value) => value.toFixed(1),
  noImage: process.argv.includes("--no-image"),
});
