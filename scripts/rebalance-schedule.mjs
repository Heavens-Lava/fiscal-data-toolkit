#!/usr/bin/env node
// Rebalance every future Facebook post across the configured daily slots.
// Posts that do not fit inside Facebook's scheduling horizon are returned
// to the approval queue and promoted automatically as new dates open.
//
// Run:
//   node scripts/rebalance-schedule.mjs --dry-run
//   node scripts/rebalance-schedule.mjs
//   node scripts/rebalance-schedule.mjs --include topic:YYYY-MM-DD,...

import { copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageApproval, unstageApproval } from "./lib/approval-queue.mjs";
import {
  cancelFacebookScheduledPost,
  envVar,
  rescheduleFacebookPost,
  scheduleFacebookPost,
} from "./lib/facebook.mjs";
import { loadPostLog } from "./lib/post-log.mjs";
import {
  loadScheduledPosts,
  removeScheduledPost,
  schedulePost,
} from "./lib/scheduled-posts.mjs";
import {
  nextAvailableScheduleSlot,
  parseScheduleSlots,
} from "./lib/schedule-slots.mjs";
import { categoryFor, interleaveByCategory } from "./lib/topic-categories.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const SLOTS = parseScheduleSlots(
  envVar(ROOT, "SOCIAL_SCHEDULE_SLOTS") || "08:00,12:00",
);

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const dryRun = process.argv.includes("--dry-run");
const includeArg = argValue("--include", "");
const toInclude = includeArg
  ? includeArg.split(",").map((value) => {
      const [topic, date] = value.split(":");
      return { topic, date };
    })
  : [];

const now = Date.now();
const existing = loadScheduledPosts(ROOT).filter(
  (entry) =>
    entry.status === "scheduled" &&
    new Date(entry.scheduledAt).getTime() > now,
);
const items = [
  ...existing.map((entry) => ({
    topic: entry.topic,
    date: entry.date,
    media: entry.media,
    existing: entry,
  })),
  ...toInclude.map((entry) => ({
    topic: entry.topic,
    date: entry.date,
    media: "image",
    existing: null,
  })),
];

console.log(
  `Rebalancing ${items.length} posts into ${SLOTS.length} daily slot(s): ${SLOTS.join(", ")}.`,
);
const byCategory = new Map();
for (const item of items) {
  const category = categoryFor(item.topic);
  byCategory.set(category, (byCategory.get(category) || 0) + 1);
}
console.log("Category mix:", Object.fromEntries(byCategory));

const ordered = interleaveByCategory(items, (item) => categoryFor(item.topic));
const published = loadPostLog(ROOT).filter((entry) =>
  ["published", "publish_uncertain"].includes(entry.status)
);
const simulatedScheduled = [];
const slots = [];

for (let i = 0; i < ordered.length; i++) {
  try {
    const next = nextAvailableScheduleSlot({
      scheduled: simulatedScheduled,
      published,
      startDaysAhead: 0,
      slots: SLOTS,
    });
    slots.push(next.scheduledAt);
    simulatedScheduled.push({
      scheduledAt: next.scheduledAt,
      status: "scheduled",
    });
  } catch {
    break;
  }
}

const scheduledItems = ordered.slice(0, slots.length);
const overflowItems = ordered.slice(slots.length);

console.log("\nNew Facebook schedule:");
scheduledItems.forEach((item, index) => {
  console.log(
    `  ${new Date(slots[index]).toLocaleString()}  ` +
    `[${categoryFor(item.topic)}]  ${item.topic}`,
  );
});

if (overflowItems.length) {
  console.log(
    `\nApproval-queue overflow (${overflowItems.length}; promoted later as slots open):`,
  );
  overflowItems.forEach((item) =>
    console.log(`  [${categoryFor(item.topic)}]  ${item.topic}`)
  );
}

if (dryRun) {
  console.log("\nDry run: nothing changed. Re-run without --dry-run to apply.");
  process.exit(0);
}

const scheduleFile = path.join(SOCIAL, "_state", "scheduled-posts.json");
const stamp = new Date().toISOString().replaceAll(":", "-");
const backupFile = `${scheduleFile}.before-cadence-${stamp}.json`;
copyFileSync(scheduleFile, backupFile);

console.log(`\nApplying changes. Local backup: ${backupFile}`);
let moved = 0;
let failed = 0;

for (let i = 0; i < scheduledItems.length; i++) {
  const item = scheduledItems[i];
  const scheduledAt = slots[i];
  try {
    if (item.existing) {
      if (item.existing.scheduledAt !== scheduledAt) {
        if (item.existing.facebookPostId) {
          await rescheduleFacebookPost({
            root: ROOT,
            postId: item.existing.facebookPostId,
            scheduledAt,
          });
        }
        schedulePost(ROOT, {
          topic: item.topic,
          date: item.date,
          media: item.media,
          scheduledAt,
          facebookPostId: item.existing.facebookPostId,
          facebookMediaId: item.existing.facebookMediaId,
        });
        moved++;
        console.log(`  moved: ${item.topic} -> ${new Date(scheduledAt).toLocaleString()}`);
      } else {
        console.log(`  unchanged: ${item.topic}`);
      }
    } else {
      const result = await scheduleFacebookPost({
        root: ROOT,
        social: SOCIAL,
        topic: item.topic,
        date: item.date,
        mediaPreference: item.media,
        scheduledAt,
      });
      schedulePost(ROOT, {
        topic: item.topic,
        date: item.date,
        media: item.media,
        scheduledAt,
        facebookPostId: result.objectId,
        facebookMediaId: result.mediaId,
      });
      unstageApproval(ROOT, item.topic, item.date);
      moved++;
      console.log(`  scheduled: ${item.topic} -> ${new Date(scheduledAt).toLocaleString()}`);
    }
  } catch (error) {
    failed++;
    console.error(`  FAILED: ${item.topic}: ${error.message}`);
  }
}

let queued = 0;
if (overflowItems.length) {
  console.log("\nMoving overflow posts back to the approval queue...");
  for (const item of overflowItems) {
    try {
      stageApproval(ROOT, SOCIAL, item.topic, item.date, "cadence-overflow");
      if (item.existing?.facebookPostId) {
        await cancelFacebookScheduledPost({
          root: ROOT,
          postId: item.existing.facebookPostId,
        });
      }
      if (item.existing) {
        removeScheduledPost(ROOT, item.topic, item.date);
      }
      queued++;
      console.log(`  queued: ${item.topic}`);
    } catch (error) {
      failed++;
      console.error(`  FAILED to queue ${item.topic}: ${error.message}`);
    }
  }
}

console.log(
  `\nDone. ${moved} moved or scheduled, ${queued} queued for later, ${failed} failed.`,
);
if (failed) process.exitCode = 1;
