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

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (u.pathname === "/" || u.pathname === "/index.html") {
      const html = await readFile(join(ROOT, "public", "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(html);
    }
    if (u.pathname === "/api/dashboard") {
      const [f, t, m, b] = await Promise.all([fiscal(), trade(), money(), banking()]);
      return sendJSON(res, 200, { fiscal: f, trade: t, money: m, banking: b });
    }
    if (u.pathname === "/api/stock") {
      const ticker = (u.searchParams.get("ticker") || "").trim();
      if (!ticker) return sendJSON(res, 400, { error: "missing ?ticker=" });
      return sendJSON(res, 200, await stock(ticker));
    }
    res.writeHead(404).end("Not found");
  } catch (err) {
    sendJSON(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`\n  Dashboard running →  http://localhost:${PORT}\n`));
