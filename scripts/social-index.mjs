#!/usr/bin/env node
// Index every generated social asset into a readable Markdown catalog.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const OUT_MD = path.join(SOCIAL, "index.md");
const OUT_JSON = path.join(SOCIAL, "index.json");

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    const st = statSync(file);
    if (st.isDirectory()) out.push(...walk(file));
    else out.push(file);
  }
  return out;
}

function parseAsset(file) {
  const ext = path.extname(file).slice(1);
  const base = path.basename(file, `.${ext}`);
  const m = base.match(/^(.+)-(\d{4}-\d{2}-\d{2})$/);
  return {
    file,
    ext,
    base,
    topic: m ? m[1] : base,
    date: m ? m[2] : "",
    size: statSync(file).size,
    modified: statSync(file).mtime.toISOString(),
  };
}

function captionPreview(txtFile) {
  if (!txtFile || !existsSync(txtFile)) return "";
  return readFileSync(txtFile, "utf8").trim().split(/\r?\n/)[0] || "";
}

mkdirSync(SOCIAL, { recursive: true });

const assets = walk(SOCIAL)
  .filter((file) => /\.(png|html|txt|csv|md|json)$/i.test(file))
  .filter((file) => !["index.md", "index.json"].includes(path.basename(file)))
  .map(parseAsset);

const groups = new Map();
for (const asset of assets) {
  const key = `${asset.date || "undated"}|${asset.topic}`;
  if (!groups.has(key)) groups.set(key, { topic: asset.topic, date: asset.date, files: [] });
  groups.get(key).files.push(asset);
}

const posts = [...groups.values()]
  .map((post) => {
    post.files.sort((a, b) => a.ext.localeCompare(b.ext));
    post.caption = captionPreview(post.files.find((f) => f.ext === "txt")?.file);
    return post;
  })
  .sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.topic.localeCompare(b.topic));

const lines = [
  "# Social Asset Index",
  "",
  `Generated: ${new Date().toLocaleString("en-US")}`,
  `Posts indexed: ${posts.length}`,
  "",
  "## Posts",
  "",
];

for (const post of posts) {
  lines.push(`### ${post.date || "Undated"} - ${post.topic}`);
  if (post.caption) lines.push("", post.caption);
  lines.push("");
  for (const file of post.files) {
    lines.push(`- ${file.ext.toUpperCase()}: ${rel(file.file)} (${Math.round(file.size / 1024)} KB)`);
  }
  lines.push("");
}

writeFileSync(OUT_MD, lines.join("\n"));
writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), posts }, null, 2) + "\n");

console.log(`Indexed ${posts.length} social posts.`);
console.log(`Markdown: ${rel(OUT_MD)}`);
console.log(`JSON: ${rel(OUT_JSON)}`);
