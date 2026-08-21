#!/usr/bin/env node
// capture-post-metrics.mjs — pulls Facebook engagement metrics (reactions,
// comments, shares, reach, clicks, engaged users) for every published post
// and stores a timestamped snapshot in social/_state/post-metrics.json,
// tagged with its format/domain/framing (lib/post-taxonomy.mjs) so
// performance can eventually be compared along those axes instead of just
// per-post. Safe to re-run repeatedly (daily/weekly) -- each run appends a
// new snapshot rather than overwriting, so engagement-over-time is visible.
//
// Reach/clicks/engaged users come from the /insights edge, which Meta has
// been deprecating metric-by-metric across API versions. If a metric name
// stops working, this script records the failure per-post and keeps going
// with just reactions/comments/shares (core object fields, not insights,
// so they're not subject to the same deprecation churn).
//
// Run:  node scripts/capture-post-metrics.mjs

import path from "node:path";
import { fileURLToPath } from "node:url";
import { envVar, graphUrls } from "./lib/facebook.mjs";
import { loadPostLog } from "./lib/post-log.mjs";
import { recordPostMetricsSnapshot } from "./lib/post-metrics.mjs";
import { tagFor } from "./lib/post-taxonomy.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const token = envVar(ROOT, "FB_PAGE_ACCESS_TOKEN");
if (!token) throw new Error("Set FB_PAGE_ACCESS_TOKEN in .env first.");
const { graph } = graphUrls(ROOT);

async function graphGet(target, params) {
  const url = new URL(`${graph}/${encodeURIComponent(target)}`);
  for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error?.message || `Facebook HTTP ${res.status}`);
  return body;
}

// `id,permalink_url,shares` never require extra permissions beyond basic
// Page content access -- fetch these first so a post is never a total loss.
async function baseFields(fbId) {
  const body = await graphGet(fbId, { fields: "id,permalink_url,shares" });
  return { permalinkUrl: body.permalink_url || null, shares: body.shares?.count ?? 0 };
}

// reactions/comments summaries require the `pages_read_user_content`
// permission -- as of this writing the configured page token doesn't have
// it, so this fails for every post. Kept as its own try/catch (rather than
// folded into baseFields) so that permission gap doesn't also cost us
// shares/permalink, and so the failure reason is recorded once clearly.
async function engagementCounts(fbId) {
  try {
    const body = await graphGet(fbId, { fields: "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)" });
    return { reactions: body.reactions?.summary?.total_count ?? null, comments: body.comments?.summary?.total_count ?? null, note: null };
  } catch (error) {
    return { reactions: null, comments: null, note: `reactions/comments unavailable: ${error.message}` };
  }
}

// post_impressions_unique / post_engaged_users are rejected outright as
// invalid metric names on this API version (Meta deprecated them). Valid
// names as of this writing: post_clicks, post_reactions_by_type_total --
// but even those return an empty `data` array with this token, which looks
// like a missing `read_insights` permission rather than "genuinely zero"
// (Graph API returns insights silently-empty rather than erroring when the
// permission is missing). Recorded as null + note either way.
async function insightsMetrics(fbId) {
  try {
    const body = await graphGet(`${fbId}/insights`, { metric: "post_clicks,post_reactions_by_type_total" });
    const byName = Object.fromEntries((body.data || []).map((m) => [m.name, m.values?.[0]?.value ?? null]));
    const gotAny = Object.keys(byName).length > 0;
    return {
      clicks: byName.post_clicks ?? null,
      reach: null, // no valid reach/impressions metric identified for this API version yet
      note: gotAny ? null : "insights returned no data -- likely missing read_insights permission on this Page token",
    };
  } catch (error) {
    return { reach: null, clicks: null, note: `insights unavailable: ${error.message}` };
  }
}

const published = loadPostLog(ROOT).filter((entry) => entry.status === "published" && entry.fbId);
console.log(`${published.length} published post(s) found in post-log.json.`);

let ok = 0, failed = 0;
for (const entry of published) {
  const tag = tagFor(entry.topic) || {};
  try {
    const base = await baseFields(entry.fbId);
    const [engagement, insights] = await Promise.all([engagementCounts(entry.fbId), insightsMetrics(entry.fbId)]);
    const note = [engagement.note, insights.note].filter(Boolean).join("; ") || null;
    recordPostMetricsSnapshot(ROOT, {
      topic: entry.topic, date: entry.date, facebookPostId: entry.fbId,
      format: tag.format, domain: tag.domain, framing: tag.framing,
      permalinkUrl: base.permalinkUrl, shares: base.shares,
      reactions: engagement.reactions, comments: engagement.comments,
      reach: insights.reach, clicks: insights.clicks, engagedUsers: null,
      note,
    });
    ok++;
    console.log(`${entry.topic}-${entry.date}: reactions=${engagement.reactions} comments=${engagement.comments} shares=${base.shares} clicks=${insights.clicks}${note ? ` (${note})` : ""}`);
  } catch (error) {
    failed++;
    console.log(`${entry.topic}-${entry.date}: FAILED (${error.message})`);
  }
}
console.log(`\n${ok} captured, ${failed} failed.`);
