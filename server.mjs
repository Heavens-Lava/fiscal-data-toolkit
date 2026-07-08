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

const DEFAULT_WATCHLIST = ["NVDA", "AMD", "MU", "PLTR", "RBLX", "MSFT", "META", "GOOGL", "AMZN", "INTC", "DELL", "AVGO"];

const ROOT = dirname(fileURLToPath(import.meta.url));
const SOCIAL = join(ROOT, "social");
const PORT = process.env.PORT || 3000;
const ASSET_TYPE = { png: "image/png", html: "text/html", csv: "text/csv", txt: "text/plain" };
const PUBLIC_ASSETS = { "/styles.css": "text/css", "/app.js": "text/javascript" };

const sendJSON = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json" });
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

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (u.pathname === "/" || u.pathname === "/index.html") {
      const html = await readFile(join(ROOT, "public", "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(html);
    }
    if (PUBLIC_ASSETS[u.pathname]) {
      const data = await readFile(join(ROOT, "public", u.pathname));
      res.writeHead(200, { "Content-Type": PUBLIC_ASSETS[u.pathname] });
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

server.listen(PORT, () => console.log(`\n  Dashboard running →  http://localhost:${PORT}\n`));
