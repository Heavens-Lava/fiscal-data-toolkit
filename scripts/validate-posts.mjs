#!/usr/bin/env node
// validate-posts.mjs — run automated pre-approval checks (post-validation.mjs)
// across pending/scheduled posts and print a report. This is the "data/claim
// validation" gate that runs BEFORE editorial scoring/promotion -- a post
// that fails here has a concrete, checkable problem (missing caption marker,
// broken template render, headline/data mismatch, self-contradictory
// sourcing), not just a "could be more engaging" issue.
//
// Run:  node scripts/validate-posts.mjs --pending          (all queued posts)
// Run:  node scripts/validate-posts.mjs --scheduled         (all live-scheduled posts)
// Run:  node scripts/validate-posts.mjs --topic X --date Y  (one post)
// Run:  node scripts/validate-posts.mjs --pending --fails-only

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePost } from "./lib/post-validation.mjs";
import { listPendingApprovals } from "./lib/approval-queue.mjs";
import { loadScheduledPosts } from "./lib/scheduled-posts.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function validateOne(topic, date) {
  const base = path.join(SOCIAL, `${topic}-${date}`);
  const txt = readIfExists(`${base}.txt`);
  if (txt === null) return { topic, date, verdict: "fail", checks: [], fails: [{ id: "missing-file", severity: "fail", message: "No .txt file found for this topic/date." }], reviews: [] };
  const csv = readIfExists(`${base}.csv`);
  const html = readIfExists(`${base}.html`);
  const result = validatePost({ txt, csv, html, stampDate: date });
  return { topic, date, ...result };
}

const symbol = { pass: "\x1b[32m✓\x1b[0m", review: "\x1b[33m?\x1b[0m", fail: "\x1b[31m✗\x1b[0m" };
function plainSymbol(v) { return v === "pass" ? "OK" : v === "review" ? "REVIEW" : "FAIL"; }

function printReport(results, { failsOnly = false } = {}) {
  let failCount = 0, reviewCount = 0, passCount = 0;
  for (const r of results) {
    if (r.verdict === "fail") failCount++;
    else if (r.verdict === "review") reviewCount++;
    else passCount++;
    if (failsOnly && r.verdict === "pass") continue;
    console.log(`\n${plainSymbol(r.verdict)}  ${r.topic}-${r.date}`);
    for (const c of [...r.fails, ...r.reviews]) {
      console.log(`    [${c.severity.toUpperCase()}] ${c.id}: ${c.message}`);
    }
  }
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${results.length} posts checked -- ${passCount} pass, ${reviewCount} need review, ${failCount} fail.`);
}

const topicArg = argValue("--topic");
const dateArg = argValue("--date");
const failsOnly = process.argv.includes("--fails-only");

if (topicArg && dateArg) {
  printReport([validateOne(topicArg, dateArg)]);
} else if (process.argv.includes("--scheduled")) {
  const entries = loadScheduledPosts(ROOT).filter((p) => p.status === "scheduled");
  printReport(entries.map((e) => validateOne(e.topic, e.date)), { failsOnly });
} else if (process.argv.includes("--pending")) {
  const entries = listPendingApprovals(ROOT, SOCIAL);
  printReport(entries.map((e) => validateOne(e.topic, e.date)), { failsOnly });
} else {
  console.error("Usage: node scripts/validate-posts.mjs --pending | --scheduled | --topic X --date Y  [--fails-only]");
  process.exit(1);
}
