#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPendingApprovals, stageApproval } from "./lib/approval-queue.mjs";
import { listSocialPosts } from "./lib/social-posts.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const PLAN_FILE = path.join(ROOT, "social-autopilot.json");
const STATE_FILE = path.join(SOCIAL, "_state", "autonomous-social-state.json");
const dryRun = process.argv.includes("--dry-run");
const maxPending = Math.max(1, Number(process.env.SOCIAL_MAX_PENDING || 6));

function loadState() {
  if (!existsSync(STATE_FILE)) return { nextIndex: 0 };
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return { nextIndex: 0 }; }
}

function saveState(state) {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

const plan = JSON.parse(readFileSync(PLAN_FILE, "utf8"));
if (!Array.isArray(plan) || !plan.length) throw new Error("social-autopilot.json must contain at least one job.");
const pending = listPendingApprovals(ROOT, SOCIAL);
if (pending.length >= maxPending) {
  console.log(`No post generated: ${pending.length} posts are already waiting for web approval (limit ${maxPending}).`);
  process.exit(0);
}

const state = loadState();
const index = Number(state.nextIndex || 0) % plan.length;
const job = plan[index];
console.log(`Next social job: ${job.name} (${job.topic})`);
console.log(`Command: ${job.command.join(" ")}`);
if (dryRun) process.exit(0);

const [bin, ...args] = job.command;
const result = spawnSync(bin, args, { cwd: ROOT, env: process.env, stdio: "inherit", shell: false });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const generated = listSocialPosts(SOCIAL).filter((post) => post.topic === job.topic).sort((a, b) => b.date.localeCompare(a.date))[0];
if (!generated) throw new Error(`Generator completed, but no ${job.topic}-YYYY-MM-DD post was found.`);
stageApproval(ROOT, SOCIAL, generated.topic, generated.date, "scheduler");
saveState({
  nextIndex: (index + 1) % plan.length,
  lastRunAt: new Date().toISOString(),
  lastTopic: generated.topic,
  lastDate: generated.date,
});
console.log(`Staged ${generated.topic}-${generated.date} for approval at http://127.0.0.1:3000/#approvals`);
