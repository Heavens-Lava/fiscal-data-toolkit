#!/usr/bin/env node
// Check generated social posts for the files and metadata needed before posting.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scorePostQuality } from "./lib/post-quality.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const OUT_MD = path.join(SOCIAL, "post-readiness-report.md");
const OUT_JSON = path.join(SOCIAL, "post-readiness-report.json");

const REQUIRED = ["txt", "csv"];
const NICE_TO_HAVE = ["html", "png"];

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
  const fileName = path.basename(file);
  const portrait = fileName.match(/^(.+)-(\d{4}-\d{2}-\d{2})\.portrait\.png$/);
  if (portrait) {
    return { file, ext: "portrait", topic: portrait[1], date: portrait[2], size: statSync(file).size };
  }
  const ext = path.extname(file).slice(1).toLowerCase();
  const base = path.basename(file, `.${ext}`);
  const m = base.match(/^(.+)-(\d{4}-\d{2}-\d{2})$/);
  return {
    file,
    ext,
    topic: m ? m[1] : base,
    date: m ? m[2] : "",
    size: statSync(file).size,
  };
}

function textFor(files) {
  const txt = files.find((f) => f.ext === "txt");
  if (!txt || !existsSync(txt.file)) return "";
  return readFileSync(txt.file, "utf8");
}

function firstMeaningfulLine(text) {
  return text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
}

function checkPost(post) {
  const exts = new Set(post.files.map((f) => f.ext));
  const text = textFor(post.files);
  const problems = [];
  const warnings = [];

  for (const ext of REQUIRED) {
    if (!exts.has(ext)) problems.push(`missing .${ext}`);
  }
  for (const ext of NICE_TO_HAVE) {
    if (!exts.has(ext)) warnings.push(`no .${ext}`);
  }
  if (!post.date) problems.push("no YYYY-MM-DD in filename");
  if (!firstMeaningfulLine(text)) problems.push("caption/post text is empty");
  if (text && !/\bSource(s)?:|real source/i.test(text)) problems.push("missing source line");
  if (text && !/\d{4}(-\d{2}(-\d{2})?)?/.test(text)) warnings.push("no visible date/vintage in text");
  if (text && /\b(index|CPI)\b/i.test(text) && !/\bNote:|\bcaveat\b/i.test(text)) {
    warnings.push("index-style post may need a plain-English note");
  }

  const score = Math.max(0, 100 - problems.length * 25 - warnings.length * 8);
  const quality = scorePostQuality({
    caption: text,
    files: Object.fromEntries(post.files.map((file) => [file.ext, file.file])),
  });
  return {
    ...post,
    score: quality.score,
    readinessScore: score,
    quality,
    status: problems.length ? "needs work" : warnings.length ? "ready with notes" : "ready",
    problems,
    warnings,
    caption: firstMeaningfulLine(text),
  };
}

mkdirSync(SOCIAL, { recursive: true });

const assets = walk(SOCIAL)
  .filter((file) => /\.(png|html|txt|csv)$/i.test(file))
  .map(parseAsset);

const groups = new Map();
for (const asset of assets) {
  const key = `${asset.date || "undated"}|${asset.topic}`;
  if (!groups.has(key)) groups.set(key, { topic: asset.topic, date: asset.date, files: [] });
  groups.get(key).files.push(asset);
}

const posts = [...groups.values()]
  .map(checkPost)
  .sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.topic.localeCompare(b.topic));

const ready = posts.filter((p) => p.status === "ready").length;
const needsWork = posts.filter((p) => p.status === "needs work").length;

const lines = [
  "# Post Readiness Report",
  "",
  `Generated: ${new Date().toLocaleString("en-US")}`,
  `Posts checked: ${posts.length}`,
  `Ready: ${ready}`,
  `Needs work: ${needsWork}`,
  "",
  "## Posts",
  "",
  "Date | Topic | Quality | Readiness | Status | Notes",
  "---|---|---:|---:|---|---",
  ...posts.map((p) => {
    const notes = [...p.problems, ...p.warnings, ...p.quality.suggestions].join("; ") || "ok";
    return `${p.date || "undated"} | ${p.topic} | ${p.score} | ${p.readinessScore} | ${p.status} | ${notes}`;
  }),
  "",
];

writeFileSync(OUT_MD, lines.join("\n"));
writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), posts }, null, 2) + "\n");

console.log(`Checked ${posts.length} posts: ${ready} ready, ${needsWork} need work.`);
console.log(`Markdown: ${rel(OUT_MD)}`);
console.log(`JSON: ${rel(OUT_JSON)}`);
