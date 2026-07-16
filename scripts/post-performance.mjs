#!/usr/bin/env node
// post-performance.mjs - ingest a Meta Business Suite "Content" performance
// export (manually downloaded CSV - Facebook has no public API for reading
// your own Page insights, only for posting) and rank which of our posts
// actually performed, so future topic choices can be based on real data
// instead of guessing.
//
// Keeps a durable ledger (social/post-performance-history.json, keyed by
// Post ID) so re-running with a fresh export each week/month accumulates
// history instead of overwriting it — Facebook's own stats for a given post
// also keep growing over time, so later exports naturally supersede earlier
// numbers for the same post.
//
// Run:  node scripts/post-performance.mjs                  — auto-detect newest export in ~/Downloads
//       node scripts/post-performance.mjs --file <path>     — use a specific CSV
//       node scripts/post-performance.mjs --min-views 100   — change the "notable" threshold

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const HISTORY_PATH = path.join(SOCIAL, "post-performance-history.json");
const EXCLUDE_PATH = path.join(SOCIAL, "post-performance-exclude.json");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

// Quote-aware CSV parser (handles embedded commas/newlines/escaped quotes in
// fields) — Meta's export wraps the full post caption in the Title column,
// which routinely contains both.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (quoted && ch === '"' && next === '"') { cell += '"'; i++; }
    else if (ch === '"') { quoted = !quoted; }
    else if (!quoted && ch === ",") { row.push(cell); cell = ""; }
    else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function findLatestExport() {
  const downloads = path.join(os.homedir(), "Downloads");
  if (!existsSync(downloads)) return null;
  const candidates = readdirSync(downloads)
    .filter((f) => /content.*summary.*\.csv$/i.test(f) || /publish time.*summary.*\.csv$/i.test(f))
    .map((f) => path.join(downloads, f))
    .map((p) => ({ p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.p || null;
}

// A stable, low-maintenance topic key: everything before the first ":" / "("
// / 4-digit year. Avoids hand-maintaining a lookup table against 80+ scripts'
// caption openers — if the same topic gets posted again, it naturally groups
// under the same key since our captions always open the same way.
function topicKeyFromTitle(title) {
  const firstLine = title.split("\n")[0];
  const cut = firstLine.search(/[:(]|\b(19|20)\d{2}\b/);
  const key = (cut > 0 ? firstLine.slice(0, cut) : firstLine).trim();
  return key.slice(0, 60) || "(untitled)";
}

const num = (s) => (s === "" || s == null ? null : Number(s));

const filePath = arg("--file") || findLatestExport();
if (!filePath) {
  console.error("No export found. Pass --file <path>, or download a Meta Business Suite \"Content > Publish time > Summary\" CSV to your Downloads folder.");
  process.exit(1);
}
if (!existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

const minViews = Number(arg("--min-views", "0"));

console.log(`Reading ${filePath}...`);
const rows = parseCsv(readFileSync(filePath, "utf8"));
const header = rows[0].map((h) => h.replace(/^﻿/, ""));
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const required = ["Post ID", "Title", "Post type", "Impressions", "Interactions", "Reactions", "Shares", "Views"];
for (const col of required) {
  if (!(col in idx)) throw new Error(`Expected column "${col}" not found in export — got: ${header.join(", ")}`);
}

const rowsIn = rows.slice(1).filter((r) => r[idx["Post ID"]]);
console.log(`Parsed ${rowsIn.length} posts from the export.`);

// ── merge into the durable history ledger, keyed by Post ID ────────────────
mkdirSync(SOCIAL, { recursive: true });
const history = existsSync(HISTORY_PATH) ? JSON.parse(readFileSync(HISTORY_PATH, "utf8")) : {};

for (const r of rowsIn) {
  const postId = r[idx["Post ID"]];
  const title = r[idx["Title"]];
  history[postId] = {
    postId,
    title,
    topicKey: topicKeyFromTitle(title),
    postType: r[idx["Post type"]],
    publishTime: r[idx["Publish time"]] || null,
    permalink: r[idx["Permalink"]] || null,
    impressions: num(r[idx["Impressions"]]),
    interactions: num(r[idx["Interactions"]]),
    reactions: num(r[idx["Reactions"]]),
    saves: idx["Saves"] != null ? num(r[idx["Saves"]]) : null,
    shares: num(r[idx["Shares"]]),
    comments: idx["Comments"] != null ? num(r[idx["Comments"]]) : null,
    views: num(r[idx["Views"]]),
    lastSeenInExport: path.basename(filePath),
    lastUpdated: history[postId]?.lastUpdated || null, // set below if this run changes it
  };
}
writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));

// ── rank ─────────────────────────────────────────────────────────────────
// Post IDs manually confirmed as personal/non-toolkit content — keyword
// heuristics alone can't reliably tell "U.S. BANKING SECTOR SNAPSHOT" (ours)
// apart from a random personal photo post, so exact exclusion is the
// trustworthy path. Add more Post IDs here (or in the JSON file) as they show
// up; anything not excluded is treated as toolkit content by default, since
// that's what the overwhelming majority of this Page's posts are.
const DEFAULT_EXCLUDE = new Set(["1551119666672340", "1568340064950300"]);
const fileExclude = existsSync(EXCLUDE_PATH) ? new Set(JSON.parse(readFileSync(EXCLUDE_PATH, "utf8"))) : new Set();
const excluded = new Set([...DEFAULT_EXCLUDE, ...fileExclude]);
if (!existsSync(EXCLUDE_PATH)) writeFileSync(EXCLUDE_PATH, JSON.stringify([...DEFAULT_EXCLUDE], null, 2));

const all = Object.values(history);
const isOurs = (p) => !excluded.has(p.postId);
const ours = all.filter(isOurs);
const other = all.filter((p) => !isOurs(p));

const byViews = (a, b) => (b.views ?? -1) - (a.views ?? -1);
const ranked = [...ours].sort(byViews);
const notable = ranked.filter((p) => (p.views ?? 0) >= minViews);

// Post-type breakdown, to test the "single image outperforms" hypothesis
// quantitatively rather than by eyeballing.
const byType = new Map();
for (const p of ours) {
  const t = p.postType || "(unknown)";
  const acc = byType.get(t) || { type: t, count: 0, totalViews: 0, withViews: 0 };
  acc.count++;
  if (p.views != null) { acc.totalViews += p.views; acc.withViews++; }
  byType.set(t, acc);
}
const typeStats = [...byType.values()].map((t) => ({ ...t, avgViews: t.withViews ? Math.round(t.totalViews / t.withViews) : null }));

const top = ranked.slice(0, 5);
const bottom = ranked.slice(-5).reverse();

const lines = [];
lines.push(`# Facebook post performance report`);
lines.push("");
lines.push(`Source export: ${path.basename(filePath)}`);
lines.push(`Posts in this export: ${rowsIn.length} · Total posts in history ledger: ${all.length}`);
lines.push(`Classified as toolkit data posts: ${ours.length} · Other content (personal/non-toolkit): ${other.length}`);
lines.push("");
lines.push(`## Post type vs. performance`);
lines.push("");
lines.push("Type | Posts | Avg views");
lines.push("---|---:|---:");
for (const t of typeStats.sort((a, b) => (b.avgViews ?? -1) - (a.avgViews ?? -1))) {
  lines.push(`${t.type} | ${t.count} | ${t.avgViews ?? "n/a"}`);
}
lines.push("");
lines.push(`## Top performers`);
lines.push("");
lines.push("Views | Impressions | Interactions | Topic");
lines.push("---:|---:|---:|---");
for (const p of top) {
  lines.push(`${p.views ?? "—"} | ${p.impressions ?? "—"} | ${p.interactions ?? "—"} | ${p.topicKey}`);
}
lines.push("");
lines.push(`## Lowest performers`);
lines.push("");
lines.push("Views | Impressions | Interactions | Topic");
lines.push("---:|---:|---:|---");
for (const p of bottom) {
  lines.push(`${p.views ?? "—"} | ${p.impressions ?? "—"} | ${p.interactions ?? "—"} | ${p.topicKey}`);
}
lines.push("");
if (other.length) {
  lines.push(`## Non-toolkit content in this export (for context, not ranked)`);
  lines.push("");
  for (const p of other) lines.push(`- "${p.topicKey}" (${p.postType}) — ${p.views ?? "?"} views`);
  lines.push("");
}
lines.push(`## Full ranked list (this export + history)`);
lines.push("");
lines.push("Views | Impressions | Interactions | Reactions | Shares | Post type | Topic");
lines.push("---:|---:|---:|---:|---:|---|---");
for (const p of ranked) {
  lines.push(`${p.views ?? "—"} | ${p.impressions ?? "—"} | ${p.interactions ?? "—"} | ${p.reactions ?? "—"} | ${p.shares ?? "—"} | ${p.postType} | ${p.topicKey}`);
}

const reportPath = path.join(SOCIAL, "post-performance-report.md");
writeFileSync(reportPath, lines.join("\n") + "\n");

console.log("\n" + lines.join("\n"));
console.log(`\nFiles: ${rel(reportPath)} / ${rel(HISTORY_PATH)}`);
if (notable.length !== ranked.length) console.log(`(${ranked.length - notable.length} posts below --min-views ${minViews} threshold omitted from "notable" set, still in full list)`);
