#!/usr/bin/env node
// Land area by state (U.S. Census Bureau 2020 Census land area figures —
// static reference data, doesn't need an annual refresh).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cardHTML, screenshot, stateTileMap, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, num, rel } from "./lib/data-common.mjs";

// U.S. Census Bureau, land area in square miles (2020 Census).
const LAND_AREA_SQMI = {
  AL: ["Alabama", 50645], AK: ["Alaska", 570641], AZ: ["Arizona", 113594], AR: ["Arkansas", 52035],
  CA: ["California", 155779], CO: ["Colorado", 103642], CT: ["Connecticut", 4842], DE: ["Delaware", 1949],
  DC: ["District of Columbia", 61], FL: ["Florida", 53625], GA: ["Georgia", 57513], HI: ["Hawaii", 6423],
  ID: ["Idaho", 82643], IL: ["Illinois", 55519], IN: ["Indiana", 35826], IA: ["Iowa", 55857],
  KS: ["Kansas", 81759], KY: ["Kentucky", 39486], LA: ["Louisiana", 43204], ME: ["Maine", 30843],
  MD: ["Maryland", 9707], MA: ["Massachusetts", 7800], MI: ["Michigan", 56539], MN: ["Minnesota", 79627],
  MS: ["Mississippi", 46923], MO: ["Missouri", 68742], MT: ["Montana", 145546], NE: ["Nebraska", 76824],
  NV: ["Nevada", 109781], NH: ["New Hampshire", 8953], NJ: ["New Jersey", 7354], NM: ["New Mexico", 121298],
  NY: ["New York", 47126], NC: ["North Carolina", 48618], ND: ["North Dakota", 69001], OH: ["Ohio", 40861],
  OK: ["Oklahoma", 68595], OR: ["Oregon", 95988], PA: ["Pennsylvania", 44743], RI: ["Rhode Island", 1034],
  SC: ["South Carolina", 30061], SD: ["South Dakota", 75811], TN: ["Tennessee", 41235], TX: ["Texas", 261232],
  UT: ["Utah", 82170], VT: ["Vermont", 9217], VA: ["Virginia", 39490], WA: ["Washington", 66456],
  WV: ["West Virginia", 24038], WI: ["Wisconsin", 54158], WY: ["Wyoming", 97093],
};

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `state-land-area-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const rows = Object.entries(LAND_AREA_SQMI)
  .map(([abbr, [state, sqmi]]) => ({ abbr, state, sqmi }))
  .sort((a, b) => b.sqmi - a.sqmi)
  .map((r, i) => ({ ...r, rank: i + 1 }));

const az = rows.find((r) => r.abbr === "AZ");
const largest = rows.slice(0, 5);
const smallest = rows.slice(-5).reverse();
const fmtArea = (v) => `${num(v)} mi²`;

const chartSVG = stateTileMap(rows.map((r) => ({ ...r, v: r.sqmi })), { fmtVal: fmtArea });
const html = cardHTML({
  kicker: "Geography check",
  title: "Land area, by state",
  hero: fmtArea(largest[0].sqmi),
  heroLabel: `${largest[0].state}; total land area`,
  chartSVG, source: "U.S. Census Bureau", vintage: "2020 Census",
});

const facebook = [
  "Which states are actually the biggest — and smallest — by land?",
  "",
  "U.S. Census Bureau land area (2020 Census), by state.",
  "",
  "Largest by land area:", ...largest.map((r) => `#${r.rank} ${r.state}: ${fmtArea(r.sqmi)}`), "",
  "Smallest by land area:", ...smallest.map((r) => `#${r.rank} ${r.state}: ${fmtArea(r.sqmi)}`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${fmtArea(az.sqmi)}.` : "",
  "",
  "This is an equal-size state tile map: color shows the value, not each state's physical land area.",
  "",
  "Note: this is land area only — it excludes each state's inland water (lakes, rivers) and coastal waters, which is why these figures differ slightly from total-area rankings you may see elsewhere.",
  "",
  "Source: U.S. Census Bureau, 2020 Census land area statistics.",
].filter(Boolean);

const lines = [
  `State land area watch (${STAMP})`, "", "U.S. Census Bureau, 2020 Census land area (sq mi).", "",
  "Rank | State | Land area (sq mi)",
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${num(r.sqmi)}`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "land_area_sqmi"], rows.map((r) => [r.rank, r.state, r.sqmi])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
