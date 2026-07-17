#!/usr/bin/env node
// server.mjs — tiny zero-dependency web server for the dashboard frontend.
// Serves the static page and JSON endpoints that call the gov APIs server-side
// (so the browser never hits CORS / User-Agent walls).
//
// Run:  npm run web   (or: node server.mjs)   then open http://localhost:3000

import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";
import { fiscal, trade, money, banking, markets, housing, stock, screen } from "./lib/data.mjs";
import { CATEGORIES, metaFor } from "./lib/topics.mjs";
import { listPendingApprovals } from "./scripts/lib/approval-queue.mjs";
import {
  cancelFacebookScheduledPost,
  envVar,
  facebookPostDetails,
  publishPost,
  rescheduleFacebookPost,
  scheduleFacebookPost,
  verifyFacebookPage,
} from "./scripts/lib/facebook.mjs";
import { appendPostLog, loadPostLog, recentFailures, recentPostHistory } from "./scripts/lib/post-log.mjs";
import {
  dueScheduledPosts,
  dueFacebookScheduledPosts,
  loadScheduledPosts,
  markScheduledPostProcessing,
  recoverInterruptedSchedules,
  removeScheduledPost,
  schedulePost,
} from "./scripts/lib/scheduled-posts.mjs";
import { nextAvailableScheduleSlot, parseScheduleSlots, videoCadenceSchedulePlan } from "./scripts/lib/schedule-slots.mjs";
import {
  approvalAuthReady,
  approvalSessionCookie,
  clearApprovalSessionCookie,
  isApprovalAuthenticated,
  verifyApprovalPassword,
} from "./scripts/lib/approval-auth.mjs";
import { sendTelegramConfirmation } from "./scripts/lib/telegram-confirmation.mjs";

const DEFAULT_WATCHLIST = ["NVDA", "AMD", "MU", "PLTR", "RBLX", "MSFT", "META", "GOOGL", "AMZN", "INTC", "DELL", "AVGO"];

const ROOT = dirname(fileURLToPath(import.meta.url));
const SOCIAL = join(ROOT, "social");
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const ASSET_TYPE = { png: "image/png", mp4: "video/mp4", html: "text/html", csv: "text/csv", txt: "text/plain" };
const PUBLIC_ASSETS = { "/styles.css": "text/css", "/app.js": "text/javascript" };
const SOCIAL_SCHEDULE_TIMEZONE = envVar(ROOT, "SOCIAL_SCHEDULE_TIMEZONE") || "America/Phoenix";
const SOCIAL_SCHEDULE_SLOTS = parseScheduleSlots(envVar(ROOT, "SOCIAL_SCHEDULE_SLOTS") || "08:00,12:00");

recoverInterruptedSchedules(ROOT);

const sendJSON = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
};

// Simple in-memory cache so we don't re-hit the APIs (esp. FDIC's 4,352 banks)
// on every page load. Macro data updates daily/quarterly, so 10 min is plenty.
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  cache.set(key, { val, exp: Date.now() + ttlMs });
  return val;
}
const TEN_MIN = 10 * 60 * 1000;

// Scan social/ for the latest generated chart card per topic (png/html/csv/txt
// share a `<topic>-YYYY-MM-DD` basename). Top-level files only — the dated
// subfolders under social/ are curated archive bundles, not the live set.
function galleryTopics() {
  let names;
  try { names = readdirSync(SOCIAL); } catch { return []; }
  const parsed = names
    .map((name) => ({ name, m: name.match(/^(.+)-(\d{4}-\d{2}-\d{2})\.(png|html|csv|txt)$/) }))
    .filter((x) => x.m)
    .map((x) => ({ name: x.name, topic: x.m[1], date: x.m[2], ext: x.m[3] }));

  const latestDate = new Map();
  for (const p of parsed) if (!latestDate.has(p.topic) || p.date > latestDate.get(p.topic)) latestDate.set(p.topic, p.date);

  const byTopic = new Map();
  for (const p of parsed) {
    if (p.date !== latestDate.get(p.topic)) continue;
    if (!byTopic.has(p.topic)) byTopic.set(p.topic, { topic: p.topic, date: p.date, files: {} });
    byTopic.get(p.topic).files[p.ext] = p.name;
  }

  return [...byTopic.values()]
    .map((t) => {
      const caption = t.files.txt
        ? readFileSync(join(SOCIAL, t.files.txt), "utf8").trim().split(/\r?\n/).find((l) => l.trim()) || ""
        : "";
      return { ...t, ...metaFor(t.topic), caption };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}

// Settle each domain independently so one failing API doesn't blank the page.
async function settled(label, fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: e.message, label }; }
}

// Posts not yet published or skipped, newest/highest-score first.
function pendingApprovals() {
  return listPendingApprovals(ROOT, SOCIAL);
}

const publishing = new Set();
const loginAttempts = new Map();

function approvalKey(topic, date) {
  return `${topic}|${date}`;
}

function requireApprovalAuth(req, res) {
  if (!approvalAuthReady(ROOT)) {
    sendJSON(res, 503, { error: "Approval login is not configured on the server." });
    return false;
  }
  if (!isApprovalAuthenticated(ROOT, req)) {
    sendJSON(res, 401, { error: "Approval login required." });
    return false;
  }
  return true;
}

function loginRateLimited(req) {
  const forwarded = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"];
  const key = String(forwarded || req.socket.remoteAddress || "unknown").split(",")[0].trim();
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter((time) => now - time < 15 * 60 * 1000);
  attempts.push(now);
  loginAttempts.set(key, attempts);
  return attempts.length > 10;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

async function publishApprovedPost({ topic, date, media }) {
  const key = approvalKey(topic, date);
  if (publishing.has(key)) throw new Error("This post is already being published.");
  publishing.add(key);
  appendPostLog(ROOT, { topic, date, status: "publishing", media, at: new Date().toISOString() });
  try {
    const result = await publishPost({ root: ROOT, social: SOCIAL, topic, date, mediaPreference: media });
    appendPostLog(ROOT, {
      topic, date, media, status: "published", at: new Date().toISOString(),
      fbId: result.objectId, permalinkUrl: result.permalinkUrl,
    });
    const telegram = await sendTelegramConfirmation({
      root: ROOT, topic, date, mediaKind: result.mediaKind, permalinkUrl: result.permalinkUrl,
    });
    return { ...result, telegram };
  } catch (error) {
    appendPostLog(ROOT, {
      topic, date, media, status: error.uncertain ? "publish_uncertain" : "failed",
      at: new Date().toISOString(), error: error.message,
    });
    throw error;
  } finally {
    publishing.delete(key);
  }
}

async function scheduleApprovedPost({ topic, date, media, scheduledAt, existing = null }) {
  if (existing?.facebookPostId) {
    await rescheduleFacebookPost({ root: ROOT, postId: existing.facebookPostId, scheduledAt });
    return schedulePost(ROOT, {
      topic, date, media, scheduledAt,
      facebookPostId: existing.facebookPostId,
      facebookMediaId: existing.facebookMediaId,
    });
  }
  const result = await scheduleFacebookPost({
    root: ROOT, social: SOCIAL, topic, date, mediaPreference: media, scheduledAt,
  });
  return schedulePost(ROOT, {
    topic, date, media, scheduledAt,
    facebookPostId: result.objectId,
    facebookMediaId: result.mediaId,
  });
}

let scheduleSweepActive = false;
async function publishDueSchedule() {
  if (scheduleSweepActive) return;
  scheduleSweepActive = true;
  try {
    for (const due of dueScheduledPosts(ROOT)) {
      const claimed = markScheduledPostProcessing(ROOT, due.topic, due.date);
      if (!claimed) continue;
      try {
        await publishApprovedPost(claimed);
      } catch (error) {
        console.error(`Scheduled Facebook publish failed for ${due.topic}-${due.date}: ${error.message}`);
      } finally {
        removeScheduledPost(ROOT, due.topic, due.date, { allowProcessing: true });
      }
    }
    for (const due of dueFacebookScheduledPosts(ROOT)) {
      const alreadyLogged = loadPostLog(ROOT).some((entry) =>
        entry.topic === due.topic && entry.date === due.date &&
        ["published", "publish_uncertain"].includes(entry.status)
      );
      if (alreadyLogged) {
        removeScheduledPost(ROOT, due.topic, due.date);
        continue;
      }
      try {
        const post = await facebookPostDetails({ root: ROOT, postId: due.facebookPostId });
        if (!post.is_published) continue;
        appendPostLog(ROOT, {
          topic: due.topic,
          date: due.date,
          media: due.media,
          status: "published",
          at: post.created_time || new Date().toISOString(),
          fbId: post.id,
          permalinkUrl: post.permalink_url || null,
          nativeScheduled: true,
        });
        await sendTelegramConfirmation({
          root: ROOT,
          topic: due.topic,
          date: due.date,
          mediaKind: due.media,
          permalinkUrl: post.permalink_url || null,
        });
        removeScheduledPost(ROOT, due.topic, due.date);
      } catch (error) {
        console.error(`Facebook scheduled-post confirmation failed for ${due.topic}-${due.date}: ${error.message}`);
      }
    }
  } finally {
    scheduleSweepActive = false;
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  const u = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (u.pathname === "/" || u.pathname === "/index.html") {
      const html = await readFile(join(ROOT, "public", "index.html"));
      res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      return res.end(html);
    }
    if (PUBLIC_ASSETS[u.pathname]) {
      const data = await readFile(join(ROOT, "public", u.pathname));
      res.writeHead(200, { "Content-Type": PUBLIC_ASSETS[u.pathname], "Cache-Control": "no-store" });
      return res.end(data);
    }
    if (u.pathname === "/api/dashboard") {
      // Each domain cached + settled independently → fast and fault-tolerant.
      const [f, t, m, b, mk] = await Promise.all([
        settled("fiscal", () => cached("fiscal", TEN_MIN, fiscal)),
        settled("trade", () => cached("trade", TEN_MIN, trade)),
        settled("money", () => cached("money", TEN_MIN, money)),
        settled("banking", () => cached("banking", TEN_MIN, banking)),
        settled("markets", () => cached("markets", TEN_MIN, markets)),
      ]);
      const h = await settled("housing", () => cached("housing", TEN_MIN, housing));
      return sendJSON(res, 200, { fiscal: f, trade: t, money: m, banking: b, markets: mk, housing: h });
    }
    if (u.pathname === "/api/stock") {
      const ticker = (u.searchParams.get("ticker") || "").trim().toUpperCase();
      if (!ticker) return sendJSON(res, 400, { error: "missing ?ticker=" });
      return sendJSON(res, 200, await cached(`stock:${ticker}`, TEN_MIN, () => stock(ticker)));
    }
    if (u.pathname === "/api/screen") {
      const list = (u.searchParams.get("tickers") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const tickers = list.length ? list : DEFAULT_WATCHLIST;
      return sendJSON(res, 200, await cached(`screen:${tickers.join(",")}`, TEN_MIN, () => screen(tickers)));
    }
    if (u.pathname === "/api/gallery") {
      const ONE_MIN = 60 * 1000;
      const topics = await cached("gallery", ONE_MIN, async () => galleryTopics());
      return sendJSON(res, 200, { categories: CATEGORIES, topics });
    }
    if (u.pathname === "/api/approvals/session" && req.method === "GET") {
      return sendJSON(res, 200, {
        configured: approvalAuthReady(ROOT),
        authenticated: isApprovalAuthenticated(ROOT, req),
        facebookConfigured: Boolean(envVar(ROOT, "FB_PAGE_ID") && envVar(ROOT, "FB_PAGE_ACCESS_TOKEN") && envVar(ROOT, "FB_EXPECTED_PAGE_NAME")),
        expectedPage: envVar(ROOT, "FB_EXPECTED_PAGE_NAME") || null,
        telegramConfigured: Boolean(envVar(ROOT, "TELEGRAM_CHAT_ID")),
      });
    }
    if (u.pathname === "/api/approvals/login" && req.method === "POST") {
      if (!approvalAuthReady(ROOT)) return sendJSON(res, 503, { error: "Set APPROVAL_PASSWORD and a 32+ character APPROVAL_SESSION_SECRET in .env." });
      if (loginRateLimited(req)) return sendJSON(res, 429, { error: "Too many login attempts. Try again later." });
      const { password } = await readJsonBody(req);
      if (!verifyApprovalPassword(ROOT, password)) return sendJSON(res, 401, { error: "Incorrect approval password." });
      res.setHeader("Set-Cookie", approvalSessionCookie(ROOT, req));
      return sendJSON(res, 200, { ok: true });
    }
    if (u.pathname === "/api/approvals/logout" && req.method === "POST") {
      res.setHeader("Set-Cookie", clearApprovalSessionCookie(req));
      return sendJSON(res, 200, { ok: true });
    }
    if (u.pathname === "/api/approvals" && req.method === "GET") {
      if (!requireApprovalAuth(req, res)) return;
      return sendJSON(res, 200, {
        posts: pendingApprovals(),
        scheduled: loadScheduledPosts(ROOT),
        schedulePolicy: { timeZone: SOCIAL_SCHEDULE_TIMEZONE, slots: SOCIAL_SCHEDULE_SLOTS },
        history: recentPostHistory(ROOT),
        published: loadPostLog(ROOT)
          .filter((entry) => ["published", "publish_uncertain"].includes(entry.status))
          .slice(-200)
          .reverse(),
        failed: recentFailures(ROOT, 50),
      });
    }
    if (u.pathname === "/api/approvals/facebook" && req.method === "GET") {
      if (!requireApprovalAuth(req, res)) return;
      try {
        const page = await verifyFacebookPage({ root: ROOT });
        return sendJSON(res, 200, { ok: true, page });
      } catch (error) {
        return sendJSON(res, 409, { ok: false, error: error.message });
      }
    }
    if (u.pathname === "/api/approvals/publish" && req.method === "POST") {
      if (!requireApprovalAuth(req, res)) return;
      const { topic, date, media = "image" } = await readJsonBody(req);
      if (!topic || !date) return sendJSON(res, 400, { error: "missing topic/date" });
      const post = pendingApprovals().find((item) => item.topic === topic && item.date === date);
      if (!post) return sendJSON(res, 409, { error: "This post is no longer pending approval." });
      if (!new Set(["image", "video", "text"]).has(media)) return sendJSON(res, 400, { error: "invalid media choice" });
      if (media === "image" && !post.hasImage) return sendJSON(res, 400, { error: "This post has no image." });
      if (media === "video" && !post.hasVideo) return sendJSON(res, 400, { error: "This post has no video." });

      try {
        const result = await publishApprovedPost({ topic, date, media });
        return sendJSON(res, 200, {
          ok: true, response: result.response, permalinkUrl: result.permalinkUrl, telegram: result.telegram,
        });
      } catch (e) {
        return sendJSON(res, 500, { ok: false, error: e.message });
      }
    }
    if (u.pathname === "/api/approvals/schedule" && req.method === "POST") {
      if (!requireApprovalAuth(req, res)) return;
      const { topic, date, media = "image", scheduledAt } = await readJsonBody(req);
      if (!topic || !date || !scheduledAt) return sendJSON(res, 400, { error: "missing topic/date/scheduledAt" });
      if (!new Set(["image", "video", "text"]).has(media)) return sendJSON(res, 400, { error: "invalid media choice" });
      const when = new Date(scheduledAt);
      if (Number.isNaN(when.getTime())) return sendJSON(res, 400, { error: "Invalid scheduled date and time." });
      if (when.getTime() <= Date.now()) return sendJSON(res, 400, { error: "Choose a future date and time." });
      const post = pendingApprovals().find((item) => item.topic === topic && item.date === date);
      const existing = loadScheduledPosts(ROOT).find((item) => item.topic === topic && item.date === date);
      if (!post && !existing) return sendJSON(res, 409, { error: "This post is no longer available to schedule." });
      if (post && media === "image" && !post.hasImage) return sendJSON(res, 400, { error: "This post has no image." });
      if (post && media === "video" && !post.hasVideo) return sendJSON(res, 400, { error: "This post has no video." });
      if (existing && media !== existing.media) return sendJSON(res, 400, { error: "Cancel the schedule before changing its media." });
      try {
        const scheduled = await scheduleApprovedPost({
          topic, date, media, scheduledAt: when.toISOString(), existing,
        });
        return sendJSON(res, 200, { ok: true, scheduled });
      } catch (error) {
        return sendJSON(res, 409, { error: error.message });
      }
    }
    if (u.pathname === "/api/approvals/schedule-next" && req.method === "POST") {
      if (!requireApprovalAuth(req, res)) return;
      const { topic, date, media = "image" } = await readJsonBody(req);
      if (!topic || !date) return sendJSON(res, 400, { error: "missing topic/date" });
      if (!new Set(["image", "video", "text"]).has(media)) return sendJSON(res, 400, { error: "invalid media choice" });
      const post = pendingApprovals().find((item) => item.topic === topic && item.date === date);
      if (!post) return sendJSON(res, 409, { error: "This post is no longer pending approval." });
      if (media === "image" && !post.hasImage) return sendJSON(res, 400, { error: "This post has no image." });
      if (media === "video" && !post.hasVideo) return sendJSON(res, 400, { error: "This post has no video." });
      try {
        const scheduledPosts = loadScheduledPosts(ROOT);
        const next = nextAvailableScheduleSlot({
          scheduled: scheduledPosts,
          published: loadPostLog(ROOT).filter((entry) => ["published", "publish_uncertain"].includes(entry.status)),
          timeZone: SOCIAL_SCHEDULE_TIMEZONE,
          slots: SOCIAL_SCHEDULE_SLOTS,
          startDaysAhead: 0,
        });
        const plan = media === "video"
          ? videoCadenceSchedulePlan({ scheduled: scheduledPosts, nextSlot: next })
          : next;
        let displacedMoved = false;
        try {
          if (plan.displaced) {
            if (plan.displaced.facebookPostId) {
              await rescheduleFacebookPost({
                root: ROOT, postId: plan.displaced.facebookPostId, scheduledAt: plan.displacedAt,
              });
            }
            schedulePost(ROOT, { ...plan.displaced, scheduledAt: plan.displacedAt });
            displacedMoved = true;
          }
          const scheduled = await scheduleApprovedPost({
            topic, date, media, scheduledAt: plan.scheduledAt,
          });
          return sendJSON(res, 200, { ok: true, scheduled, policy: plan });
        } catch (error) {
          if (displacedMoved) {
            try {
              if (plan.displaced.facebookPostId) {
                await rescheduleFacebookPost({
                  root: ROOT, postId: plan.displaced.facebookPostId, scheduledAt: plan.displaced.scheduledAt,
                });
              }
              schedulePost(ROOT, plan.displaced);
            } catch (rollbackError) {
              console.error(`Could not roll back displaced schedule ${plan.displaced.topic}: ${rollbackError.message}`);
            }
          }
          throw error;
        }
      } catch (error) {
        return sendJSON(res, 409, { error: error.message });
      }
    }
    if (u.pathname === "/api/approvals/schedule/cancel" && req.method === "POST") {
      if (!requireApprovalAuth(req, res)) return;
      const { topic, date } = await readJsonBody(req);
      if (!topic || !date) return sendJSON(res, 400, { error: "missing topic/date" });
      try {
        const existing = loadScheduledPosts(ROOT).find((item) => item.topic === topic && item.date === date);
        if (existing?.facebookPostId) {
          await cancelFacebookScheduledPost({ root: ROOT, postId: existing.facebookPostId });
        }
        const removed = removeScheduledPost(ROOT, topic, date);
        if (!removed) return sendJSON(res, 404, { error: "Scheduled post not found." });
        return sendJSON(res, 200, { ok: true });
      } catch (error) {
        return sendJSON(res, 409, { error: error.message });
      }
    }
    if (u.pathname === "/api/approvals/skip" && req.method === "POST") {
      if (!requireApprovalAuth(req, res)) return;
      const { topic, date } = await readJsonBody(req);
      if (!topic || !date) return sendJSON(res, 400, { error: "missing topic/date" });
      const post = pendingApprovals().find((item) => item.topic === topic && item.date === date);
      if (!post) return sendJSON(res, 409, { error: "This post is no longer pending approval." });
      appendPostLog(ROOT, { topic, date, status: "skipped", at: new Date().toISOString() });
      return sendJSON(res, 200, { ok: true });
    }
    // Static chart assets (png/html/csv/txt) generated into social/ by the topic scripts.
    if (u.pathname.startsWith("/social/")) {
      const rel = decodeURIComponent(u.pathname.slice("/social/".length));
      if (!rel || rel.includes("..") || rel.includes("/") || rel.includes("\\")) return res.writeHead(400).end("Bad path");
      const file = join(SOCIAL, rel);
      if (!existsSync(file)) return res.writeHead(404).end("Not found");
      const type = ASSET_TYPE[extname(file).slice(1)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=300" });
      return res.end(await readFile(file));
    }
    res.writeHead(404).end("Not found");
  } catch (err) {
    sendJSON(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Dashboard running -> http://${HOST}:${PORT}\n`);
  setTimeout(() => publishDueSchedule().catch((error) => console.error(error)), 2_000);
});

setInterval(() => publishDueSchedule().catch((error) => console.error(error)), 30_000).unref();
