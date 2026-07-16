#!/usr/bin/env node
// Interstate in-movers ages 18-34 as a share of the current young-adult population.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, censusRows, envValue, num, pct, rel, uniqueRows } from "./lib/data-common.mjs";

const key = envValue("CENSUS_API_KEY");
if (!key) throw new Error("Missing CENSUS_API_KEY in .env.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `young-adult-migration-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const totalVars = ["B07001_004E", "B07001_005E", "B07001_006E", "B07001_007E"];
const moverVars = ["B07001_068E", "B07001_069E", "B07001_070E", "B07001_071E"];
const vars = [...totalVars, ...moverVars];
let year;
let raw;
for (const candidate of [2025, 2024, 2023, 2022]) {
  try {
    raw = await censusRows(candidate, "acs/acs1", vars, "state:*", key);
    if (raw.length) { year = candidate; break; }
  } catch { /* try the prior ACS vintage */ }
}
if (!year) throw new Error("No Census ACS migration vintage available.");
const usRaw = await censusRows(year, "acs/acs1", vars, "us:*", key);
const usPopulation = totalVars.reduce((sum, variable) => sum + Number(usRaw[0]?.[variable] || 0), 0);
const usMovers = moverVars.reduce((sum, variable) => sum + Number(usRaw[0]?.[variable] || 0), 0);
const usRate = usPopulation ? usMovers / usPopulation * 100 : null;
const rows = raw.map((r) => {
  const population = totalVars.reduce((sum, variable) => sum + Number(r[variable]), 0);
  const inMovers = moverVars.reduce((sum, variable) => sum + Number(r[variable]), 0);
  return { state: r.NAME, stateCode: r.state, population, inMovers, rate: inMovers / population * 100 };
}).filter((r) => r.population > 0 && r.inMovers >= 0 && r.stateCode !== "72")
  .sort((a, b) => b.rate - a.rate).map((r, i) => ({ ...r, rank: i + 1 }));

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 5);
const bottom = rows.slice(-5).reverse();
const chartRows = uniqueRows([...top, az, ...bottom.toReversed()], "state");
const chartSVG = horizontalBarChart(chartRows.map((r) => ({
  label: `#${r.rank} ${r.state}`, v: r.rate, color: r.state === "Arizona" ? C.s2 : C.s1,
})), { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => pct(v) });
const html = cardHTML({
  kicker: "Young-adult migration check",
  title: "Where are interstate movers ages 18-34 settling?",
  hero: pct(top[0].rate), heroLabel: `${top[0].state}; arrived from another state in the past year`,
  chartSVG, source: "U.S. Census Bureau ACS B07001", vintage: String(year),
});
const facebook = [
  "Where are young adults moving across state lines?",
  `${top[0].state} ranks #1 at ${pct(top[0].rate)}, while ${bottom[0].state} ranks #${bottom[0].rank} at ${pct(bottom[0].rate)}.`, "",
  "State | Share of young adults who arrived from another state",
  ...rows.map((r) => `#${r.rank} ${r.state} | ${pct(r.rate)} (${num(r.inMovers)} people)`), "",
  Number.isFinite(usRate) ? `United States benchmark: ${pct(usRate)}.` : "",
  az ? `Arizona ranks #${az.rank}: ${pct(az.rate)} (${num(az.inMovers)} people).` : "", "",
  "This measures people currently living in a state who arrived from another state. It is not net migration because it does not subtract young adults who moved away, and it does not show their state of origin.", "",
  "What should I compare with this next: rent, wages, home prices, or job growth? Comment below and share this with someone who moved states in their twenties.", "",
  "Sources:", "• U.S. Census Bureau American Community Survey, table B07001",
  "Source website: https://api.census.gov/data.html",
  "Information retrieved programmatically via API.",
  "Graph made by Jeffrey Macy.",
].filter(Boolean);
const lines = [
  `Young-adult interstate migration (${STAMP})`, "", `Ages 18-34; Census ACS ${year}.`, "",
  "State | Young adults arriving from another state",
  "---|---:",
  ...rows.map((r) => `#${r.rank} ${r.state} | ${pct(r.rate)}`), "",
  Number.isFinite(usRate) ? `U.S. benchmark: ${num(usMovers)} interstate in-movers ages 18-34, ${pct(usRate)} of the national age-group population.` : "", "",
  "Facebook post", "-------------", facebook.join("\n"), "",
  "Note: This is an interstate in-mover rate for current residents, not a net-migration rate.",
];
writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "young_adult_population", "interstate_in_movers", "in_mover_share_pct", "vintage"], rows.map((r) => [r.rank, r.state, r.population, r.inMovers, r.rate, year])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
