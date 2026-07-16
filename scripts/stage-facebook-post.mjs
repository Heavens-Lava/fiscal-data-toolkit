#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPendingApprovals, stageApproval, unstageApproval } from "./lib/approval-queue.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const command = process.argv[2] || "list";
try {
  if (command === "list") {
    const posts = listPendingApprovals(ROOT, SOCIAL);
    console.table(posts.map((post) => ({ topic: post.topic, date: post.date, status: post.status, score: post.score })));
  } else if (command === "stage") {
    const topic = process.argv[3];
    const date = argValue("--date");
    if (!topic || !date) throw new Error("Usage: node scripts/stage-facebook-post.mjs stage <topic> --date YYYY-MM-DD");
    const post = stageApproval(ROOT, SOCIAL, topic, date);
    console.log(`Staged ${post.topic}-${post.date} for web approval.`);
  } else if (command === "remove") {
    const topic = process.argv[3];
    const date = argValue("--date");
    if (!topic || !date) throw new Error("Usage: node scripts/stage-facebook-post.mjs remove <topic> --date YYYY-MM-DD");
    console.log(unstageApproval(ROOT, topic, date) ? "Removed from approval queue." : "Post was not staged.");
  } else {
    throw new Error("Commands: list, stage <topic> --date YYYY-MM-DD, remove <topic> --date YYYY-MM-DD");
  }
} catch (error) {
  console.error(`Staging error: ${error.message}`);
  process.exit(1);
}
