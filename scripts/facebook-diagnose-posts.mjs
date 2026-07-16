#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envVar } from "./lib/facebook.mjs";
import { loadPostLog } from "./lib/post-log.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const graph = `https://graph.facebook.com/${envVar(ROOT, "FB_GRAPH_API_VERSION") || "v25.0"}`;
const token = envVar(ROOT, "FB_PAGE_ACCESS_TOKEN");
const pageId = envVar(ROOT, "FB_PAGE_ID");
if (!token || !pageId) throw new Error("Facebook Page credentials are not configured.");

async function graphGet(target, fields) {
  const url = new URL(`${graph}/${target}`);
  if (fields) url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", token);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error?.message || `Facebook HTTP ${response.status}`);
  return body;
}

const published = loadPostLog(ROOT).filter((entry) => entry.status === "published" && entry.fbId);
console.log(`Configured Page: ${pageId}`);
for (const entry of published) {
  try {
    const post = await graphGet(entry.fbId, "id,created_time,is_published,permalink_url");
    console.log({ topic: entry.topic, loggedId: entry.fbId, ...post });
  } catch (error) {
    console.log({ topic: entry.topic, loggedId: entry.fbId, error: error.message });
  }
}

try {
  const feed = await graphGet(`${pageId}/published_posts`, "id,created_time,is_published,permalink_url");
  console.log("Recent published Page posts:");
  console.table((feed.data || []).slice(0, 10).map((post) => ({
    id: post.id, created: post.created_time, published: post.is_published, permalink: post.permalink_url,
  })));
} catch (error) {
  console.log(`Published-post listing error: ${error.message}`);
}
