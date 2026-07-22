#!/usr/bin/env node
// wealth-ownership-watch.mjs — two views of "how is America's wealth divided?"
// via the Fed's Z.1 Financial Accounts (Flow of Funds):
//   1) Household net worth by asset class (donut) — table B.101.h
//   2) Net worth by economic sector: households, corporations, government (bar) — sector balance sheets
//
// Chart 2 is a diverging bar chart, not a pie: the federal government and
// financial-business sectors carry NEGATIVE net worth (liabilities exceed
// assets), and a pie/donut can't represent a negative slice honestly — the
// dataviz skill rules out pie/donut whenever any value is negative.
// These six sector balance sheets also aren't mutually-exclusive shares of
// one wealth pie (household equities are a claim on the same corporations
// counted separately here), so the caption is explicit that this shows each
// sector's own balance sheet, not slices that sum to a single total.
//
// Run:  node scripts/wealth-ownership-watch.mjs
//       node scripts/wealth-ownership-watch.mjs --no-image

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, columnChart, donutChart, esc, fred, legend, moneyT, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const noImage = process.argv.includes("--no-image");
mkdirSync(SOCIAL, { recursive: true });

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const stamp = localDateStamp();
function rel(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function qLabel(iso) { return `Q${Math.floor(Number(iso.slice(5, 7)) / 3) + 1} ${iso.slice(0, 4)}`; }
const signedT = (n) => (n < 0 ? `-${moneyT(-n)}` : moneyT(n)); // moneyT() puts "$" before the sign on negatives ($-1.2T) — this fixes ordering (-$1.2T)

async function latest(id) {
  const series = await fred(id);
  const point = series[series.length - 1];
  return { v: point.v * 1e6, d: point.d }; // FRED Z.1 series are in $ millions
}

function writeAsset({ slug, html, columns, rows, caption, source, vintage }) {
  const base = path.join(SOCIAL, `${slug}-${stamp}`);
  const text = [`${slug} (${stamp})`, "", `Source: ${source}. Data through ${vintage}.`, "", "Facebook post", "-------------", ...caption];
  writeFileSync(`${base}.txt`, text.join("\n"));
  writeFileSync(`${base}.csv`, toCSV(columns, rows));
  writeFileSync(`${base}.html`, html);
  if (!noImage) screenshot(`${base}.html`, `${base}.png`);
  console.log(text.join("\n"));
  const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${base}.${ext}`));
  console.log(`\nFiles: ${files.join(" / ")}\n`);
}

// ── Chart 1: household wealth by asset class ────────────────────────────────
console.log("  Fetching household balance sheet (Fed Z.1, table B.101.h)...");
const [
  realEstate, checkable, timeSavings, mmf, equities, treasury, muni, corpBonds, agency,
  noncorpBiz, pensions, lifeIns, durables, totalAssets,
] = await Promise.all([
  latest("HOOREVLMHMV"), latest("CDCABSHNO"), latest("BOGZ1FL193030205Q"), latest("BOGZ1FL193034005Q"),
  latest("BOGZ1LM153064475Q"), latest("HNOTSAQ027S"), latest("MSABSHNO"), latest("CFBABSHNO"), latest("BOGZ1LM153061705A"),
  latest("BOGZ1LM152090205Q"), latest("HNOPFAQ027S"), latest("LIRABSHNO"), latest("BOGZ1LM155111005Q"), latest("TABSHNO"),
]);
const deposits = checkable.v + timeSavings.v + mmf.v;
const debtSecurities = treasury.v + muni.v + corpBonds.v + agency.v;
const vintage1 = qLabel(totalAssets.d);

const namedAssets = [
  { label: "Real estate", v: realEstate.v },
  { label: "Corporate equities & mutual funds", v: equities.v },
  { label: "Pension entitlements", v: pensions.v },
  { label: "Deposits (cash, savings, money market)", v: deposits },
  { label: "Noncorporate business equity", v: noncorpBiz.v },
  { label: "Consumer durable goods", v: durables.v },
  { label: "Debt securities (bonds)", v: debtSecurities },
];
const otherAssets = totalAssets.v - namedAssets.reduce((sum, a) => sum + a.v, 0) - lifeIns.v; // residual + life insurance, folded together to keep the donut at 8 slices (never a cycled 9th hue)
const assetSlices = [...namedAssets, { label: "Other (incl. life insurance reserves)", v: otherAssets + lifeIns.v }].sort((a, b) => b.v - a.v);

writeAsset({
  slug: "household-wealth-by-asset-class",
  html: cardHTML({
    kicker: "How America's wealth is held",
    title: "What is US household wealth actually made of?",
    hero: moneyT(totalAssets.v), heroLabel: `total household assets, ${vintage1}`,
    chartSVG: donutChart(assetSlices, { fmtVal: moneyT, centerTop: moneyT(totalAssets.v), centerBottom: "total assets" }),
    source: "Federal Reserve Z.1 Financial Accounts (table B.101.h)", vintage: vintage1,
  }),
  columns: ["asset_class", "value_usd", "share_pct"],
  rows: assetSlices.map((a) => [a.label, Math.round(a.v), (a.v / totalAssets.v * 100).toFixed(2)]),
  caption: [
    "What's US household wealth actually made of?",
    `${assetSlices[0].label} is the single largest slice at ${(assetSlices[0].v / totalAssets.v * 100).toFixed(1)}% of ${moneyT(totalAssets.v)} in total household assets.`,
    "",
    "Asset class | Value | Share",
    ...assetSlices.map((a) => `${a.label} | ${moneyT(a.v)} | ${(a.v / totalAssets.v * 100).toFixed(1)}%`),
    "",
    "This is gross assets, not net worth — households also carry about $20T in mortgage and consumer debt against these assets, most of it against the real-estate slice.",
    "",
    "Which slice surprised you most? Comment below and share this with someone who thinks their house is their only asset.",
    "",
    "Source: Federal Reserve Z.1 Financial Accounts, table B.101.h (Balance Sheet of Households and Nonprofit Organizations).",
    "https://www.federalreserve.gov/releases/z1/",
    "Information retrieved programmatically via FRED. Graph made by Jeffrey Macy.",
  ],
  source: "Federal Reserve Z.1 (B.101.h)", vintage: vintage1,
});

// ── Chart 2: net worth — individuals vs. corporate vs. government ───────────
// Rolled up to the 3 buckets people actually mean by "who owns it": every
// household/nonprofit into "Individuals," every business sector into
// "Corporate," and federal + state/local combined into "Government." Still a
// diverging bar, not a pie/donut — the combined government bucket is NEGATIVE
// (federal's debt outweighs state/local's positive net worth), and a pie
// can't hold a negative slice honestly.
console.log("  Fetching sector net worth (Fed Z.1 sector balance sheets)...");
const [households, corpBiz, noncorpBizSector, finBiz, stateLocal, federal] = await Promise.all([
  latest("TNWBSHNO"), latest("TNWMVBSNNCB"), latest("TNWBSNNB"), latest("FBNWMTQ027S"), latest("SLGTPAQ027S"), latest("FGNETWQ027S"),
]);
const vintage2 = qLabel(federal.d);
const corporateV = corpBiz.v + noncorpBizSector.v + finBiz.v;
const governmentV = federal.v + stateLocal.v;
const bucketPoints = [
  { key: "Individuals (households & nonprofits)", v: households.v },
  { key: "Corporate (nonfinancial + financial business)", v: corporateV },
  { key: "Government (federal + state/local)", v: governmentV },
];
const chartPoints = bucketPoints.map((s) => ({ label: s.key, v: s.v / 1e12 }));

writeAsset({
  slug: "net-worth-by-owner-type",
  html: cardHTML({
    kicker: "Who owns America's wealth",
    title: "Individuals, corporations, government: net worth by owner type",
    hero: signedT(governmentV), heroLabel: `combined government net worth, ${vintage2}`,
    legendHTML: legend([{ color: C.pos, name: "Positive net worth" }, { color: C.neg, name: "Negative (liabilities exceed assets)" }]),
    chartSVG: columnChart(chartPoints, { fmtTick: (v) => (v < 0 ? `-$${(-v).toFixed(0)}T` : `$${v.toFixed(0)}T`), fmtVal: (v) => (v < 0 ? `-$${(-v).toFixed(1)}T` : `$${v.toFixed(1)}T`), yLabel: "Net worth ($T)" }),
    source: "Federal Reserve Z.1 Financial Accounts (sector balance sheets)", vintage: vintage2,
  }),
  columns: ["owner_type", "net_worth_usd", "status"],
  rows: bucketPoints.map((s) => [s.key, Math.round(s.v), s.v >= 0 ? "positive" : "negative"]),
  caption: [
    "Individuals, corporations, government — who actually owns America's wealth?",
    `Individuals hold ${moneyT(households.v)} in net worth. Corporations (nonfinancial + financial businesses combined) hold ${moneyT(corporateV)}. Government — federal plus state and local combined — is ${signedT(governmentV)}: state and local governments own more than they owe, but the federal government's debt is so much larger that the combined government sector is a net debtor, not a net owner.`,
    "",
    "Owner type | Net worth",
    ...bucketPoints.map((s) => `${s.key} | ${signedT(s.v)}${s.v < 0 ? " (negative — more liabilities than assets)" : ""}`),
    "",
    `Zooming in on government: federal alone is ${signedT(federal.v)}, state & local alone is ${moneyT(stateLocal.v)}. And that federal number likely UNDERSTATES what the government actually owns — the accounting only counts produced tangible assets (buildings, equipment, software) and financial assets. It excludes federal land (~640 million acres, about 28% of the US), mineral and oil/gas rights, and other natural resources entirely, because they're not officially valued. Include those and the federal picture would look somewhat less negative, though still deeply in the red — debt alone is larger than the net-worth gap.`,
    "",
    "Important caveat on 'Corporate': this isn't a wealth pool separate from individuals. Nearly all corporate equity is itself owned by people — directly, through mutual funds, or through pensions — and that ownership claim is already counted inside 'Individuals' (in the corporate-equities slice of household assets). So this chart shows which institutional books are in the black or red, not three independent slices of one pie that individuals, corporations, and government each keep for themselves.",
    "",
    "Surprised the federal government's own books run this deep negative — even before counting Fort Knox gold and the like? Comment below and share this with someone who thinks 'the government owns a ton of stuff.'",
    "",
    "Source: Federal Reserve Z.1 Financial Accounts, sector balance sheet tables (Households, Nonfinancial Corporate/Noncorporate Business, Financial Business, Federal Government, State & Local Governments).",
    "https://www.federalreserve.gov/releases/z1/",
    "Information retrieved programmatically via FRED. Graph made by Jeffrey Macy.",
  ],
  source: "Federal Reserve Z.1 (sector balance sheets)", vintage: vintage2,
});
