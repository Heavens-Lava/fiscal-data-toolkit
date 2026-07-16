#!/usr/bin/env node
// Surface upcoming holidays and which of our topics are thematically
// relevant, with the suggested lead time (days before the holiday) to post.
// Purely informational — it doesn't stage or schedule anything itself; use
// stage-facebook-post.mjs / the dashboard's schedule picker for the
// suggested date once you've regenerated fresh data for that topic.
//
// Run:  node scripts/holiday-content-planner.mjs                (next 60 days)
//       node scripts/holiday-content-planner.mjs --days 120

import path from "node:path";
import { fileURLToPath } from "node:url";
import { usHolidays, HOLIDAY_TOPICS } from "./lib/holidays.mjs";

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const lookaheadDays = Number(argValue("--days", "60"));
const now = new Date();
const horizon = new Date(now.getTime() + lookaheadDays * 86_400_000);

const years = [now.getUTCFullYear(), now.getUTCFullYear() + 1];
const holidays = years.flatMap((y) => usHolidays(y))
  .filter((h) => {
    const d = new Date(`${h.date}T00:00:00Z`);
    return d >= now && d <= horizon;
  })
  .sort((a, b) => a.date.localeCompare(b.date));

if (!holidays.length) {
  console.log(`No holidays in the next ${lookaheadDays} days.`);
  process.exit(0);
}

console.log(`Holidays in the next ${lookaheadDays} days, with suggested post dates:\n`);
for (const h of holidays) {
  const topics = HOLIDAY_TOPICS[h.name];
  console.log(`${h.date}  ${h.name}`);
  if (!topics?.length) {
    console.log(`  (no tagged topics for this one yet — add to HOLIDAY_TOPICS in lib/holidays.mjs if relevant)`);
    continue;
  }
  for (const t of topics) {
    const postDate = new Date(`${h.date}T00:00:00Z`);
    postDate.setUTCDate(postDate.getUTCDate() - t.daysBefore);
    const when = t.daysBefore === 0 ? "on the day" : `${t.daysBefore} day(s) before`;
    console.log(`  ${postDate.toISOString().slice(0, 10)} (${when}) — ${t.topic}${t.note ? `: ${t.note}` : ""}`);
  }
  console.log("");
}
