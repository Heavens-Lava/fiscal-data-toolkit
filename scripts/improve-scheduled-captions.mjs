#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  updateFacebookScheduledPostCaption,
  updateFacebookScheduledVideoCaption,
} from "./lib/facebook.mjs";
import { extractCaption, prepareFacebookCaption } from "./lib/social-posts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const QUEUE = path.join(SOCIAL, "_state", "scheduled-posts.json");
const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = limitArg ? Math.max(1, Number(limitArg.split("=")[1])) : Infinity;

function topicHook(topic, caption) {
  const first = caption.split(/\r?\n/).find((line) => line.trim())?.trim() || "";
  if (/^Not every major treaty gets ratified\b/i.test(first)) return null;
  if (/state-(soybeans|cotton|cattle|hogs|dairy|corn|wheat|chickens|eggs)/.test(topic) && /\$|\bworth\b/i.test(first)) return null;
  const rules = [
    [/congress-closest/, "Sometimes an entire federal law comes down to one vote. In four of the last ten years, it did."],
    [/patents-by-company/, "The race to invent the future has a leaderboard, and it is not especially close."],
    [/business-formation-by-industry/, "The startup boom is not happening everywhere at once. A few industries are attracting far more new businesses."],
    [/business-formation/, "New businesses are not appearing evenly across America. Some states are pulling far ahead."],
    [/young-adult-migration/, "Young adults are voting with moving boxes, and some states are winning far more of them than others."],
    [/salary-buying-power/, "The same salary can buy two very different lives depending on the state."],
    [/income-after-rent/, "A paycheck can look strong until the rent is taken out."],
    [/household-cost-basket/, "Four basic bills can cost more than $29,000 a year in one state and less than $12,000 in another."],
    [/household-cost-rent/, "Rent is one bill, but it can redraw an entire household budget."],
    [/household-cost-utilities/, "Keeping the lights and heat on costs far more in some states than others."],
    [/household-cost-auto-insurance/, "The same driver can face a very different insurance bill after crossing a state line."],
    [/homeowner-monthly-cost/, "A mortgage payment is only part of what owning a home costs each month."],
    [/family-cost/, "Rent, childcare, and utilities can consume most of a typical household income in the highest-cost states."],
    [/retirement-readiness/, "Retirement pressure is not evenly distributed across America."],
    [/property-tax/, "The same-priced home can produce a very different tax bill depending on the state."],
    [/health-insurance/, "Health insurance can take a very different bite out of a family's budget depending on the state."],
    [/job-openings/, "The job market feels very different when there are several workers competing for every opening."],
    [/civil-rights|13th-amendment|14th-amendment|15th-amendment|voting-rights|fair-housing/, "Rights that feel settled today were once decided one roll-call vote at a time."],
    [/treaty|salt-ii|arms-control/, "Nuclear arms control sounds abstract until it comes down to senators voting yea or nay."],
    [/crime-clearance/, "Counting reported crimes is one thing. Clearing the cases is another."],
    [/violent-crime-rate|property-crime-rate/, "Crossing a state line can mean a very different reported crime rate."],
    [/cybercrime-losses-per-complaint/, "A cybercrime complaint does not always mean a small loss. In some states, the average is staggering."],
    [/cybercrime-losses/, "Internet crime is now measured in billions of dollars, and the losses are concentrated in a handful of states."],
    [/state-map-population/, "America's population is far more concentrated than the map's physical size suggests."],
    [/state-map-income/, "Where you live changes what a typical household earns before the bills even begin."],
    [/state-map-home-value/, "A state line can separate two very different housing markets."],
    [/state-gdp-growth/, "State economies are not moving at the same speed."],
    [/state-gdp/, "A surprisingly small group of states produces a huge share of the U.S. economy."],
    [/national-debt/, "The U.S. national debt did not climb in a straight line, but the long-term direction is unmistakable."],
    [/inflation-timeline/, "Prices rarely move in a straight line. This timeline shows when inflation accelerated and cooled."],
    [/us-population-timeline/, "The United States has added more than 150 million people since 1960."],
    [/state-(soybeans|cotton|cattle|hogs|dairy|corn|wheat|chickens|eggs)/, "America's food supply has a state-by-state leaderboard that most grocery shoppers never see."],
  ];
  const match = rules.find(([pattern]) => pattern.test(topic));
  if (!match) return null;
  return first === match[1] ? null : match[1];
}

function compactRanking(caption) {
  const lines = caption.split(/\r?\n/);
  const ranked = lines.map((line, index) => ({ line, index, m: line.match(/^#(\d+)\s+/) })).filter((row) => row.m);
  if (ranked.length < 12) return caption;

  const keep = new Set();
  ranked.slice(0, 5).forEach((row) => keep.add(row.index));
  ranked.slice(-3).forEach((row) => keep.add(row.index));
  ranked.filter((row) => /\bArizona\b/i.test(row.line)).forEach((row) => keep.add(row.index));

  const out = [];
  let omitted = false;
  lines.forEach((line, index) => {
    const isRanked = /^#\d+\s+/.test(line);
    if (!isRanked || keep.has(index)) {
      if (omitted && line.trim()) out.push("...");
      omitted = false;
      out.push(line);
    } else {
      omitted = true;
    }
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function compactTimeline(caption) {
  const lines = caption.split(/\r?\n/);
  const years = lines.map((line, index) => ({ line, index, m: line.match(/^((?:19|20)\d{2})\s*\|/) })).filter((row) => row.m);
  if (years.length < 16) return caption;
  const lastYear = Number(years.at(-1).m[1]);
  const keep = new Set(years.filter((row, index) => {
    const year = Number(row.m[1]);
    return index === 0 || index === years.length - 1 || year % 10 === 0 || year >= lastYear - 2;
  }).map((row) => row.index));
  const out = [];
  let omitted = false;
  lines.forEach((line, index) => {
    const isYear = /^(?:19|20)\d{2}\s*\|/.test(line);
    if (!isYear || keep.has(index)) {
      if (omitted && line.trim()) out.push("...");
      omitted = false;
      out.push(line);
    } else {
      omitted = true;
    }
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function improve(topic, raw) {
  const original = prepareFacebookCaption(raw);
  let caption = compactTimeline(compactRanking(original));
  const hook = topicHook(topic, caption);
  if (hook) caption = `${hook}\n\n${caption}`;
  return { original, caption: caption.trim() };
}

function urls(text) {
  return new Set((text.match(/https?:\/\/[^\s)\]]+/g) || []).map((url) => url.replace(/[.,;]+$/, "")));
}

function withCaption(raw, caption) {
  const marker = /^Facebook post\r?\n-{3,}\r?\n/m;
  const m = raw.match(marker);
  return m ? `${raw.slice(0, m.index)}Facebook post\n-------------\n${caption}\n` : `${caption}\n`;
}

if (!existsSync(QUEUE)) throw new Error(`Missing schedule: ${QUEUE}`);
const now = Date.now();
const all = JSON.parse(readFileSync(QUEUE, "utf8"));
const items = all.filter((item) => item.status === "scheduled" && item.facebookPostId && new Date(item.scheduledAt).getTime() > now)
  .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)).slice(0, LIMIT);

const changes = [];
for (const item of items) {
  const file = path.join(SOCIAL, `${item.topic}-${item.date}.txt`);
  if (!existsSync(file)) throw new Error(`Missing caption file for scheduled post: ${path.relative(ROOT, file)}`);
  const raw = readFileSync(file, "utf8");
  const result = improve(item.topic, raw);
  const missingUrls = [...urls(result.original)].filter((url) => !urls(result.caption).has(url));
  if (missingUrls.length) throw new Error(`${item.topic} lost source URL(s): ${missingUrls.join(", ")}`);
  if (result.caption !== result.original) changes.push({ ...item, file, raw, ...result });
}

const preview = [
  "# Scheduled Caption Improvement Preview", "",
  `Generated: ${new Date().toISOString()}`, `Mode: ${APPLY ? "apply" : "dry run"}`,
  `Future scheduled posts checked: ${items.length}`, `Captions changed: ${changes.length}`, "",
  ...changes.flatMap((item) => [
    `## ${item.topic} (${item.scheduledAt})`, "",
    `Before: ${item.original.split(/\r?\n/).find((line) => line.trim())}`, `After: ${item.caption.split(/\r?\n/).find((line) => line.trim())}`,
    `Lines: ${item.original.split(/\r?\n/).length} -> ${item.caption.split(/\r?\n/).length}`, "",
    "```text", item.caption, "```", "",
  ]),
];
mkdirSync(path.join(ROOT, ".cache"), { recursive: true });
const previewFile = path.join(ROOT, ".cache", "scheduled-caption-preview.md");
writeFileSync(previewFile, preview.join("\n"));

if (!APPLY) {
  console.log(`Dry run: ${changes.length} of ${items.length} future captions would change.`);
  console.log(`Preview: ${path.relative(ROOT, previewFile)}`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(ROOT, ".cache", "scheduled-caption-backups", stamp);
mkdirSync(backupDir, { recursive: true });
writeFileSync(path.join(backupDir, "captions.json"), JSON.stringify(changes.map((item) => ({
  topic: item.topic, date: item.date, scheduledAt: item.scheduledAt, facebookPostId: item.facebookPostId,
  facebookMediaId: item.facebookMediaId, media: item.media, file: path.relative(ROOT, item.file), raw: item.raw,
})), null, 2));

let completed = 0;
for (const item of changes) {
  if (item.media === "video") {
    await updateFacebookScheduledVideoCaption({ root: ROOT, videoId: item.facebookMediaId || item.facebookPostId, description: item.caption });
  } else {
    await updateFacebookScheduledPostCaption({ root: ROOT, postId: item.facebookPostId, message: item.caption });
  }
  writeFileSync(item.file, withCaption(item.raw, item.caption));
  completed += 1;
  console.log(`[${completed}/${changes.length}] Updated ${item.topic}`);
}
console.log(`Updated ${completed} scheduled Facebook captions. Backup: ${path.relative(ROOT, backupDir)}`);
