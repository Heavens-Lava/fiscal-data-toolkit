#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envValue } from "./lib/data-common.mjs";
import { scheduleFacebookPost } from "./lib/facebook.mjs";
import { loadPostLog } from "./lib/post-log.mjs";
import { nextAvailableScheduleSlot, parseScheduleSlots } from "./lib/schedule-slots.mjs";
import { loadScheduledPosts, schedulePost } from "./lib/scheduled-posts.mjs";
import { listSocialPosts } from "./lib/social-posts.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const valueAfter = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const date = valueAfter("--date");
const topics = process.argv.slice(2).filter((value, index, values) =>
  !value.startsWith("--") && values[index - 1] !== "--date"
);
if (!date || !topics.length) {
  throw new Error("Usage: node scripts/schedule-ready-posts.mjs <topic...> --date YYYY-MM-DD");
}

const posts = listSocialPosts(SOCIAL);
const timeZone = envValue("SOCIAL_SCHEDULE_TIMEZONE") || "America/Phoenix";
const slots = parseScheduleSlots(envValue("SOCIAL_SCHEDULE_SLOTS") || "08:00,12:00");
const published = loadPostLog(ROOT).filter((entry) => ["published", "publish_uncertain"].includes(entry.status));

for (const topic of topics) {
  const post = posts.find((entry) => entry.topic === topic && entry.date === date);
  if (!post) throw new Error(`Generated post not found: ${topic}-${date}`);
  if (post.problems.length || !post.hasImage) {
    throw new Error(`${topic}-${date} is not ready: ${post.problems.join("; ") || "missing image"}`);
  }
  const next = nextAvailableScheduleSlot({
    scheduled: loadScheduledPosts(ROOT), published, timeZone, slots, startDaysAhead: 0,
  });
  const facebook = await scheduleFacebookPost({
    root: ROOT, social: SOCIAL, topic, date, mediaPreference: "image", scheduledAt: next.scheduledAt,
  });
  const entry = schedulePost(ROOT, {
    topic, date, media: "image", scheduledAt: next.scheduledAt,
    facebookPostId: facebook.objectId, facebookMediaId: facebook.mediaId,
  });
  console.log(`${topic} -> ${entry.scheduledAt} (${next.slot} ${timeZone})`);
}
