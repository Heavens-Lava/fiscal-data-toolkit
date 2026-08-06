#!/usr/bin/env node
// Create a branded 4:5 Facebook feed image from an existing social chart.
//
// Run:
//   node scripts/make-post-portrait.mjs salary-buying-power-70000 --date 2026-07-13

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { screenshot } from "./lib/chart-kit.mjs";
import {
  extractCaption,
  prepareFacebookCaption,
  sourceWebsiteFor,
} from "./lib/social-posts.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const WORK = path.join(SOCIAL, "_variants");

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function localDateStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanLine(value) {
  return String(value || "")
    .replace(/^[#>*\s]+/, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function summaryLine(caption, headline) {
  const lines = extractCaption(caption).split(/\r?\n/).map(cleanLine).filter(Boolean);
  const candidate = lines.find((line) =>
    line !== headline
    && line.length >= 35
    && line.length <= 220
    && !line.includes("|")
    && !/^(?:Source|Data |Information retrieved|Graph|Chart|#?\d+\s)/i.test(line)
  );
  return candidate || "Official data, translated into one clear comparison.";
}

function hostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Official public data";
  }
}

const topic = process.argv[2];
if (!topic || topic.startsWith("--")) {
  console.error("Usage: node scripts/make-post-portrait.mjs <topic> [--date YYYY-MM-DD] [--force]");
  process.exit(1);
}

const date = argValue("--date", localDateStamp());
const force = process.argv.includes("--force");
const base = path.join(SOCIAL, `${topic}-${date}`);
const sourceImage = `${base}.png`;
const captionFile = `${base}.txt`;
const output = `${base}.portrait.png`;

if (!existsSync(sourceImage)) throw new Error(`Missing chart image: ${path.basename(sourceImage)}`);
if (!existsSync(captionFile)) throw new Error(`Missing caption: ${path.basename(captionFile)}`);
if (existsSync(output) && !force) {
  console.log(`Portrait already exists: ${path.relative(ROOT, output)}`);
  process.exit(0);
}

const raw = readFileSync(captionFile, "utf8");
const caption = prepareFacebookCaption(raw);
const headline = cleanLine(extractCaption(raw).split(/\r?\n/).find((line) => line.trim()) || topic);
const summary = summaryLine(raw, headline);
const sourceUrl = sourceWebsiteFor(raw);
const imageData = readFileSync(sourceImage).toString("base64");
const sourceLabel = hostname(sourceUrl);
const headlineClass = headline.length > 82 ? "long" : headline.length > 56 ? "medium" : "";

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1080,height=1350">
<style>
  * { box-sizing: border-box; }
  html, body { width: 1080px; height: 1350px; margin: 0; overflow: hidden; }
  body {
    background: #f7f7f3;
    color: #111214;
    font-family: Inter, "Segoe UI", Arial, sans-serif;
    letter-spacing: 0;
  }
  main {
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-rows: 86px 250px 1fr 184px;
  }
  header {
    padding: 30px 54px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #d9d9d2;
  }
  .brand { font-size: 22px; font-weight: 800; text-transform: uppercase; }
  .edition { color: #5f625f; font-size: 17px; font-weight: 650; }
  .headline {
    padding: 34px 54px 24px;
    display: flex;
    align-items: center;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 59px;
    line-height: 1.04;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .headline.medium { font-size: 51px; }
  .headline.long { font-size: 43px; }
  .visual {
    margin: 0 42px;
    min-height: 0;
    background: #ffffff;
    border: 1px solid #d9d9d2;
    border-top: 8px solid #127f78;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .visual img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  footer {
    margin-top: 24px;
    padding: 20px 54px 28px;
    background: #112d32;
    color: #ffffff;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 30px;
    align-items: center;
  }
  .summary { font-size: 22px; line-height: 1.32; font-weight: 600; }
  .credit { text-align: right; color: #c9dcda; font-size: 15px; line-height: 1.45; }
</style>
</head>
<body>
<main>
  <header>
    <div class="brand">America by the Numbers</div>
    <div class="edition">Data brief · ${escapeHtml(date)}</div>
  </header>
  <div class="headline ${headlineClass}">${escapeHtml(headline)}</div>
  <div class="visual"><img src="data:image/png;base64,${imageData}" alt=""></div>
  <footer>
    <div class="summary">${escapeHtml(summary)}</div>
    <div class="credit">Source: ${escapeHtml(sourceLabel)}<br>Chart by Jeffrey Macy</div>
  </footer>
</main>
</body>
</html>`;

mkdirSync(WORK, { recursive: true });
const htmlFile = path.join(WORK, `${topic}-${date}.portrait.html`);
writeFileSync(htmlFile, html);
const wrote = screenshot(htmlFile, output, { width: 1080, height: 1350 });
rmSync(htmlFile, { force: true });
if (!wrote) throw new Error("The browser could not render the portrait image.");

console.log(`Portrait: ${path.relative(ROOT, output)}`);
console.log(`Caption words: ${caption.split(/\s+/).filter(Boolean).length}`);
