#!/usr/bin/env node
// Check the real status of every scheduled Facebook post — queries the
// Page's own /scheduled_posts edge directly (source of truth) and matches
// each one back to its topic name from our local scheduled-posts.json.
//
// Run:  node scripts/facebook-schedule-status.mjs

import path from "node:path";
import { fileURLToPath } from "node:url";
import { listScheduledFacebookPosts } from "./lib/facebook.mjs";
import { loadScheduledPosts } from "./lib/scheduled-posts.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const [fbPosts, local] = await Promise.all([
  listScheduledFacebookPosts({ root: ROOT }),
  Promise.resolve(loadScheduledPosts(ROOT)),
]);

const topicByPostId = new Map(local.map((entry) => [entry.facebookPostId, entry.topic]));

const rows = fbPosts
  .map((p) => {
    const scheduledAt = p.scheduled_publish_time ? new Date(p.scheduled_publish_time * 1000) : null;
    const overdue = !p.is_published && scheduledAt && scheduledAt.getTime() < Date.now();
    return {
      topic: topicByPostId.get(p.id) || "(not in local schedule — check dashboard)",
      scheduledAt: scheduledAt ? scheduledAt.toLocaleString() : "—",
      published: p.is_published ? "yes" : overdue ? "OVERDUE, still unpublished" : "not yet",
      id: p.id,
    };
  })
  .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

if (!rows.length) {
  console.log("No scheduled posts found on the Page.");
} else {
  console.table(rows);
  const overdueCount = rows.filter((r) => r.published.startsWith("OVERDUE")).length;
  if (overdueCount) console.log(`\n⚠ ${overdueCount} post(s) are past their scheduled time but still unpublished.`);
}
