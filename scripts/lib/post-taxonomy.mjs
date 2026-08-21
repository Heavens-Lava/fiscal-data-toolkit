// post-taxonomy.mjs — editorial tags for post-performance analysis.
//
// FORMAT   the storytelling shape (a ranking? a before/after? a felt cost?)
// DOMAIN   the subject area
// FRAMING  the unit the headline number is expressed in
//
// The point of tagging is to let Facebook performance data (once it exists)
// be sliced along these axes instead of just by topic -- e.g. "do hours-
// framed posts outperform percentage-framed posts?" rather than only
// "did this one post do well?" See CONTENT-ROADMAP.md's 2026-08-21 entry.
//
// Not every post in social/ is tagged yet -- this is seeded with the
// 2026-08-21 human-interest batch. Add entries as posts are built or
// revisited; an untagged post just has no metadata to join against (see
// tagFor, which returns null rather than throwing).

export const FORMATS = [
  "ranking", "then_vs_now", "personal_cost", "affordability",
  "comparison", "relationship", "trend", "human_milestone",
];
export const DOMAINS = [
  "housing", "work", "family", "economy", "food", "health", "energy",
  "demographics", "government", "geography", "population", "agriculture",
  "education", "science", "transportation",
];
export const FRAMINGS = [
  "money", "hours", "percentage", "people", "purchasing_power", "ratio", "physical_quantity",
];

export const TAXONOMY = {
  "mortgage-rate-sensitivity-watch": { format: "personal_cost", domain: "housing", framing: "money" },
  "childcare-vs-tuition-watch": { format: "comparison", domain: "family", framing: "money" },
  "hours-to-buy-a-home-watch": { format: "then_vs_now", domain: "housing", framing: "hours" },
  "housing-starts-vs-population-watch": { format: "trend", domain: "housing", framing: "ratio" },
  "jobs-vs-migration-watch": { format: "relationship", domain: "work", framing: "ratio" },
  "one-income-family-watch": { format: "affordability", domain: "family", framing: "percentage" },
  "down-payment-savings-time-watch": { format: "then_vs_now", domain: "housing", framing: "physical_quantity" },
};

export function tagFor(topic) {
  return TAXONOMY[topic] || null;
}
