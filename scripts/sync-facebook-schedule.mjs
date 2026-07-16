#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listScheduledFacebookPosts, scheduleFacebookPost } from "./lib/facebook.mjs";
import { loadScheduledPosts, schedulePost } from "./lib/scheduled-posts.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const future = loadScheduledPosts(ROOT).filter((entry) =>
  entry.status === "scheduled" && !entry.facebookPostId && new Date(entry.scheduledAt).getTime() > Date.now()
);

if (!future.length) {
  console.log("No local-only future posts need to be migrated.");
} else {
  console.log(`Migrating ${future.length} local scheduled posts to Facebook...`);
  for (const entry of future) {
    const result = await scheduleFacebookPost({
      root: ROOT,
      social: SOCIAL,
      topic: entry.topic,
      date: entry.date,
      mediaPreference: entry.media,
      scheduledAt: entry.scheduledAt,
    });
    schedulePost(ROOT, {
      ...entry,
      facebookPostId: result.objectId,
      facebookMediaId: result.mediaId,
    });
    console.log(`${entry.topic} -> ${entry.scheduledAt} (${result.objectId})`);
  }
}

const facebook = await listScheduledFacebookPosts({ root: ROOT });
const local = loadScheduledPosts(ROOT).filter((entry) => entry.facebookPostId);
const facebookIds = new Set(facebook.map((entry) => entry.id));
const matched = local.filter((entry) => facebookIds.has(entry.facebookPostId));
console.log(`Verified ${matched.length}/${local.length} local Facebook schedules through Meta; Meta currently lists ${facebook.length}.`);
if (matched.length !== local.length) process.exitCode = 2;
