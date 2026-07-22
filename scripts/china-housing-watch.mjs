#!/usr/bin/env node
// china-housing-watch.mjs — China's real residential property price index vs.
// the US's, same source, same methodology, same 2010=100 base: BIS's
// Residential Property Price database, as mirrored by FRED (QCNR628BIS /
// QUSR628BIS). Because both countries' series come from the same database
// with the same base year, "up X% since 2010" / "down X% since 2010" is an
// honest apples-to-apples comparison, not two indices stitched together.
//
// Run:  node scripts/china-housing-watch.mjs
//       node scripts/china-housing-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, engagementCTA, fred, lineChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function qLabel(iso) {
  const q = Math.floor(Number(iso.slice(5, 7)) / 3) + 1;
  return `Q${q} '${iso.slice(2, 4)}`;
}
function pct(v) { return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`; }

const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `china-housing-watch-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

console.log("  Fetching real residential property price indexes (BIS via FRED)...");
const [usRaw, cnRaw] = await Promise.all([fred("QUSR628BIS"), fred("QCNR628BIS")]);

// Align to China's series start (2005 Q2) — the shared BIS 2010=100 base
// year makes the two directly comparable from that common window on.
const cnStart = cnRaw[0].d;
const us = usRaw.filter((x) => x.d >= cnStart);
const cn = cnRaw;

const usLatest = us[us.length - 1];
const cnLatest = cn[cn.length - 1];
const cnPeak = cn.reduce((best, x) => (x.v > best.v ? x : best), cn[0]);

const usSince2010 = ((usLatest.v - 100) / 100) * 100;
const cnSince2010 = ((cnLatest.v - 100) / 100) * 100;
const cnFromPeak = ((cnLatest.v - cnPeak.v) / cnPeak.v) * 100;

const chartSVG = lineChart(
  [
    {
      name: "United States", color: C.s1,
      points: us.map((x) => ({ label: qLabel(x.d), v: x.v })),
      endLabel: (v) => `US ${v}`,
    },
    {
      name: "China", color: C.neg,
      points: cn.map((x) => ({ label: qLabel(x.d), v: x.v })),
      endLabel: (v) => `China ${v}`,
    },
  ],
  { fmtTick: (v) => v.toFixed(0), fmtVal: (v) => v.toFixed(1), labelStep: Math.max(2, Math.round(cn.length / 8)), yLabel: "Real home price index (2010 = 100)" }
);

const html = cardHTML({
  kicker: "China housing watch",
  title: "Same index, same 2010 base year — opposite directions",
  hero: pct(cnFromPeak),
  heroLabel: `China's real home prices vs. their Q${Math.floor(Number(cnPeak.d.slice(5, 7)) / 3) + 1} '${cnPeak.d.slice(2, 4)} peak`,
  chartSVG,
  source: "BIS Residential Property Price database via FRED",
  vintage: cnLatest.d,
});

const facebook = [
  "China's housing market has been sliding for four-plus years straight. Here's what's actually happening — and how much it does (and doesn't) affect the US:",
  "",
  `Real (inflation-adjusted) home prices, indexed to 2010 = 100, same database for both countries (BIS via FRED):`,
  `United States: ${usLatest.v.toFixed(1)} today — ${pct(usSince2010)} since 2010.`,
  `China: ${cnLatest.v.toFixed(1)} today — ${pct(cnSince2010)} since 2010, and ${pct(cnFromPeak)} from its own Q${Math.floor(Number(cnPeak.d.slice(5, 7)) / 3) + 1} '${cnPeak.d.slice(2, 4)} peak.`,
  "",
  "So do these two connect? Yes — but not the way you'd guess, and not the same way each time:",
  "",
  "2000s (China → US): China ran huge trade surpluses and parked the proceeds in US bonds — a flood of cheap capital that helped push US mortgage rates down and inflate the 2000s housing bubble.",
  "",
  "2008 (US → China): once that bubble burst, the crisis hit China back — hard — through trade. Chinese exports had been growing ~30%/year; the collapse in US demand slammed that, and Beijing answered with a massive stimulus that helped seed the property boom China is now unwinding.",
  "",
  "2021-today (China's own crisis, mostly contained): Evergrande and the broader developer-debt crisis is overwhelmingly a domestic story — only a small share of that debt was owed to foreign creditors, and research on the spillover found it stayed mostly within Chinese credit markets, not global banking. The US effect has been indirect: weaker Chinese demand for commodities and imports, softer multinational earnings (Apple, autos, luxury), and occasional risk-off days on bad headlines — not a 2008-style financial shock.",
  "",
  "Worth noting: this is a national aggregate. Some lower-tier Chinese cities are down far more than the headline number, and China's own housing data is widely believed to run optimistic (official series lag the secondary/resale market where most of the real cutting has happened) — so if anything, this likely understates the on-the-ground decline.",
  "",
  engagementCTA("trend", "china-housing-watch"),
  "",
  "Source: BIS Residential Property Price database, via FRED (series QUSR628BIS, QCNR628BIS).",
  "https://fred.stlouisfed.org/series/QCNR628BIS",
  "https://fred.stlouisfed.org/series/QUSR628BIS",
  "Information retrieved programmatically via API.",
  "Graph made by Jeffrey Macy.",
];

const lines = [
  `China housing watch (${stamp})`, "",
  `US real home price index, ${usLatest.d}: ${usLatest.v.toFixed(2)} (${pct(usSince2010)} since 2010)`,
  `China real home price index, ${cnLatest.d}: ${cnLatest.v.toFixed(2)} (${pct(cnSince2010)} since 2010)`,
  `China peak: ${cnPeak.v.toFixed(2)} in ${cnPeak.d} → ${pct(cnFromPeak)} from peak as of ${cnLatest.d}`,
  "", "Facebook post", "-------------", facebook.join("\n"), "",
  "Source: BIS Residential Property Price database via FRED (QUSR628BIS, QCNR628BIS). Both indexed 2010=100.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["date", "us_index", "china_index"],
  cn.map((c) => [c.d, us.find((u) => u.d === c.d)?.v ?? "", c.v])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
