#!/usr/bin/env node
// Build a monthly publishing packet from weekly-digest topics.
//
// Output:
//   social/monthly-brief-YYYY-MM/
//     brief.md
//     manifest.json
//     <topic>-YYYY-MM-DD.{png,html,txt,csv}

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL_DIR = path.join(ROOT, "social");

const DEFAULT_TOPICS = [
  "jobs",
  "inflation",
  "debt",
  "hires",
  "mortgage",
  "household-debt",
  "tax-dollar",
  "gas-az",
];

const TOPIC_LABELS = {
  jobs: "Jobs",
  inflation: "Inflation",
  debt: "Federal Debt",
  hires: "Hiring vs Layoffs",
  mortgage: "Mortgage Payment",
  "household-debt": "Household Debt",
  "tax-dollar": "Federal Spending Dollar",
  "gas-az": "Phoenix Gas",
  gas: "US Gas",
  banks: "Bank Failures",
  border: "Border Encounters",
  "debt-holders": "Credit-Card Loan Holders",
  "debt-holders-consumer": "Consumer Loan Holders",
  "debt-holders-real-estate": "Real-Estate Loan Holders",
  trade: "Trade Partners",
};

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function monthLabel(month) {
  const [year, m] = month.split("-");
  return new Date(Date.UTC(Number(year), Number(m) - 1, 1))
    .toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function parseTopics() {
  const raw = argValue("--topics");
  if (!raw) return DEFAULT_TOPICS;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function listGeneratedFiles(topic, stamp) {
  const prefix = `${topic}-${stamp}.`;
  if (!existsSync(SOCIAL_DIR)) return [];
  return readdirSync(SOCIAL_DIR)
    .filter((name) => name.startsWith(prefix))
    .map((name) => path.join(SOCIAL_DIR, name))
    .filter((file) => statSync(file).isFile());
}

function copyTopicFiles(files, outDir) {
  return files.map((src) => {
    const dest = path.join(outDir, path.basename(src));
    copyFileSync(src, dest);
    return dest;
  });
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function readCaption(files) {
  const txt = files.find((file) => file.endsWith(".txt"));
  return txt ? readFileSync(txt, "utf8").trim() : "";
}

function buildDigest(topic, stamp, options) {
  const args = ["scripts/weekly-digest.mjs", "--topic", topic, "--table"];
  if (options.noImage) args.push("--no-image");
  if (options.years) args.push("--years", String(options.years));

  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    files: listGeneratedFiles(topic, stamp),
  };
}

function briefMarkdown({ month, outDir, posts, failures, noImage }) {
  const lines = [
    `# Monthly Brief - ${monthLabel(month)}`,
    "",
    `Generated: ${new Date().toLocaleString("en-US")}`,
    `Mode: ${noImage ? "captions + tables only" : "captions + tables + images"}`,
    "",
    "## Posting Checklist",
    "",
  ];

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const png = post.files.find((file) => file.endsWith(".png"));
    const txt = post.files.find((file) => file.endsWith(".txt"));
    lines.push(`- [ ] Post ${i + 1}: ${post.label} (${post.topic})`);
    if (png) lines.push(`  Image: ${rel(png)}`);
    if (txt) lines.push(`  Caption: ${rel(txt)}`);
  }

  if (failures.length) {
    lines.push("", "## Needs Attention", "");
    for (const failure of failures) {
      lines.push(`- ${failure.topic}: ${failure.message}`);
    }
  }

  lines.push("", "## Captions", "");
  for (const post of posts) {
    lines.push(`### ${post.label}`);
    lines.push("");
    lines.push(post.caption || "_No caption file was generated._");
    lines.push("");
    lines.push("Assets:");
    for (const file of post.files) lines.push(`- ${rel(file)}`);
    lines.push("");
  }

  lines.push("## Source Commands", "");
  lines.push("```bash");
  lines.push(`node scripts/monthly-briefs.mjs --month ${month}${noImage ? " --no-image" : ""}`);
  lines.push(`node scripts/weekly-digest.mjs --topic <topic> --table${noImage ? " --no-image" : ""}`);
  lines.push("```");
  lines.push("");
  lines.push(`Folder: ${rel(outDir)}`);
  lines.push("");
  return lines.join("\n");
}

function usage() {
  console.log(`
Build a monthly packet of social posts from weekly-digest topics.

Usage:
  node scripts/monthly-briefs.mjs
  node scripts/monthly-briefs.mjs --month 2026-07
  node scripts/monthly-briefs.mjs --topics jobs,inflation,mortgage,household-debt
  node scripts/monthly-briefs.mjs --no-image

Options:
  --month YYYY-MM       Month label for the packet. Defaults to the current month.
  --topics a,b,c        Comma-separated weekly-digest topics. Defaults to 8 post-ready topics.
  --years N             Pass a lookback window through to compatible weekly-digest topics.
  --no-image            Skip PNG rendering.
  --help                Show this help.
`);
}

if (hasFlag("--help")) {
  usage();
  process.exit(0);
}

const stamp = todayISO();
const month = argValue("--month", stamp.slice(0, 7));
const topics = parseTopics();
const outDir = path.join(SOCIAL_DIR, `monthly-brief-${month}`);
const options = {
  noImage: hasFlag("--no-image"),
  years: argValue("--years"),
};

mkdirSync(outDir, { recursive: true });

const posts = [];
const failures = [];

console.log(`\nBuilding monthly brief for ${monthLabel(month)}...`);
console.log(`Topics: ${topics.join(", ")}`);

for (const topic of topics) {
  process.stdout.write(`\n- ${topic}: `);
  const result = buildDigest(topic, stamp, options);
  if (!result.ok) {
    const message = (result.stdout.match(/!\s+Skipping[^\n]+/)?.[0] || result.stderr || `exit ${result.status}`).trim();
    failures.push({ topic, message });
    console.log(`skipped (${message})`);
    continue;
  }

  if (!result.files.length) {
    failures.push({ topic, message: "weekly-digest completed, but no files were found" });
    console.log("no files found");
    continue;
  }

  const copied = copyTopicFiles(result.files, outDir);
  const post = {
    topic,
    label: TOPIC_LABELS[topic] || topic,
    files: copied,
    caption: readCaption(copied),
  };
  posts.push(post);
  console.log(`ok (${copied.length} files)`);
}

const manifest = {
  month,
  generatedAt: new Date().toISOString(),
  topics,
  posts: posts.map((post) => ({
    topic: post.topic,
    label: post.label,
    files: post.files.map(rel),
  })),
  failures,
};

writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(path.join(outDir, "brief.md"), briefMarkdown({ month, outDir, posts, failures, noImage: options.noImage }));

console.log(`\nMonthly brief ready: ${rel(outDir)}`);
console.log(`Posts built: ${posts.length}`);
if (failures.length) console.log(`Needs attention: ${failures.length}`);
console.log(`Open: ${rel(path.join(outDir, "brief.md"))}`);
