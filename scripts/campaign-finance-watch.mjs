#!/usr/bin/env node
// campaign-finance-watch.mjs - top federal candidate fundraisers this election
// cycle, from FEC filings. No API key strictly required (works on the shared
// DEMO_KEY, rate-limited), but a free key is recommended for regular use:
// sign up at https://api.data.gov/signup/ and set FEC_API_KEY in .env.
//
// Run:  node scripts/campaign-finance-watch.mjs
//       node scripts/campaign-finance-watch.mjs --cycle 2024
//       node scripts/campaign-finance-watch.mjs --office S   (S=Senate, H=House, P=President)
//       node scripts/campaign-finance-watch.mjs --no-image

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function getFecKey() {
  if (process.env.FEC_API_KEY) return process.env.FEC_API_KEY;
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^FEC_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return "DEMO_KEY"; // shared demo key: works, but low/shared rate limit
}

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function money(n) {
  const v = Number(n);
  const s = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${Math.round(a).toLocaleString("en-US")}`;
}

function titleCaseWord(w) {
  // Capitalize after both spaces and internal hyphens/apostrophes (Ocasio-Cortez, O'Brien).
  return w.replace(/[a-z]+/gi, (part) => part[0].toUpperCase() + part.slice(1).toLowerCase());
}

function cleanName(name) {
  // FEC names come as "LAST, FIRST MIDDLE" — flip to "First Middle Last"
  const [last, rest] = String(name).split(",").map((s) => s.trim());
  if (!rest) return name;
  return `${rest.split(" ").map(titleCaseWord).join(" ")} ${titleCaseWord(last)}`;
}

const OFFICES = { H: "House", S: "Senate", P: "President" };

const key = getFecKey();
const cycle = Number(argValue("--cycle", "2026"));
const office = argValue("--office", null); // H, S, P, or null for all
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `campaign-finance-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const qs = new URLSearchParams({
  api_key: key,
  cycle: String(cycle),
  sort: "-receipts",
  per_page: "10",
  election_full: "true",
});
if (office) qs.set("office", office);

const res = await fetch(`https://api.open.fec.gov/v1/candidates/totals/?${qs}`);
const text = await res.text();
if (!res.ok) {
  throw new Error(`FEC API HTTP ${res.status}: ${text.slice(0, 300)}` +
    (key === "DEMO_KEY" ? "\n(Using the shared DEMO_KEY — if this is a rate limit, get a free key at https://api.data.gov/signup/ and set FEC_API_KEY in .env.)" : ""));
}
const json = JSON.parse(text);

const rows = json.results.map((r) => ({
  name: cleanName(r.name),
  party: r.party || "?",
  office: OFFICES[r.office] || r.office_full || r.office,
  state: r.state,
  receipts: Number(r.receipts) || 0,
  itemized: Number(r.individual_itemized_contributions) || 0,
  disbursements: Number(r.disbursements) || 0,
  cashOnHand: Number(r.cash_on_hand_end_period) || 0,
}));

if (!rows.length) throw new Error(`No FEC candidate totals found for cycle ${cycle}${office ? ` office=${office}` : ""}`);

const leader = rows[0];
const totalReceipts = rows.reduce((s, r) => s + r.receipts, 0);
const totalItemized = rows.reduce((s, r) => s + r.itemized, 0);
const itemizedShare = (totalItemized / totalReceipts) * 100;

const chartSVG = horizontalBarChart(
  rows.map((r, i) => ({
    label: `${r.name} (${r.party}-${r.state})`,
    v: r.receipts / 1e6,
    color: i === 0 ? C.s2 : C.s1,
  })),
  { fmtTick: (v) => `$${v.toFixed(0)}M`, fmtVal: (v) => `$${v.toFixed(1)}M` }
);

const officeLabel = office ? OFFICES[office] || office : "House, Senate & President";
const html = cardHTML({
  kicker: "Campaign finance check",
  title: `Top fundraisers this cycle — ${officeLabel}`,
  hero: money(leader.receipts),
  heroLabel: `${leader.name} (${leader.party}-${leader.state}) leads · ${cycle} cycle`,
  chartSVG,
  source: "FEC (Federal Election Commission)",
  vintage: `${cycle} cycle`,
});

const facebook = [
  `Top fundraiser for the ${cycle} election cycle (${officeLabel}): ${leader.name} (${leader.party}-${leader.state}) with ${money(leader.receipts)} raised. ${money(leader.itemized)} of that (${((leader.itemized / leader.receipts) * 100).toFixed(0)}%) came from itemized individual contributions — donations large enough (generally over $200 from one person in a cycle) that federal law requires FEC to record the donor's name, employer, and amount.`,
  "",
  `Across these top 10 fundraisers combined: ${money(totalReceipts)} raised, of which ${money(totalItemized)} (${itemizedShare.toFixed(0)}%) is itemized. The rest is a mix of small-dollar donations under the itemization threshold, PAC contributions, and transfers — FEC's public data doesn't let you distinguish "many small donors" from "a few donations just under $200" without the underlying transaction records, so I'm not going to claim a precise small-vs-large donor split here.`,
  "",
  "Real numbers, real source — FEC candidate financial summaries:",
  "https://www.fec.gov/data/",
];

const lines = [
  `Campaign finance check (${stamp})`,
  "",
  `Cycle: ${cycle} | Office: ${officeLabel}`,
  "",
  "Rank | Candidate | Party | Office | State | Receipts | Itemized indiv. | Cash on hand",
  "---:|---|---|---|---|---:|---:|---:",
  ...rows.map((r, i) => `${i + 1} | ${r.name} | ${r.party} | ${r.office} | ${r.state} | ${money(r.receipts)} | ${money(r.itemized)} | ${money(r.cashOnHand)}`),
  "",
  `Top 10 combined: ${money(totalReceipts)} raised, ${itemizedShare.toFixed(0)}% itemized individual contributions.`,
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "candidate", "party", "office", "state", "receipts", "itemized_individual", "disbursements", "cash_on_hand"],
  rows.map((r, i) => [i + 1, r.name, r.party, r.office, r.state, r.receipts, r.itemized, r.disbursements, r.cashOnHand])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
