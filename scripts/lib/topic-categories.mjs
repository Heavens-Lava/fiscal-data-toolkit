// topic-categories.mjs — broad content-mix categories used purely for
// schedule balancing (avoid posting several same-category topics back to
// back). Separate from lib/topics.mjs, which drives the dashboard gallery's
// display labels/categories for a different, older set of topics.

export const TOPIC_CATEGORY = {
  // Cost of Living
  "homeowner-monthly-cost": "Cost of Living",
  "income-after-rent": "Cost of Living",
  "property-tax-by-state": "Cost of Living",
  "health-insurance-cost-by-state": "Cost of Living",
  "household-cost-basket": "Cost of Living",
  "family-cost-watch": "Cost of Living",
  "electric-bill-watch": "Cost of Living",
  "auto-insurance-watch": "Cost of Living",
  "largest-rental-owners": "Cost of Living",
  "salary-buying-power-70000": "Cost of Living",

  // Income & Economy
  "job-openings-competition": "Income & Economy",
  "state-income-watch": "Income & Economy",
  "state-gdp-watch": "Income & Economy",
  "state-gdp-growth-watch": "Income & Economy",
  "gdp-per-capita-gap-watch": "Income & Economy",
  "world-gdp-growth-watch": "Income & Economy",

  // Energy
  "natural-gas-production-watch": "Energy",
  "state-electricity-generation-watch": "Energy",
  "electricity-fuel-mix-watch": "Energy",
  "energy-mix-history-watch": "Energy",
  "state-wind-generation-watch": "Energy",
  "state-solar-generation-watch": "Energy",
  "state-nuclear-generation-watch": "Energy",
  "state-coal-generation-watch": "Energy",
  "state-hydro-generation-watch": "Energy",
  "state-oil-production-watch": "Energy",
  "state-carbon-emissions-watch": "Energy",

  // Population
  "young-adult-migration": "Population",
  "state-population-total-watch": "Population",
  "state-population-growth-watch": "Population",
  "world-population-watch": "Population",
  "world-population-density-watch": "Population",

  // Agriculture
  "state-corn-watch": "Agriculture",
  "state-wheat-watch": "Agriculture",
  "state-soybeans-watch": "Agriculture",
  "state-cotton-watch": "Agriculture",
  "state-cattle-watch": "Agriculture",
  "state-hogs-watch": "Agriculture",
  "state-milk-watch": "Agriculture",
  "state-chickens-watch": "Agriculture",
  "state-almonds-watch": "Agriculture",
  "state-grapes-watch": "Agriculture",
  "state-eggs-watch": "Agriculture",
  "state-sheep-watch": "Agriculture",
  "state-turkeys-watch": "Agriculture",
  "state-honey-watch": "Agriculture",
  "state-dairy-cows-watch": "Agriculture",
  "state-goats-watch": "Agriculture",
  "state-bison-watch": "Agriculture",

  // Crime & Safety
  "state-violent-crime-rate-watch": "Crime & Safety",
  "state-property-crime-rate-watch": "Crime & Safety",
  "state-violent-crime-clearance-watch": "Crime & Safety",
  "state-property-crime-clearance-watch": "Crime & Safety",
};

export function categoryFor(topic) {
  return TOPIC_CATEGORY[topic] || "Other";
}

// Greedy interleave: at each step, pick from whichever non-empty category
// (other than the one just placed) currently has the most items remaining.
// This is the standard "rearrange so no two adjacent match" algorithm — it
// only allows a repeat when one category has grown to be the only one left,
// rather than a plain round-robin, which starves smaller categories early
// and dumps whatever's left into a same-category run at the end.
export function interleaveByCategory(items, categoryOf) {
  const buckets = new Map();
  for (const item of items) {
    const cat = categoryOf(item);
    if (!buckets.has(cat)) buckets.set(cat, []);
    buckets.get(cat).push(item);
  }
  const result = [];
  let lastCat = null;
  while (result.length < items.length) {
    const candidates = [...buckets.entries()].filter(([, bucket]) => bucket.length > 0);
    if (!candidates.length) break;
    const preferred = candidates.filter(([cat]) => cat !== lastCat);
    const pool = preferred.length ? preferred : candidates;
    pool.sort((a, b) => b[1].length - a[1].length);
    const [cat, bucket] = pool[0];
    result.push(bucket.shift());
    lastCat = cat;
  }
  return result;
}
