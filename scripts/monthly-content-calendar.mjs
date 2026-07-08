#!/usr/bin/env node
// Plan a simple 1-2 posts/week monthly publishing calendar.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

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

const LABELS = {
  jobs: "Jobs report check",
  inflation: "Inflation check",
  debt: "National debt check",
  hires: "Hires vs layoffs",
  mortgage: "Mortgage payment check",
  "household-debt": "Household debt check",
  "tax-dollar": "Where a federal dollar goes",
  "gas-az": "Arizona gas check",
  "debt-holders-real-estate": "Who holds real-estate loans",
  trade: "Trading partner check",
};

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function monthDefault() {
  return new Date().toISOString().slice(0, 7);
}

function parseTopics() {
  const raw = argValue("--topics");
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_TOPICS;
}

function monthDates(month) {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(year, m - 1, 1));
  const out = [];
  while (d.getUTCMonth() === m - 1) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function pickPostingDates(month, count) {
  const days = monthDates(month);
  const preferred = days.filter((iso) => {
    const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return dow === 2 || dow === 4; // Tue, Thu
  });
  return preferred.slice(0, count);
}

function monthLabel(month) {
  const [year, m] = month.split("-");
  return new Date(Date.UTC(Number(year), Number(m) - 1, 1))
    .toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

const month = argValue("--month", monthDefault());
const perWeek = Math.max(1, Math.min(2, Number(argValue("--per-week", "2")) || 2));
const topics = parseTopics();
const postCount = Math.min(topics.length, perWeek * 4);
const dates = pickPostingDates(month, postCount);
const outMd = path.join(SOCIAL, `content-calendar-${month}.md`);
const outJson = path.join(SOCIAL, `content-calendar-${month}.json`);

mkdirSync(SOCIAL, { recursive: true });

const posts = topics.slice(0, dates.length).map((topic, i) => ({
  date: dates[i],
  topic,
  label: LABELS[topic] || topic,
  command: `node scripts/weekly-digest.mjs --topic ${topic} --table`,
}));

const lines = [
  `# Content Calendar - ${monthLabel(month)}`,
  "",
  `Cadence: ${perWeek} post${perWeek === 1 ? "" : "s"} per week`,
  "",
  "## Schedule",
  "",
];

for (const post of posts) {
  lines.push(`- [ ] ${post.date}: ${post.label}`);
  lines.push(`  Topic: ${post.topic}`);
  lines.push(`  Command: \`${post.command}\``);
  lines.push("");
}

lines.push("## Monthly Packet", "");
lines.push("```bash");
lines.push(`node scripts/monthly-briefs.mjs --month ${month} --topics ${topics.join(",")}`);
lines.push("```");
lines.push("");

writeFileSync(outMd, lines.join("\n"));
writeFileSync(outJson, JSON.stringify({ month, perWeek, posts }, null, 2) + "\n");

console.log(`Calendar ready: ${rel(outMd)}`);
console.log(`JSON: ${rel(outJson)}`);
if (!existsSync(path.join(SOCIAL, `monthly-brief-${month}`))) {
  console.log(`Tip: run node scripts/monthly-briefs.mjs --month ${month} to build the assets.`);
}
