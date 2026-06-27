#!/usr/bin/env node
// server.mjs — tiny zero-dependency web server for the dashboard frontend.
// Serves the static page and JSON endpoints that call the gov APIs server-side
// (so the browser never hits CORS / User-Agent walls).
//
// Run:  npm run web   (or: node server.mjs)   then open http://localhost:3000

import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fiscal, trade, money, banking, stock } from "./lib/data.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

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
    if (u.pathname === "/api/dashboard") {
      // Each domain cached + settled independently → fast and fault-tolerant.
      const [f, t, m, b] = await Promise.all([
        settled("fiscal", () => cached("fiscal", TEN_MIN, fiscal)),
        settled("trade", () => cached("trade", TEN_MIN, trade)),
        settled("money", () => cached("money", TEN_MIN, money)),
        settled("banking", () => cached("banking", TEN_MIN, banking)),
      ]);
      return sendJSON(res, 200, { fiscal: f, trade: t, money: m, banking: b });
    }
    if (u.pathname === "/api/stock") {
      const ticker = (u.searchParams.get("ticker") || "").trim().toUpperCase();
      if (!ticker) return sendJSON(res, 400, { error: "missing ?ticker=" });
      return sendJSON(res, 200, await cached(`stock:${ticker}`, TEN_MIN, () => stock(ticker)));
    }
    res.writeHead(404).end("Not found");
  } catch (err) {
    sendJSON(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`\n  Dashboard running →  http://localhost:${PORT}\n`));
