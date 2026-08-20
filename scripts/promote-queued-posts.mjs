#!/usr/bin/env node
// promote-queued-posts.mjs — Facebook won't accept scheduled_publish_time
// more than ~27 days out (see maxDaysAhead in lib/schedule-slots.mjs), but
// the approval queue (stage-facebook-post.mjs) can hold far more content
// than that window has slots for. This is the "overflow scheduler": it
// walks the approval queue oldest-first and promotes as many as currently
// fit into real Facebook scheduled slots, stopping cleanly (not erroring)
// once the window is full. Run it periodically (e.g. daily, alongside the
// existing autonomous-social-run.mjs task) so posts that didn't fit last
// time get scheduled automatically as earlier slots roll off the calendar.
//
// Run:
//   node scripts/promote-queued-posts.mjs
//   node scripts/promote-queued-posts.mjs --limit 5

import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPendingApprovals, unstageApproval } from "./lib/approval-queue.mjs";
import { envValue } from "./lib/data-common.mjs";
import { scheduleFacebookPost } from "./lib/facebook.mjs";
import { loadPostLog } from "./lib/post-log.mjs";
import { annotatePending, categoryFor, orderForPromotion } from "./lib/promotion-priority.mjs";
import { nextAvailableScheduleSlot, parseScheduleSlots } from "./lib/schedule-slots.mjs";
import { loadScheduledPosts, schedulePost } from "./lib/scheduled-posts.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const limit = Number(argValue("--limit", "1000"));
const timeZone = envValue("SOCIAL_SCHEDULE_TIMEZONE") || "America/Phoenix";
const slots = parseScheduleSlots(envValue("SOCIAL_SCHEDULE_SLOTS") || "08:00,12:00");

// Validation gate -> editorial score + topic-diversity + aging -> ordering.
// "fail"-verdict posts are excluded outright (never auto-promoted); their
// topic/date and the specific check(s) that failed are logged so a human
// can fix them, same as running `validate-posts.mjs --pending --fails-only`.
const rawPending = listPendingApprovals(ROOT, SOCIAL).filter((post) => post.hasImage || post.hasVideo);
const annotated = annotatePending(ROOT, SOCIAL, rawPending);

const recentCategories = loadScheduledPosts(ROOT)
  .filter((p) => p.status === "scheduled")
  .sort((a, b) => new Date(b.scheduledAt) - new Date(a.scheduledAt))
  .slice(0, 6)
  .map((p) => categoryFor(p.topic))
  .reverse();

const { ordered, excluded } = orderForPromotion(annotated, { recentCategories });
if (excluded.length) {
  console.log(`Skipping ${excluded.length} post(s) that failed validation (won't be auto-promoted):`);
  for (const p of excluded) {
    for (const f of p.validation.fails) console.log(`  - ${p.topic}-${p.date}: [${f.id}] ${f.message}`);
  }
}
const pending = ordered.slice(0, limit);

if (!pending.length) {
  console.log("Approval queue is empty (or everything pending failed validation) — nothing to promote.");
  process.exit(0);
}

console.log(`${pending.length} post(s) pending approval and eligible. Promoting as many as fit in the next ${slots.length}x/day Facebook scheduling window...`);

let promoted = 0;
for (const post of pending) {
  const published = loadPostLog(ROOT).filter((entry) => ["published", "publish_uncertain"].includes(entry.status));
  let next;
  try {
    next = nextAvailableScheduleSlot({
      scheduled: loadScheduledPosts(ROOT), published, timeZone, slots, startDaysAhead: 0,
    });
  } catch {
    console.log(`Scheduling window is full — stopping. ${pending.length - promoted} post(s) still waiting in the approval queue.`);
    break;
  }
  const media = post.hasImage ? "image" : "video";
  try {
    const facebook = await scheduleFacebookPost({
      root: ROOT, social: SOCIAL, topic: post.topic, date: post.date, mediaPreference: media, scheduledAt: next.scheduledAt,
    });
    schedulePost(ROOT, {
      topic: post.topic, date: post.date, media, scheduledAt: next.scheduledAt,
      facebookPostId: facebook.objectId, facebookMediaId: facebook.mediaId,
    });
    unstageApproval(ROOT, post.topic, post.date);
    promoted++;
    console.log(`${post.topic}-${post.date} -> ${next.scheduledAt} (${next.slot} ${timeZone})`);
  } catch (error) {
    console.error(`Failed to schedule ${post.topic}-${post.date}: ${error.message}`);
  }
}

console.log(`\nPromoted ${promoted} of ${pending.length} pending post(s).`);
