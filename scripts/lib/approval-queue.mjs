import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listSocialPosts } from "./social-posts.mjs";
import { isHandled, loadPostLog } from "./post-log.mjs";
import { loadScheduledPosts } from "./scheduled-posts.mjs";

function queuePath(root) {
  return path.join(root, "social", "_state", "approval-queue.json");
}

export function loadApprovalQueue(root) {
  const file = queuePath(root);
  if (!existsSync(file)) return [];
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveApprovalQueue(root, queue) {
  const file = queuePath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(queue, null, 2)}\n`);
}

export function stageApproval(root, socialDir, topic, date, source = "manual") {
  const post = listSocialPosts(socialDir).find((item) => item.topic === topic && item.date === date);
  if (!post) throw new Error(`Generated post not found: ${topic}-${date}`);
  if (post.problems.length) throw new Error(`Post is not ready: ${post.problems.join("; ")}`);
  const queue = loadApprovalQueue(root);
  if (!queue.some((entry) => entry.topic === topic && entry.date === date)) {
    queue.push({ topic, date, source, stagedAt: new Date().toISOString() });
    saveApprovalQueue(root, queue);
  }
  return post;
}

export function unstageApproval(root, topic, date) {
  const queue = loadApprovalQueue(root);
  const next = queue.filter((entry) => entry.topic !== topic || entry.date !== date);
  saveApprovalQueue(root, next);
  return queue.length !== next.length;
}

export function listPendingApprovals(root, socialDir) {
  const queue = loadApprovalQueue(root);
  const posts = new Map(listSocialPosts(socialDir).map((post) => [`${post.topic}|${post.date}`, post]));
  const log = loadPostLog(root);
  const scheduled = new Set(loadScheduledPosts(root).map((entry) => `${entry.topic}|${entry.date}`));
  return queue
    .filter((entry) => !isHandled(log, entry.topic, entry.date) && !scheduled.has(`${entry.topic}|${entry.date}`))
    .map((entry) => {
      const post = posts.get(`${entry.topic}|${entry.date}`);
      return post ? { ...post, stagedAt: entry.stagedAt, stagedBy: entry.source } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.stagedAt.localeCompare(a.stagedAt));
}
