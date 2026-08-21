// post-metrics.mjs — storage for captured Facebook performance snapshots,
// keyed by topic-date. Each capture run (capture-post-metrics.mjs) appends
// a timestamped snapshot rather than overwriting, so engagement-over-time
// is visible, not just a single latest reading.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function metricsPath(root) {
  return path.join(root, "social", "_state", "post-metrics.json");
}

export function loadPostMetrics(root) {
  const file = metricsPath(root);
  if (!existsSync(file)) return {};
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function savePostMetrics(root, data) {
  const file = metricsPath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function recordPostMetricsSnapshot(root, {
  topic, date, format, domain, framing, facebookPostId, permalinkUrl,
  reactions, comments, shares, reach, clicks, engagedUsers, note,
}) {
  const data = loadPostMetrics(root);
  const key = `${topic}-${date}`;
  const existing = data[key] || { topic, date, history: [] };
  existing.format = format ?? existing.format ?? null;
  existing.domain = domain ?? existing.domain ?? null;
  existing.framing = framing ?? existing.framing ?? null;
  existing.facebookPostId = facebookPostId ?? existing.facebookPostId ?? null;
  existing.permalinkUrl = permalinkUrl ?? existing.permalinkUrl ?? null;
  existing.history.push({
    capturedAt: new Date().toISOString(),
    reactions: reactions ?? null, comments: comments ?? null, shares: shares ?? null,
    reach: reach ?? null, clicks: clicks ?? null, engagedUsers: engagedUsers ?? null,
    note: note ?? null,
  });
  data[key] = existing;
  savePostMetrics(root, data);
  return existing;
}

// Convenience for analysis: flatten to one row per post using its latest
// snapshot, joined with its taxonomy tags.
export function latestMetricsByPost(root) {
  const data = loadPostMetrics(root);
  return Object.values(data).map((entry) => ({
    topic: entry.topic, date: entry.date,
    format: entry.format, domain: entry.domain, framing: entry.framing,
    permalinkUrl: entry.permalinkUrl,
    ...entry.history[entry.history.length - 1],
    snapshotCount: entry.history.length,
  }));
}
