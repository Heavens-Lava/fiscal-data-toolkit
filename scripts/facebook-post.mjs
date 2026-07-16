#!/usr/bin/env node
// facebook-post.mjs - publish a generated social/ post to the Facebook Page.
// Reads the {topic}-{date}.txt caption plus a {topic}-{date}.png (default)
// or .mp4 from social/ and publishes them
// to the Page via the Graph API.
//
// Safety: dry-run by default (prints what would be posted, calls nothing).
// Pass --live to actually publish.
//
// Run:  node scripts/facebook-post.mjs az-vs-us-income
//       node scripts/facebook-post.mjs az-vs-us-income --date 2026-07-08
//       node scripts/facebook-post.mjs az-vs-us-income --media video --live

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractCaption } from "./lib/social-posts.mjs";
import { publishPost } from "./lib/facebook.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function localDateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const topic = process.argv[2];
if (!topic || topic.startsWith("--")) {
  console.error("Usage: node scripts/facebook-post.mjs <topic> [--date YYYY-MM-DD] [--live]");
  process.exit(1);
}

const date = argValue("--date", localDateStamp());
const live = process.argv.includes("--live");
const media = argValue("--media", "image");

const base = path.join(SOCIAL, `${topic}-${date}`);
const txtFile = `${base}.txt`;
const pngFile = `${base}.png`;
const mp4File = `${base}.mp4`;

if (!existsSync(txtFile)) {
  console.error(`Missing caption file: ${path.relative(ROOT, txtFile)}`);
  process.exit(1);
}
const caption = extractCaption(readFileSync(txtFile, "utf8"));
const hasVideo = existsSync(mp4File);
const hasImage = existsSync(pngFile);

console.log(`Topic:   ${topic}`);
console.log(`Date:    ${date}`);
console.log(`Caption: ${path.relative(ROOT, txtFile)} (${caption.length} chars)`);
console.log(`Media:   ${media}`);
console.log(`Image:   ${hasImage ? path.relative(ROOT, pngFile) : "(none)"}`);
console.log(`Video:   ${hasVideo ? path.relative(ROOT, mp4File) : "(none)"}`);
console.log("---");
console.log(caption);
console.log("---");

if (!live) {
  console.log("\nDRY RUN — nothing was posted. Re-run with --live to publish for real.");
  process.exit(0);
}

try {
  const result = await publishPost({ root: ROOT, social: SOCIAL, topic, date, mediaPreference: media });
  console.log("\nPublished.", result.response);
} catch (e) {
  console.error(`\nFacebook API error: ${e.message}`);
  process.exit(1);
}
