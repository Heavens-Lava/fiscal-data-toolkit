// post-log.mjs — tracks which social/ posts have already been published or
// skipped, so the Approvals queue doesn't keep re-showing handled posts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function logPath(root) {
  return path.join(root, "social", "_state", "post-log.json");
}

export function loadPostLog(root) {
  const file = logPath(root);
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return []; }
}

export function appendPostLog(root, entry) {
  const file = logPath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  const log = loadPostLog(root);
  log.push(entry);
  writeFileSync(file, JSON.stringify(log, null, 2));
  return log;
}

export function latestPostEntry(log, topic, date) {
  return [...log].reverse().find((entry) => entry.topic === topic && entry.date === date) || null;
}

export function isHandled(log, topic, date) {
  const latest = latestPostEntry(log, topic, date);
  return ["publishing", "publish_uncertain", "published", "skipped"].includes(latest?.status);
}

export function recentPostHistory(root, limit = 30) {
  return loadPostLog(root)
    .filter((entry) => ["published", "skipped", "publish_uncertain", "failed"].includes(entry.status))
    .slice(-limit)
    .reverse();
}

export function recentFailures(root, limit = 30) {
  return loadPostLog(root)
    .filter((entry) => entry.status === "failed")
    .slice(-limit)
    .reverse();
}
