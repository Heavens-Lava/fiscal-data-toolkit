#!/usr/bin/env node
// Rebalance the Facebook posting schedule so topics from the same category
// (Energy, Agriculture, Cost of Living, etc.) don't run back-to-back for
// days at a time. Reorders all not-yet-published scheduled posts plus any
// staged-but-unscheduled posts passed via --include, keeping the same set
// of time slots but reassigning which topic occupies which slot.
//
// Run:  node scripts/rebalance-schedule.mjs --dry-run
//       node scripts/rebalance-schedule.mjs --include state-corn-watch:2026-07-16,state-wheat-watch:2026-07-16,...

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadScheduledPosts, schedulePost } from "./lib/scheduled-posts.mjs";
import { rescheduleFacebookPost, scheduleFacebookPost, listScheduledFacebookPosts, envVar } from "./lib/facebook.mjs";
import { unstageApproval } from "./lib/approval-queue.mjs";
import { nextAvailableScheduleSlot, parseScheduleSlots } from "./lib/schedule-slots.mjs";
import { categoryFor, interleaveByCategory } from "./lib/topic-categories.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const SLOTS = parseScheduleSlots(envVar(ROOT, "SOCIAL_SCHEDULE_SLOTS") || "08:00,12:00");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const dryRun = process.argv.includes("--dry-run");
const includeArg = argValue("--include", "");
const toInclude = includeArg
  ? includeArg.split(",").map((s) => { const [topic, date] = s.split(":"); return { topic, date }; })
  : [];

// Topics with no known category (categoryFor returns "Other") are treated
// as fixed anchors, not ours to move — likely a different content pipeline
// sharing this same schedule. Their slots are reserved but left untouched;
// only recognized-category topics get reordered/interleaved.
const allScheduled = loadScheduledPosts(ROOT).filter((e) => e.status === "scheduled");
const anchored = allScheduled.filter((e) => categoryFor(e.topic) === "Other");
const existing = allScheduled.filter((e) => categoryFor(e.topic) !== "Other");
const items = [
  ...existing.map((e) => ({ topic: e.topic, date: e.date, media: e.media, existing: e })),
  ...toInclude.map((e) => ({ topic: e.topic, date: e.date, media: "image", existing: null })),
];

if (anchored.length) {
  console.log(`Leaving ${anchored.length} unrecognized-category post(s) untouched (not ours to move): ${anchored.map((e) => e.topic).join(", ")}`);
}
console.log(`Rebalancing ${items.length} posts (${existing.length} already scheduled + ${toInclude.length} newly included).`);
const byCategory = new Map();
for (const item of items) {
  const cat = categoryFor(item.topic);
  byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
}
console.log("Category mix:", Object.fromEntries(byCategory));

const ordered = interleaveByCategory(items, (item) => categoryFor(item.topic));

// Generate exactly items.length slots, in order, using the same policy the
// live scheduler uses (America/Phoenix) — simulate occupancy as we go so
// each call sees previously assigned slots (and the anchored ones we're
// leaving alone) as taken.
const simulatedScheduled = anchored.map((e) => ({ scheduledAt: e.scheduledAt, status: "scheduled" }));
const slots = [];
for (let i = 0; i < ordered.length; i++) {
  const next = nextAvailableScheduleSlot({ scheduled: simulatedScheduled, startDaysAhead: 0, slots: SLOTS });
  slots.push(next.scheduledAt);
  simulatedScheduled.push({ scheduledAt: next.scheduledAt, status: "scheduled" });
}

console.log("\nNew order:");
ordered.forEach((item, i) => console.log(`  ${new Date(slots[i]).toLocaleString()}  [${categoryFor(item.topic)}]  ${item.topic}`));

if (dryRun) {
  console.log("\nDry run — nothing changed. Re-run without --dry-run to apply.");
  process.exit(0);
}

// Another process (a different content pipeline) can schedule its own posts
// to this same Page concurrently with this run. The `slots` plan above was
// computed from a one-time snapshot, so by the time we get to item i that
// plan can be stale — re-check the live schedule immediately before each
// write and steer around anything that landed on our intended slot in the
// meantime, instead of writing into a collision and needing manual cleanup
// afterward (see 2026-07-16 incident: a concurrent run scheduled 13 posts
// into slots this script had just planned to use).
async function resolveLiveSlot(candidateAt, ownPostId) {
  const live = await listScheduledFacebookPosts({ root: ROOT });
  const candidateEpoch = Math.floor(new Date(candidateAt).getTime() / 1000);
  const clash = live.some((p) => p.scheduled_publish_time === candidateEpoch && p.id !== ownPostId);
  if (!clash) return candidateAt;
  const liveScheduled = live.filter((p) => p.id !== ownPostId)
    .map((p) => ({ scheduledAt: new Date(p.scheduled_publish_time * 1000).toISOString(), status: "scheduled" }));
  const next = nextAvailableScheduleSlot({ scheduled: liveScheduled, startDaysAhead: 0, slots: SLOTS });
  console.log(`  (slot ${new Date(candidateAt).toLocaleString()} was just taken by another process — using ${new Date(next.scheduledAt).toLocaleString()} instead)`);
  return next.scheduledAt;
}

console.log("\nApplying...");
for (let i = 0; i < ordered.length; i++) {
  const item = ordered[i];
  const plannedAt = slots[i];
  try {
    if (item.existing) {
      const scheduledAt = await resolveLiveSlot(plannedAt, item.existing.facebookPostId);
      if (item.existing.scheduledAt === scheduledAt) { console.log(`  (unchanged) ${item.topic}`); continue; }
      if (item.existing.facebookPostId) {
        await rescheduleFacebookPost({ root: ROOT, postId: item.existing.facebookPostId, scheduledAt });
      }
      schedulePost(ROOT, {
        topic: item.topic, date: item.date, media: item.media, scheduledAt,
        facebookPostId: item.existing.facebookPostId, facebookMediaId: item.existing.facebookMediaId,
      });
      console.log(`  moved: ${item.topic} -> ${new Date(scheduledAt).toLocaleString()}`);
    } else {
      const scheduledAt = await resolveLiveSlot(plannedAt, null);
      const result = await scheduleFacebookPost({ root: ROOT, social: SOCIAL, topic: item.topic, date: item.date, mediaPreference: item.media, scheduledAt });
      schedulePost(ROOT, {
        topic: item.topic, date: item.date, media: item.media, scheduledAt,
        facebookPostId: result.objectId, facebookMediaId: result.mediaId,
      });
      unstageApproval(ROOT, item.topic, item.date);
      console.log(`  scheduled new: ${item.topic} -> ${new Date(scheduledAt).toLocaleString()}`);
    }
  } catch (error) {
    console.error(`  FAILED: ${item.topic}: ${error.message}`);
  }
}
console.log("\nDone.");
