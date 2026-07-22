#!/usr/bin/env node
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cancelFacebookScheduledPost, scheduleFacebookPost } from "./lib/facebook.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const QUEUE = path.join(SOCIAL, "_state", "scheduled-posts.json");
const value = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const topic = value("--topic");
const date = value("--date");
if (!topic || !date) throw new Error("Usage: node scripts/replace-scheduled-facebook-post.mjs --topic TOPIC --date YYYY-MM-DD");

const queue = JSON.parse(readFileSync(QUEUE, "utf8"));
const index = queue.findIndex((item) => item.topic === topic && item.date === date && item.status === "scheduled");
if (index < 0) throw new Error(`No scheduled queue entry found for ${topic}-${date}.`);
const old = queue[index];
if (!old.facebookPostId) throw new Error("The queue entry has no Facebook post ID.");
if (new Date(old.scheduledAt).getTime() < Date.now() + 10 * 60_000) throw new Error("The scheduled time is too close to replace safely.");

const backup = `${QUEUE}.before-replace-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
copyFileSync(QUEUE, backup);
let replacement;
try {
  replacement = await scheduleFacebookPost({
    root: ROOT,
    social: SOCIAL,
    topic,
    date,
    mediaPreference: old.media || "image",
    scheduledAt: old.scheduledAt,
  });
  try {
    await cancelFacebookScheduledPost({ root: ROOT, postId: old.facebookPostId });
  } catch (error) {
    // A stale local queue ID means there is no old Facebook post left to
    // cancel. The same credentials created the replacement, so preserve it.
    if (!String(error?.message || "").includes("Unsupported delete request")) throw error;
    console.warn(`Old Facebook post ${old.facebookPostId} was already unavailable; keeping the replacement.`);
  }
} catch (error) {
  if (replacement?.objectId) {
    await cancelFacebookScheduledPost({ root: ROOT, postId: replacement.objectId }).catch(() => {});
  }
  throw error;
}

queue[index] = {
  ...old,
  facebookPostId: replacement.objectId,
  facebookMediaId: replacement.mediaId || null,
  updatedAt: new Date().toISOString(),
};
writeFileSync(QUEUE, `${JSON.stringify(queue, null, 2)}\n`);
console.log(JSON.stringify({
  topic,
  date,
  scheduledAt: old.scheduledAt,
  oldFacebookPostId: old.facebookPostId,
  newFacebookPostId: replacement.objectId,
  media: replacement.mediaKind,
  backup: path.relative(ROOT, backup),
}, null, 2));
