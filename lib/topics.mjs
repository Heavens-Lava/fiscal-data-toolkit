// topics.mjs — human labels + category grouping for the generated chart cards
// under social/. Used by the web server to build the charts-gallery API.
// Unlisted topics still show up (title-cased slug, "Other" category) so new
// scripts appear automatically without a code change here.

export const CATEGORIES = [
  "U.S. Economy",
  "Household Finance",
  "Money & Banking",
  "Trade & World",
  "Markets",
  "Arizona",
  "Live Feeds",
];

const TOPIC_META = {
  "debt": { label: "National Debt", category: "U.S. Economy" },
  "jobs": { label: "Jobs Report (12mo)", category: "U.S. Economy" },
  "hires": { label: "Hires & Job Openings", category: "U.S. Economy" },
  "inflation": { label: "Inflation (CPI/PCE)", category: "U.S. Economy" },
  "tax-dollar": { label: "Where Your Tax Dollar Goes", category: "U.S. Economy" },
  "tax-dollar-detail-2025": { label: "Tax Dollar — Detail (FY2025)", category: "U.S. Economy" },

  "budget-vs-household": { label: "Federal Budget vs. Household Budget", category: "Household Finance" },
  "cost-of-living-index": { label: "Cost of Living Index", category: "Household Finance" },
  "household-debt": { label: "Household Debt", category: "Household Finance" },
  "mortgage": { label: "Mortgage Rates", category: "Household Finance" },
  "gas": { label: "Gas Prices (National)", category: "Household Finance" },

  "banks": { label: "U.S. Banking Sector", category: "Money & Banking" },
  "debt-holders": { label: "Credit Card Loans by Bank", category: "Money & Banking" },
  "debt-holders-consumer": { label: "Consumer Loans by Bank", category: "Money & Banking" },
  "debt-holders-real-estate": { label: "Real Estate Loans by Bank", category: "Money & Banking" },
  "money-debt-cash": { label: "Money Supply, Debt & Cash", category: "Money & Banking" },

  "trade": { label: "Trade Balance", category: "Trade & World" },
  "border": { label: "Border Crossings", category: "Trade & World" },
  "world-country-gdp-per-capita": { label: "World GDP per Capita", category: "Trade & World" },

  "market-watch": { label: "Markets Watch", category: "Markets" },
  "market-structure-watch": { label: "Market Structure Watch", category: "Markets" },
  "crypto-market-watch": { label: "Crypto Market Watch", category: "Markets" },

  "arizona-economy": { label: "Arizona Economy Check", category: "Arizona" },
  "gas-az": { label: "Arizona Gas Prices", category: "Arizona" },
  "osm-place-profile-phoenix-arizona": { label: "Phoenix, AZ — Place Profile", category: "Arizona" },
  "census-business-az": { label: "Arizona — Business Census", category: "Arizona" },
  "census-commute-az": { label: "Arizona — Commute Patterns", category: "Arizona" },
  "census-demographics-az": { label: "Arizona — Demographics", category: "Arizona" },
  "census-education-az": { label: "Arizona — Education", category: "Arizona" },
  "census-family-az": { label: "Arizona — Family Structure", category: "Arizona" },
  "census-health-social-az": { label: "Arizona — Health & Social", category: "Arizona" },
  "census-housing-az": { label: "Arizona — Housing", category: "Arizona" },
  "census-income-az": { label: "Arizona — Income", category: "Arizona" },
  "census-migration-az": { label: "Arizona — Migration", category: "Arizona" },
  "census-migration-gain-az": { label: "Arizona — Migration Gains", category: "Arizona" },
  "census-migration-loss-az": { label: "Arizona — Migration Losses", category: "Arizona" },
  "census-population-housing-az": { label: "Arizona — Population & Housing", category: "Arizona" },

  "earthquake-watch": { label: "Earthquake Watch", category: "Live Feeds" },
  "weather-check": { label: "Weather Check", category: "Live Feeds" },
  "nasa-space-watch": { label: "NASA Space Watch", category: "Live Feeds" },
  "marriage-rates": { label: "Marriage Rates", category: "Live Feeds" },
};

const titleCase = (slug) => slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

export function metaFor(topic) {
  return TOPIC_META[topic] || { label: titleCase(topic), category: "Other" };
}
