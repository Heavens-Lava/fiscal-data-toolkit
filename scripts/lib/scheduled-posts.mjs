import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function schedulePath(root) {
  return path.join(root, "social", "_state", "scheduled-posts.json");
}

export function loadScheduledPosts(root) {
  const file = schedulePath(root);
  if (!existsSync(file)) return [];
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveScheduledPosts(root, posts) {
  const file = schedulePath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(posts, null, 2)}\n`);
}

function samePost(entry, topic, date) {
  return entry.topic === topic && entry.date === date;
}

export function schedulePost(root, { topic, date, media, scheduledAt, facebookPostId, facebookMediaId }) {
  const at = new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) throw new Error("Invalid scheduled date and time.");
  const posts = loadScheduledPosts(root);
  const existing = posts.find((entry) => samePost(entry, topic, date));
  if (existing?.status === "processing") throw new Error("This scheduled post is already being processed.");
  const next = {
    topic,
    date,
    media,
    scheduledAt: at.toISOString(),
    status: "scheduled",
    delivery: facebookPostId || existing?.facebookPostId ? "facebook" : "local",
    facebookPostId: facebookPostId || existing?.facebookPostId || null,
    facebookMediaId: facebookMediaId || existing?.facebookMediaId || null,
    approvedAt: existing?.approvedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const updated = posts.filter((entry) => !samePost(entry, topic, date));
  updated.push(next);
  updated.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  saveScheduledPosts(root, updated);
  return next;
}

export function markScheduledPostProcessing(root, topic, date) {
  const posts = loadScheduledPosts(root);
  const entry = posts.find((item) => samePost(item, topic, date));
  if (!entry || entry.status !== "scheduled") return null;
  entry.status = "processing";
  entry.processingStartedAt = new Date().toISOString();
  saveScheduledPosts(root, posts);
  return entry;
}

export function recoverInterruptedSchedules(root) {
  const posts = loadScheduledPosts(root);
  let changed = false;
  for (const entry of posts) {
    if (entry.status !== "processing") continue;
    entry.status = "review";
    entry.reviewReason = "The server restarted while this post was being processed. Check Facebook before rescheduling.";
    changed = true;
  }
  if (changed) saveScheduledPosts(root, posts);
  return posts;
}

export function removeScheduledPost(root, topic, date, { allowProcessing = false } = {}) {
  const posts = loadScheduledPosts(root);
  const entry = posts.find((item) => samePost(item, topic, date));
  if (!entry) return false;
  if (entry.status === "processing" && !allowProcessing) {
    throw new Error("This post is currently being processed and cannot be changed.");
  }
  saveScheduledPosts(root, posts.filter((item) => !samePost(item, topic, date)));
  return true;
}

export function dueScheduledPosts(root, now = new Date()) {
  const cutoff = now.getTime();
  return loadScheduledPosts(root).filter((entry) =>
    entry.status === "scheduled" && entry.delivery !== "facebook" && !entry.facebookPostId &&
    new Date(entry.scheduledAt).getTime() <= cutoff
  );
}

export function dueFacebookScheduledPosts(root, now = new Date()) {
  const cutoff = now.getTime();
  return loadScheduledPosts(root).filter((entry) =>
    entry.status === "scheduled" && entry.delivery === "facebook" && entry.facebookPostId &&
    new Date(entry.scheduledAt).getTime() <= cutoff
  );
}
