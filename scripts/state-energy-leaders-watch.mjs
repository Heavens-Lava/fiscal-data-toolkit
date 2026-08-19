#!/usr/bin/env node
// state-energy-leaders-watch.mjs — which state leads U.S. electricity
// generation for each major fuel source, in one card instead of four
// separate near-identical ranking posts (state-wind/coal/nuclear/hydro-
// generation-watch). Same EIA Form EIA-923 data those scripts use.
//
// Run:  node scripts/state-energy-leaders-watch.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, metricListCard, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { envValue, STATES } from "./lib/data-common.mjs";

const stateNames = new Set(STATES.map((s) => s.name));

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}
function num(n) {
  return Math.round(n).toLocaleString("en-US");
}

const FUELS = [
  { key: "wind", id: "WND", label: "Wind", color: C.cat[0], badge: "WND" },
  { key: "coal", id: "COW", label: "Coal", color: C.cat[7], badge: "COAL" },
  { key: "nuclear", id: "NUC", label: "Nuclear", color: C.cat[3], badge: "NUC" },
  { key: "hydro", id: "HYC", label: "Hydroelectric", color: C.cat[2], badge: "HYD" },
];

const eiaKey = envValue("EIA_API_KEY");
if (!eiaKey) throw new Error("Missing EIA_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, `state-energy-leaders-watch-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

const url = "https://api.eia.gov/v2/electricity/electric-power-operational-data/data/";

async function leaderFor(fuel) {
  const latestQs = new URLSearchParams({
    api_key: eiaKey, frequency: "annual", "data[0]": "generation",
    "facets[fueltypeid][]": fuel.id, "facets[sectorid][]": "99", "facets[location][]": "US",
    "sort[0][column]": "period", "sort[0][direction]": "desc", length: "1",
  });
  const latestRes = await fetch(`${url}?${latestQs}`);
  if (!latestRes.ok) throw new Error(`EIA API HTTP ${latestRes.status} (${fuel.label})`);
  const period = (await latestRes.json()).response?.data?.[0]?.period;
  if (!period) throw new Error(`Could not determine latest EIA period for ${fuel.label}.`);

  const qs = new URLSearchParams({
    api_key: eiaKey, frequency: "annual", "data[0]": "generation",
    "facets[fueltypeid][]": fuel.id, "facets[sectorid][]": "99", start: period, end: period, length: "5000",
  });
  const res = await fetch(`${url}?${qs}`);
  if (!res.ok) throw new Error(`EIA API HTTP ${res.status} (${fuel.label})`);
  const rows = ((await res.json()).response?.data || [])
    .map((d) => ({ state: d.stateDescription, gwh: Number(d.generation) }))
    .filter((r) => stateNames.has(r.state) && Number.isFinite(r.gwh) && r.gwh > 0)
    .sort((a, b) => b.gwh - a.gwh);
  if (!rows.length) throw new Error(`No EIA state rows for ${fuel.label}.`);
  return { ...fuel, period, leader: rows[0], runnerUp: rows[1], national: rows.reduce((s, r) => s + r.gwh, 0) };
}

const results = await Promise.all(FUELS.map(leaderFor));
const hero = [...results].sort((a, b) => b.leader.gwh - a.leader.gwh)[0];
const leaderCounts = new Map();
for (const r of results) leaderCounts.set(r.leader.state, (leaderCounts.get(r.leader.state) || 0) + 1);
const doubleLeader = [...leaderCounts.entries()].find(([, n]) => n > 1);
const titleLine = doubleLeader
  ? `${doubleLeader[0]} leads more than one major fuel source in U.S. electricity generation — most states lead none.`
  : "Four different states lead U.S. electricity generation, one per major fuel source.";

const html = metricListCard({
  title: titleLine,
  subtitle: `EIA Form EIA-923, ${hero.period} annual generation — the #1 state per fuel type`,
  heroLabel: `${hero.label} leader`,
  heroValue: `${hero.leader.state}`,
  heroSub: `${num(hero.leader.gwh)} GWh in ${hero.period}`,
  rows: results.map((r) => ({
    label: `${r.label} — ${r.leader.state}`,
    value: r.leader.gwh,
    value_display: `${num(r.leader.gwh)} GWh`,
    color: r.color,
    icon: r.badge,
  })),
  callouts: results.slice(0, 3).map((r) => ({
    icon: r.badge,
    html: `<b>${r.leader.state}</b> leads ${r.label.toLowerCase()} generation — ${r.runnerUp ? `${(r.leader.gwh / r.runnerUp.gwh).toFixed(1)}x runner-up ${r.runnerUp.state}` : "no close second"}.`,
  })),
  source: "U.S. Energy Information Administration, Form EIA-923",
  vintage: hero.period,
});

const facebook = [
  `${titleLine} Here's who's #1 in each:`,
  "",
  ...results.map((r) => `${r.label}: ${r.leader.state} (${num(r.leader.gwh)} GWh, ${r.period})`),
  "",
  "Note: this ranks each fuel's single leading state by total generation volume, not each state's overall electricity mix — a state can lead in one fuel while getting most of its power from something else.",
  "",
  "Source: U.S. Energy Information Administration, Form EIA-923 (electric power operational data).",
];

const lines = [
  `State energy leaders watch (${stamp})`, "",
  "Fuel | Leading state | Generation (GWh) | Period",
  "---|---|---:|---:",
  ...results.map((r) => `${r.label} | ${r.leader.state} | ${num(r.leader.gwh)} | ${r.period}`),
  "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["fuel", "leading_state", "generation_gwh", "period"],
  results.map((r) => [r.label, r.leader.state, r.leader.gwh, r.period])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
