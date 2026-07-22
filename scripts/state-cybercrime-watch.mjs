#!/usr/bin/env node
// Internet crime (cybercrime) complaints and losses by state, from the
// FBI's Internet Crime Complaint Center (IC3) 2025 Annual Report.
//
// Unlike most scripts in this toolkit, this is NOT a live API pull — IC3
// only publishes this once a year, as a PDF. Data is manually transcribed
// in lib/ic3-2025-cybercrime.mjs — see that file for the refresh procedure.
//
// Run:  node scripts/state-cybercrime-watch.mjs --metric complaints
//       node scripts/state-cybercrime-watch.mjs --metric losses
//       node scripts/state-cybercrime-watch.mjs --metric losses-per-complaint

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, money, num, rel } from "./lib/data-common.mjs";
import { COMPLAINTS_BY_STATE, LOSSES_BY_STATE, NATIONAL_TOTAL_COMPLAINTS, NATIONAL_TOTAL_LOSSES, REPORT_YEAR, SOURCE_URL } from "./lib/ic3-2025-cybercrime.mjs";

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const metric = String(argValue("--metric", "losses")).toLowerCase();
if (!["complaints", "losses", "losses-per-complaint"].includes(metric)) {
  throw new Error("--metric must be complaints, losses, or losses-per-complaint");
}
const noImage = process.argv.includes("--no-image");
const outputStamp = argValue("--output-date", STAMP);
const outBase = path.join(SOCIAL, `state-cybercrime-${metric}-watch-${outputStamp}`);
mkdirSync(SOCIAL, { recursive: true });

function compactMoney(value) {
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2).replace(/\.00$/, "")}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  return money(value);
}

const states = Object.keys(COMPLAINTS_BY_STATE);
const rows = states
  .map((state) => {
    const complaints = COMPLAINTS_BY_STATE[state];
    const losses = LOSSES_BY_STATE[state];
    const value = metric === "complaints" ? complaints : metric === "losses" ? losses : losses / complaints;
    return { state, complaints, losses, value };
  })
  .filter((r) => Number.isFinite(r.value))
  .sort((a, b) => b.value - a.value)
  .map((r, i) => ({ ...r, rank: i + 1 }));

const az = rows.find((r) => r.state === "Arizona");
const top = rows.slice(0, 10);

const fmt = metric === "complaints" ? (v) => num(v) : metric === "losses" ? compactMoney : (v) => money(v);
const unitLabel = metric === "complaints" ? "reported complaints" : metric === "losses" ? "reported losses" : "average loss per complaint";

const chartSVG = horizontalBarChart(
  top.map((r, index) => ({
    label: `#${r.rank} ${r.state}`,
    v: r.value,
    color: r.state === "Arizona" ? "#e4ad55" : index === 0 ? "#e66b5b" : "#087f83",
  })),
  {
    fmtTick: metric === "complaints" ? (v) => num(v)
      : metric === "losses-per-complaint" ? (v) => `$${Math.round(v / 1000)}k`
      : (v) => `$${(v / 1e6).toFixed(0)}M`,
    fmtVal: fmt,
  }
);

const html = cardHTML({
  kicker: "Cybercrime check",
  title: metric === "losses-per-complaint" ? "Average internet crime loss per complaint, by state" : `Internet crime ${unitLabel}, by state`,
  hero: fmt(top[0].value),
  heroLabel: `${top[0].state}; ${unitLabel}, ${REPORT_YEAR}`,
  chartSVG, source: "FBI Internet Crime Complaint Center (IC3)", vintage: `${REPORT_YEAR} Annual Report`,
});

const facebook = [
  metric === "losses" ? `${compactMoney(NATIONAL_TOTAL_LOSSES)} was reported lost to internet crime in one year. ${top[0].state} alone accounted for ${compactMoney(top[0].value)}.`
    : metric === "complaints" ? `${num(NATIONAL_TOTAL_COMPLAINTS)} internet crime complaints were filed with the FBI last year. Here's the state breakdown.`
    : "The average reported cybercrime loss topped $31,000 per complaint in four jurisdictions.",
  "",
  `FBI IC3 ${REPORT_YEAR} Annual Report — ${unitLabel} by state.`,
  "",
  "Highest:", ...top.map((r) => `#${r.rank} ${r.state}: ${fmt(r.value)}`), "",
  az ? `Arizona: #${az.rank} of ${rows.length}, ${fmt(az.value)}.` : "",
  "",
  metric === "losses-per-complaint"
    ? "These averages divide reported losses by reported complaints. They are not the typical victim's loss, and a small number of expensive cases can raise a state's average."
    : "These are complaints and losses reported to IC3, not every cybercrime. Many incidents go unreported, and raw state totals are not adjusted for population.",
  "",
  `Source: FBI Internet Crime Complaint Center (IC3), ${REPORT_YEAR} Annual Report.`,
  SOURCE_URL,
].filter((line) => line !== null && line !== undefined && line !== false);

const lines = [
  `State cybercrime ${metric} watch (${outputStamp})`, "", `FBI IC3, ${REPORT_YEAR} Annual Report — ${unitLabel} by state.`, "",
  `Rank | State | ${unitLabel}`,
  "---:|---|---:",
  ...rows.map((r) => `${r.rank} | ${r.state} | ${fmt(r.value)}`), "",
  "Facebook post", "-------------", facebook.join("\n"), "",
  `Note: manually transcribed from the IC3 ${REPORT_YEAR} Annual Report PDF (pages 28-29); updated once a year when IC3 republishes, not a live feed. Source: ${SOURCE_URL}`,
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(["rank", "state", "complaints", "losses_usd", metric], rows.map((r) => [r.rank, r.state, r.complaints, r.losses, r.value])));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
