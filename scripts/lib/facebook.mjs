// facebook.mjs — shared Graph API publishing used by the facebook-post.mjs
// CLI and the dashboard's Approvals tab.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { prepareFacebookCaption } from "./social-posts.mjs";
import { loadScheduledPosts } from "./scheduled-posts.mjs";

export class FacebookPublishError extends Error {
  constructor(message, { uncertain = false } = {}) {
    super(message);
    this.name = "FacebookPublishError";
    this.uncertain = uncertain;
  }
}

export function envVar(root, name) {
  if (process.env[name]) return process.env[name];
  const envPath = path.join(root, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
    if (m) return m[1].trim();
  }
  return null;
}

function graphUrls(root) {
  const version = envVar(root, "FB_GRAPH_API_VERSION") || "v25.0";
  return {
    graph: `https://graph.facebook.com/${version}`,
    video: `https://graph-video.facebook.com/${version}`,
  };
}

async function jsonResponse(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new FacebookPublishError(body.error?.message || `Facebook API error (${res.status})`);
  return body;
}

async function recentPublishedPost({ graph, pageId, token, startedAt, caption }) {
  const url = new URL(`${graph}/${encodeURIComponent(pageId)}/published_posts`);
  url.searchParams.set("fields", "id,created_time,is_published,permalink_url,message");
  url.searchParams.set("limit", "10");
  url.searchParams.set("access_token", token);
  const body = await jsonResponse(await fetch(url, { signal: AbortSignal.timeout(20_000) }));
  const expected = caption.replace(/\s+/g, " ").trim().slice(0, 160);
  const recent = (body.data || []).filter((post) => {
    const created = new Date(post.created_time).getTime();
    if (!post.is_published || !Number.isFinite(created) || created < startedAt - 10_000) return false;
    if (!post.message) return true;
    return post.message.replace(/\s+/g, " ").trim().startsWith(expected);
  });
  return recent.length === 1 ? recent[0] : null;
}

export async function listFacebookPages({ root, userAccessToken }) {
  if (!userAccessToken) throw new FacebookPublishError("Set FB_USER_ACCESS_TOKEN for this terminal session first.");
  const { graph } = graphUrls(root);
  const url = new URL(`${graph}/me/accounts`);
  url.searchParams.set("fields", "id,name,tasks,access_token");
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", userAccessToken);
  const body = await jsonResponse(await fetch(url, { signal: AbortSignal.timeout(20_000) }));
  return body.data || [];
}

export async function verifyFacebookPage({ root, requireExpectedName = true }) {
  const pageId = envVar(root, "FB_PAGE_ID");
  const token = envVar(root, "FB_PAGE_ACCESS_TOKEN");
  const expectedName = envVar(root, "FB_EXPECTED_PAGE_NAME");
  if (!pageId || !token) throw new FacebookPublishError("The new Facebook Page is not connected yet.");
  if (requireExpectedName && !expectedName) {
    throw new FacebookPublishError("FB_EXPECTED_PAGE_NAME is required so the dashboard cannot post to the wrong Page.");
  }

  const { graph } = graphUrls(root);
  const url = new URL(`${graph}/${encodeURIComponent(pageId)}`);
  url.searchParams.set("fields", "id,name,link");
  url.searchParams.set("access_token", token);
  const page = await jsonResponse(await fetch(url, { signal: AbortSignal.timeout(15_000) }));
  if (String(page.id) !== String(pageId)) throw new FacebookPublishError("Facebook returned a different Page ID than configured.");
  if (expectedName && page.name !== expectedName) {
    throw new FacebookPublishError(`Connected Page is \"${page.name}\", but FB_EXPECTED_PAGE_NAME is \"${expectedName}\".`);
  }
  return page;
}

function postAssets({ social, topic, date }) {
  const base = path.join(social, `${topic}-${date}`);
  const txtFile = `${base}.txt`;
  const pngFile = `${base}.png`;
  const mp4File = `${base}.mp4`;
  const videoCreditFile = `${base}-video-credit.txt`;
  if (!existsSync(txtFile)) throw new Error(`Missing caption file: ${topic}-${date}.txt`);
  return {
    caption: prepareFacebookCaption(readFileSync(txtFile, "utf8")),
    pngFile,
    mp4File,
    imageExists: existsSync(pngFile),
    videoExists: existsSync(mp4File),
    videoCredit: existsSync(videoCreditFile) ? readFileSync(videoCreditFile, "utf8").trim() : "",
  };
}

function captionForMedia(assets, mediaKind) {
  return mediaKind === "video" && assets.videoCredit
    ? `${assets.caption}\n\n${assets.videoCredit}`
    : assets.caption;
}

function selectedMedia({ mediaPreference, imageExists, videoExists }) {
  const allowedMedia = new Set(["image", "video", "text", "auto"]);
  if (!allowedMedia.has(mediaPreference)) throw new FacebookPublishError(`Unsupported media preference: ${mediaPreference}`);
  const mediaKind = mediaPreference === "auto" ? (imageExists ? "image" : videoExists ? "video" : "text") : mediaPreference;
  if (mediaKind === "image" && !imageExists) throw new FacebookPublishError("The selected post has no image.");
  if (mediaKind === "video" && !videoExists) throw new FacebookPublishError("The selected post has no video.");
  return mediaKind;
}

export async function listScheduledFacebookPosts({ root, limit = 100 }) {
  const pageId = envVar(root, "FB_PAGE_ID");
  const token = envVar(root, "FB_PAGE_ACCESS_TOKEN");
  if (!pageId || !token) throw new FacebookPublishError("The new Facebook Page is not connected yet.");
  const { graph } = graphUrls(root);
  const url = new URL(`${graph}/${encodeURIComponent(pageId)}/scheduled_posts`);
  url.searchParams.set("fields", "id,created_time,scheduled_publish_time,is_published,message,permalink_url");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("access_token", token);
  const body = await jsonResponse(await fetch(url, { signal: AbortSignal.timeout(20_000) }));
  return body.data || [];
}

export async function facebookPostDetails({ root, postId }) {
  const token = envVar(root, "FB_PAGE_ACCESS_TOKEN");
  if (!postId || !token) throw new FacebookPublishError("Facebook post credentials are incomplete.");
  const { graph } = graphUrls(root);
  const url = new URL(`${graph}/${encodeURIComponent(postId)}`);
  url.searchParams.set("fields", "id,created_time,is_published,permalink_url");
  url.searchParams.set("access_token", token);
  return jsonResponse(await fetch(url, { signal: AbortSignal.timeout(20_000) }));
}

export async function facebookVideoDetails({ root, videoId }) {
  const token = envVar(root, "FB_PAGE_ACCESS_TOKEN");
  if (!videoId || !token) throw new FacebookPublishError("Facebook video credentials are incomplete.");
  const { graph } = graphUrls(root);
  const url = new URL(`${graph}/${encodeURIComponent(videoId)}`);
  url.searchParams.set("fields", "id,created_time,published,scheduled_publish_time,status,permalink_url");
  url.searchParams.set("access_token", token);
  return jsonResponse(await fetch(url, { signal: AbortSignal.timeout(20_000) }));
}

export async function scheduleFacebookPost({ root, social, topic, date, mediaPreference = "image", scheduledAt }) {
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) throw new FacebookPublishError("Invalid scheduled date and time.");
  if (when.getTime() < Date.now() + 10 * 60_000) {
    throw new FacebookPublishError("Facebook requires scheduled posts to be at least 10 minutes in the future.");
  }
  const duplicate = loadScheduledPosts(root).find((entry) =>
    entry.status === "scheduled" && entry.topic === topic && entry.date !== date &&
    new Date(entry.scheduledAt).getTime() === when.getTime()
  );
  if (duplicate) {
    throw new FacebookPublishError(
      `${topic} is already scheduled in this slot from ${duplicate.date}. Cancel or replace that version first.`
    );
  }
  const assets = postAssets({ social, topic, date });
  const mediaKind = selectedMedia({ mediaPreference, ...assets });
  const caption = captionForMedia(assets, mediaKind);
  const pageId = envVar(root, "FB_PAGE_ID");
  const token = envVar(root, "FB_PAGE_ACCESS_TOKEN");
  if (!pageId || !token) throw new FacebookPublishError("The new Facebook Page is not connected yet.");
  await verifyFacebookPage({ root });
  const { graph, video } = graphUrls(root);
  const publishTime = String(Math.floor(when.getTime() / 1000));

  if (mediaKind === "video") {
    const form = new FormData();
    form.append("description", caption);
    form.append("published", "false");
    form.append("scheduled_publish_time", publishTime);
    form.append("access_token", token);
    form.append("source", new Blob([readFileSync(assets.mp4File)]), path.basename(assets.mp4File));
    const body = await jsonResponse(await fetch(`${video}/${pageId}/videos`, {
      method: "POST", body: form, signal: AbortSignal.timeout(180_000),
    }));
    return { caption, mediaKind, objectId: body.id, mediaId: body.id, response: body };
  }

  let mediaId = null;
  if (mediaKind === "image") {
    const upload = new FormData();
    upload.append("published", "false");
    upload.append("access_token", token);
    upload.append("source", new Blob([readFileSync(assets.pngFile)]), path.basename(assets.pngFile));
    const photo = await jsonResponse(await fetch(`${graph}/${pageId}/photos`, {
      method: "POST", body: upload, signal: AbortSignal.timeout(120_000),
    }));
    mediaId = photo.id;
  }

  const form = new URLSearchParams({
    message: caption,
    published: "false",
    scheduled_publish_time: publishTime,
    access_token: token,
  });
  if (mediaId) form.set("attached_media[0]", JSON.stringify({ media_fbid: mediaId }));
  const body = await jsonResponse(await fetch(`${graph}/${pageId}/feed`, {
    method: "POST", body: form, signal: AbortSignal.timeout(60_000),
  }));
  return { caption, mediaKind, objectId: body.id, mediaId, response: body };
}

export async function rescheduleFacebookPost({ root, postId, scheduledAt }) {
  const token = envVar(root, "FB_PAGE_ACCESS_TOKEN");
  const when = new Date(scheduledAt);
  if (!postId || !token) throw new FacebookPublishError("Facebook scheduled-post credentials are incomplete.");
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 10 * 60_000) {
    throw new FacebookPublishError("Facebook requires scheduled posts to be at least 10 minutes in the future.");
  }
  const { graph } = graphUrls(root);
  const form = new URLSearchParams({
    scheduled_publish_time: String(Math.floor(when.getTime() / 1000)),
    published: "false",
    access_token: token,
  });
  return jsonResponse(await fetch(`${graph}/${encodeURIComponent(postId)}`, {
    method: "POST", body: form, signal: AbortSignal.timeout(30_000),
  }));
}

export async function updateFacebookScheduledPostCaption({ root, postId, message }) {
  const token = envVar(root, "FB_PAGE_ACCESS_TOKEN");
  if (!postId || !token) throw new FacebookPublishError("Facebook scheduled-post credentials are incomplete.");
  if (!String(message || "").trim()) throw new FacebookPublishError("The scheduled post caption cannot be empty.");
  const { graph } = graphUrls(root);
  const form = new URLSearchParams({ message: String(message).trim(), access_token: token });
  return jsonResponse(await fetch(`${graph}/${encodeURIComponent(postId)}`, {
    method: "POST", body: form, signal: AbortSignal.timeout(30_000),
  }));
}

export async function updateFacebookScheduledVideoCaption({ root, videoId, description }) {
  const token = envVar(root, "FB_PAGE_ACCESS_TOKEN");
  if (!videoId || !token) throw new FacebookPublishError("Facebook scheduled-video credentials are incomplete.");
  if (!String(description || "").trim()) throw new FacebookPublishError("The scheduled video caption cannot be empty.");
  const { graph } = graphUrls(root);
  const form = new URLSearchParams({ description: String(description).trim(), access_token: token });
  return jsonResponse(await fetch(`${graph}/${encodeURIComponent(videoId)}`, {
    method: "POST", body: form, signal: AbortSignal.timeout(30_000),
  }));
}

export async function cancelFacebookScheduledPost({ root, postId }) {
  const token = envVar(root, "FB_PAGE_ACCESS_TOKEN");
  if (!postId || !token) throw new FacebookPublishError("Facebook scheduled-post credentials are incomplete.");
  const { graph } = graphUrls(root);
  const url = new URL(`${graph}/${encodeURIComponent(postId)}`);
  url.searchParams.set("access_token", token);
  return jsonResponse(await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(30_000) }));
}

// Publish a {topic}-{date} post (video > image > text-only, whichever assets
// exist) to the configured Page. Throws on missing files/credentials or a
// non-OK Graph API response.
export async function publishPost({ root, social, topic, date, mediaPreference = "image" }) {
  const assets = postAssets({ social, topic, date });
  const { pngFile, mp4File } = assets;
  const mediaKind = selectedMedia({ mediaPreference, ...assets });
  const caption = captionForMedia(assets, mediaKind);

  const pageId = envVar(root, "FB_PAGE_ID");
  const token = envVar(root, "FB_PAGE_ACCESS_TOKEN");
  if (!pageId || !token) throw new FacebookPublishError("The new Facebook Page is not connected yet.");
  await verifyFacebookPage({ root });

  const { graph, video } = graphUrls(root);
  const uploadStartedAt = Date.now();

  let res;
  try {
  if (mediaKind === "video") {
    const form = new FormData();
    form.append("description", caption);
    form.append("access_token", token);
    form.append("source", new Blob([readFileSync(mp4File)]), path.basename(mp4File));
    res = await fetch(`${video}/${pageId}/videos`, { method: "POST", body: form, signal: AbortSignal.timeout(180_000) });
  } else if (mediaKind === "image") {
    const form = new FormData();
    form.append("caption", caption);
    form.append("access_token", token);
    form.append("source", new Blob([readFileSync(pngFile)]), path.basename(pngFile));
    res = await fetch(`${graph}/${pageId}/photos`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  } else {
    const form = new URLSearchParams({ message: caption, access_token: token });
    res = await fetch(`${graph}/${pageId}/feed`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  }
  } catch (error) {
    throw new FacebookPublishError(`Facebook upload result is uncertain: ${error.message}`, { uncertain: true });
  }

  let body;
  try {
    body = await jsonResponse(res);
  } catch (error) {
    try {
      const recovered = await recentPublishedPost({ graph, pageId, token, startedAt: uploadStartedAt, caption });
      if (recovered) {
        return {
          caption, mediaKind, objectId: recovered.id, permalinkUrl: recovered.permalink_url || null,
          response: { recoveredFromPublishedPosts: true, originalError: error.message },
        };
      }
    } catch {
      // The upload may have succeeded even if Facebook's response and reconciliation both failed.
    }
    throw new FacebookPublishError(`Facebook upload result is uncertain: ${error.message}`, { uncertain: true });
  }
  let objectId = body.post_id || body.id || null;
  let permalinkUrl = null;
  if (objectId) {
    try {
      const url = new URL(`${graph}/${encodeURIComponent(objectId)}`);
      url.searchParams.set("fields", "permalink_url,created_time");
      url.searchParams.set("access_token", token);
      const details = await jsonResponse(await fetch(url, { signal: AbortSignal.timeout(15_000) }));
      permalinkUrl = details.permalink_url || null;
    } catch {
      try {
        const recovered = await recentPublishedPost({ graph, pageId, token, startedAt: uploadStartedAt, caption });
        if (recovered) {
          objectId = recovered.id;
          permalinkUrl = recovered.permalink_url || null;
        }
      } catch {
        // Publishing succeeded; a missing permalink must not turn success into failure.
      }
    }
  }
  return { caption, mediaKind, objectId, permalinkUrl, response: body };
}
