#!/usr/bin/env node
// Find topics that haven't been posted in a while — good candidates to
// regenerate (fresh data pulled live, same as any run) and repost.
// Reads the existing social/_state/post-log.json — no separate database.
//
// Run:  node scripts/repost-candidates.mjs                  (default: 180+ days since last post)
//       node scripts/repost-candidates.mjs --days 90

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPostLog } from "./lib/post-log.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const minDays = Number(argValue("--days", "180"));
const log = loadPostLog(ROOT);

const lastPublishedByTopic = new Map();
for (const entry of log) {
  if (entry.status !== "published") continue;
  const at = new Date(entry.at);
  if (Number.isNaN(at.getTime())) continue;
  const prev = lastPublishedByTopic.get(entry.topic);
  if (!prev || at > prev) lastPublishedByTopic.set(entry.topic, at);
}

if (!lastPublishedByTopic.size) {
  console.log("No published posts recorded yet in social/_state/post-log.json.");
  process.exit(0);
}

const now = new Date();
const rows = [...lastPublishedByTopic.entries()]
  .map(([topic, lastPosted]) => ({
    topic,
    lastPosted: lastPosted.toISOString().slice(0, 10),
    daysSince: Math.floor((now - lastPosted) / 86_400_000),
  }))
  .sort((a, b) => b.daysSince - a.daysSince);

const due = rows.filter((r) => r.daysSince >= minDays);

console.log(`${lastPublishedByTopic.size} topics have been published at least once.\n`);
if (!due.length) {
  console.log(`None are ${minDays}+ days overdue for a repost yet. Most recently stale:`);
  console.table(rows.slice(0, 10));
} else {
  console.log(`${due.length} topic(s) haven't been posted in ${minDays}+ days — good repost candidates (rerun the script for fresh data, then stage/schedule as usual):`);
  console.table(due);
}
