// promotion-priority.mjs — decide WHICH pending post gets the next open
// Facebook slot, and in what order. Two separate gates, per design:
//
//   DATA/CLAIM VALIDATION  (post-validation.mjs)
//         -> pass / review / fail
//   EDITORIAL SCORING       (post-quality.mjs's scorePostQuality, already
//                            computed by listSocialPosts/listPendingApprovals)
//         -> 0-100 human-impact/clarity/relevance/sourcing score
//         -> topic-diversity + queue-aging adjustments
//   PROMOTION PRIORITY      (this file)
//         -> the actual ordering promote-queued-posts.mjs consumes
//
// A validation "fail" is excluded outright -- never auto-promoted, no
// matter how high its editorial score. A "review" is heavily deprioritized
// (still eligible eventually, so nothing waits forever) but never jumps
// ahead of a clean "pass" post. Within each tier, ordering is by editorial
// score with a topic-diversity penalty (so four economy posts in a row
// don't all go out back-to-back) and a small aging bonus (so an older,
// slightly-lower-scored post doesn't get starved forever by a stream of
// new high scorers).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { validatePost } from "./post-validation.mjs";

// Lightweight keyword-bucket categorizer -- topics don't carry an explicit
// category, so infer one from the slug. Good enough for diversity spacing;
// doesn't need to be perfect.
const CATEGORY_RULES = [
  [/crime|robbery|burglary|larceny|assault|cybercrime/i, "crime"],
  [/housing|rent|mortgage|home-|homeowner|homevalue|home-value/i, "housing"],
  [/energy|electric|coal|nuclear|hydro|wind|solar|fuel-mix|gas-/i, "energy"],
  [/gdp|economy|business-formation|patents|export|trade|tariff|market|stock|crypto/i, "economy"],
  [/wage|salary|pay|job|labor|employment|unemployment|union/i, "labor"],
  [/tax|budget|debt|deficit|spending|treasury|contractor/i, "fiscal"],
  [/population|migration|age|household|foreign-born|marriage|family/i, "demographics"],
  [/health|mortality|life-expectancy|disability|insurance/i, "health"],
  [/world-|global-|country-|international/i, "world"],
  [/congress|vote|election|campaign|treaty/i, "government"],
  [/food|grocery|snap|agriculture|farm|turkey|honey/i, "food"],
];
export function categoryFor(topic) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(topic)) return cat;
  return "other";
}

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

// Attach { validation, category } to each pending-approval entry (as
// returned by listPendingApprovals, which already carries topic/date/score).
export function annotatePending(root, socialDir, pending) {
  return pending.map((post) => {
    const base = path.join(socialDir, `${post.topic}-${post.date}`);
    const txt = readIfExists(`${base}.txt`);
    const csv = readIfExists(`${base}.csv`);
    const html = readIfExists(`${base}.html`);
    const validation = txt !== null
      ? validatePost({ txt, csv, html, stampDate: post.date })
      : { verdict: "fail", checks: [], fails: [{ id: "missing-file", severity: "fail", message: "No .txt file found." }], reviews: [] };
    return { ...post, validation, category: categoryFor(post.topic) };
  });
}

// Order annotated pending posts for promotion. Excludes "fail" entirely
// (caller should surface those separately for a human to fix, not silently
// drop them -- see excluded in the return value).
export function orderForPromotion(annotated, { recentCategories = [] } = {}) {
  const excluded = annotated.filter((p) => p.validation.verdict === "fail");
  const eligible = annotated.filter((p) => p.validation.verdict !== "fail");

  const now = Date.now();
  const scoreOf = (p) => {
    const base = Number.isFinite(p.qualityScore) ? p.qualityScore : (p.score ?? 50);
    const ageDays = (now - new Date(p.stagedAt).getTime()) / 86_400_000;
    const agingBonus = Math.min(15, ageDays * 0.5); // up to +15 for a post that's waited ~30 days
    const reviewPenalty = p.validation.verdict === "review" ? 30 : 0;
    return base + agingBonus - reviewPenalty;
  };

  // Greedy selection: repeatedly pick the highest-scoring remaining post
  // whose category isn't one of the last 2 promoted, unless every
  // remaining post shares a recently-used category (then just take the
  // best available -- diversity is a soft preference, not a hard block).
  const pool = [...eligible].map((p) => ({ post: p, score: scoreOf(p) }));
  const ordered = [];
  const recent = [...recentCategories];
  while (pool.length) {
    pool.sort((a, b) => b.score - a.score);
    let pickIdx = pool.findIndex((x) => !recent.slice(-2).includes(x.post.category));
    if (pickIdx === -1) pickIdx = 0;
    const [picked] = pool.splice(pickIdx, 1);
    ordered.push(picked.post);
    recent.push(picked.post.category);
  }

  return { ordered, excluded };
}
