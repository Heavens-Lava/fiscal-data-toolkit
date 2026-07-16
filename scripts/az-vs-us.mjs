#!/usr/bin/env node
// State vs U.S. Census comparison for data-first social posts. Defaults to
// Arizona; pass --state <abbr-or-name> for any other state (e.g. --state UT,
// --state "West Virginia").

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, engagementCTA, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

const TOPICS = {
  income: {
    label: "income",
    kicker: "Census comparison",
    vars: {
      DP03_0062E: ["Median household income", "money"],
      DP03_0063E: ["Mean household income", "money"],
      DP03_0128PE: ["Poverty rate", "pct"],
      DP03_0096PE: ["With health insurance", "pct"],
    },
  },
  housing: {
    label: "housing",
    kicker: "Census comparison",
    vars: {
      DP04_0046PE: ["Homeownership rate", "pct"],
      DP04_0089E: ["Median home value", "money"],
      DP04_0134E: ["Median gross rent", "money"],
      DP04_0003PE: ["Vacancy rate", "pct"],
      DP02_0016E: ["Average household size", "num1"],
    },
  },
  education: {
    label: "education",
    kicker: "Census comparison",
    vars: {
      DP02_0067PE: ["High school graduate or higher", "pct"],
      DP02_0068PE: ["Bachelor's degree or higher", "pct"],
      DP02_0066PE: ["Graduate/professional degree", "pct"],
      DP02_0058PE: ["Enrolled in college/graduate school", "pct"],
    },
  },
  family: {
    label: "households",
    kicker: "Census comparison",
    vars: {
      DP02_0002PE: ["Married-couple households", "pct"],
      DP02_0014PE: ["Households with people under 18", "pct"],
      DP02_0015PE: ["Households with people 65+", "pct"],
      DP02_0008PE: ["Male householders living alone", "pct"],
      DP02_0012PE: ["Female householders living alone", "pct"],
    },
  },
  commute: {
    label: "commuting",
    kicker: "Census comparison",
    vars: {
      DP03_0019PE: ["Drove alone to work", "pct"],
      DP03_0021PE: ["Used public transportation", "pct"],
      DP03_0024PE: ["Worked from home", "pct"],
      DP03_0025E: ["Mean travel time to work", "num1"],
    },
  },
  demographics: {
    label: "demographics",
    kicker: "Census comparison",
    vars: {
      DP05_0018E: ["Median age", "num1"],
      DP05_0019PE: ["Under age 18", "pct"],
      DP05_0024PE: ["Age 65+", "pct"],
      DP05_0090PE: ["Hispanic or Latino", "pct"],
      DP02_0094PE: ["Foreign-born population", "pct"],
    },
  },
  "health-social": {
    label: "health/social",
    kicker: "Census comparison",
    vars: {
      DP03_0096PE: ["With health insurance", "pct"],
      DP03_0099PE: ["No health insurance", "pct"],
      DP02_0154PE: ["Households with broadband", "pct"],
      DP02_0072PE: ["With a disability", "pct"],
      DP04_0058PE: ["Occupied households with no vehicle", "pct"],
    },
  },
};

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

// State FIPS codes — Census requires these, not names/abbreviations, in the
// "state:NN" predicate. Covers all 50 states + DC; --state accepts either
// the two-letter abbreviation or the full name (case-insensitive).
const STATE_FIPS = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10",
  DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19",
  KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27",
  MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35",
  NY: "36", NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44",
  SC: "45", SD: "46", TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53",
  WV: "54", WI: "55", WY: "56",
};
const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

function resolveState(input) {
  const byAbbr = String(input).toUpperCase();
  if (STATE_FIPS[byAbbr]) return { abbr: byAbbr, name: STATE_NAMES[byAbbr], fips: STATE_FIPS[byAbbr] };
  const byName = Object.keys(STATE_NAMES).find((k) => STATE_NAMES[k].toLowerCase() === String(input).toLowerCase());
  if (byName) return { abbr: byName, name: STATE_NAMES[byName], fips: STATE_FIPS[byName] };
  return null;
}

function getCensusKey() {
  if (process.env.CENSUS_API_KEY) return process.env.CENSUS_API_KEY;
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^CENSUS_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseValue(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > -100000 ? n : null;
}

function fmt(v, type) {
  if (v == null) return "n/a";
  if (type === "money") return `$${Math.round(v).toLocaleString("en-US")}`;
  if (type === "pct") return `${v.toFixed(1)}%`;
  return v.toFixed(1);
}

function diff(az, us, type) {
  if (az == null || us == null) return "";
  const d = az - us;
  if (type === "money") return `${d >= 0 ? "+" : "-"}$${Math.abs(Math.round(d)).toLocaleString("en-US")}`;
  if (type === "pct") return `${d >= 0 ? "+" : ""}${d.toFixed(1)} pp`;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}`;
}

async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`Census HTTP ${res.status}: ${text.slice(0, 160)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function acs(year, variables, forClause, key) {
  const qs = new URLSearchParams({ get: ["NAME", ...variables].join(","), for: forClause, key });
  const json = await getJSON(`https://api.census.gov/data/${year}/acs/acs1/profile?${qs}`);
  const [header, row] = json;
  return Object.fromEntries(header.map((h, i) => [h, row[i]]));
}

async function acsRows(year, variables, forClause, key) {
  const qs = new URLSearchParams({ get: ["NAME", ...variables].join(","), for: forClause, key });
  const json = await getJSON(`https://api.census.gov/data/${year}/acs/acs1/profile?${qs}`);
  const [header, ...rows] = json;
  return rows.map((row) => Object.fromEntries(header.map((h, i) => [h, row[i]])));
}

async function latestYear(key, fips) {
  for (const year of [2025, 2024, 2023, 2022, 2021]) {
    try {
      await acs(year, ["DP05_0001E"], `state:${fips}`, key);
      return year;
    } catch (err) {
      if (/key/i.test(err.message)) throw err;
    }
  }
  throw new Error("No ACS 1-year profile vintage available.");
}

const key = getCensusKey();
if (!key) {
  console.error("Missing CENSUS_API_KEY. Add CENSUS_API_KEY=your_key to .env.");
  process.exit(1);
}

const topicKey = argValue("--topic", "income");
const topic = TOPICS[topicKey];
if (!topic) {
  console.error(`Unknown --topic "${topicKey}". Options: ${Object.keys(TOPICS).join(", ")}`);
  process.exit(1);
}

const state = resolveState(argValue("--state", "AZ"));
if (!state) {
  console.error(`Unknown --state "${argValue("--state")}". Use a two-letter abbreviation (e.g. UT) or full name (e.g. "West Virginia").`);
  process.exit(1);
}

const noImage = process.argv.includes("--no-image");
const view = argValue("--view", "az");
const year = Number(argValue("--year", "0")) || await latestYear(key, state.fips);
const vars = Object.keys(topic.vars);

if (view === "extremes") {
  const [statesRaw, us] = await Promise.all([
    acsRows(year, vars, "state:*", key),
    acs(year, vars, "us:1", key),
  ]);
  const states = statesRaw.filter((r) => /^\d{2}$/.test(r.state) && Number(r.state) <= 56);
  const metricArg = argValue("--metric", "");
  const metricVar = metricArg
    ? vars.find((v) => v.toLowerCase() === metricArg.toLowerCase()
        || topic.vars[v][0].toLowerCase().replace(/[^a-z0-9]+/g, "-").includes(metricArg.toLowerCase().replace(/[^a-z0-9]+/g, "-")))
    : vars[0];
  if (!metricVar) {
    console.error(`Unknown --metric "${metricArg}". Options: ${vars.map((v) => topic.vars[v][0]).join(", ")}`);
    process.exit(1);
  }

  const rows = vars.map((variable) => {
    const [label, type] = topic.vars[variable];
    const ranked = states
      .map((s) => ({ state: s.NAME, value: parseValue(s[variable]) }))
      .filter((r) => r.value != null)
      .sort((a, b) => b.value - a.value);
    const high = ranked[0];
    const low = ranked.at(-1);
    const usValue = parseValue(us[variable]);
    return {
      metric: label,
      variable,
      type,
      highestState: high?.state || "",
      highestValue: high?.value ?? null,
      lowestState: low?.state || "",
      lowestValue: low?.value ?? null,
      usValue,
      highestFormatted: fmt(high?.value, type),
      lowestFormatted: fmt(low?.value, type),
      usFormatted: fmt(usValue, type),
    };
  });

  const chartInfo = rows.find((r) => r.variable === metricVar);
  const chartRanked = states
    .map((s) => ({ state: s.NAME, value: parseValue(s[metricVar]) }))
    .filter((r) => r.value != null)
    .sort((a, b) => b.value - a.value);

  // The featured state's own position — the single most relatable data point
  // for this audience, and previously omitted entirely unless it happened to
  // land in the top/bottom 5. Always surface it, and pull it into the chart
  // if it isn't already shown.
  const stateIndex = chartRanked.findIndex((r) => r.state === state.name);
  const stateEntry = stateIndex >= 0 ? chartRanked[stateIndex] : null;
  const stateRank = stateIndex >= 0 ? stateIndex + 1 : null;

  const featured = [...chartRanked.slice(0, 5), ...chartRanked.slice(-5)];
  const chartRows = [...featured, { state: "U.S.", value: chartInfo.usValue, us: true }];
  if (stateEntry && !featured.some((r) => r.state === state.name)) {
    chartRows.push({ state: `${state.name} (${state.abbr})`, value: stateEntry.value, featured: true });
  }
  const rankedTableRows = chartRows.map((r) => ({
    rank: r.us ? "U.S." : r.featured ? String(stateRank) : String(chartRanked.findIndex((x) => x.state === r.state) + 1),
    state: r.state,
    value: r.value,
    formatted: fmt(r.value, chartInfo.type),
  }));
  const chartSVG = horizontalBarChart(
    chartRows.map((r) => ({
      label: r.state,
      v: r.value,
      color: r.us ? C.s2 : r.featured ? C.neg : C.s1,
    })),
    {
      fmtTick: (v) => chartInfo.type === "money" ? `$${Math.round(v / 1000)}k` : chartInfo.type === "pct" ? `${Math.round(v)}%` : `${Math.round(v)}`,
      fmtVal: (v) => fmt(v, chartInfo.type),
    }
  );

  const outBase = path.join(SOCIAL, `state-extremes-${slug(state.abbr)}-${slug(topicKey)}-${slug(topic.vars[metricVar][0])}-${stamp()}`);
  mkdirSync(SOCIAL, { recursive: true });

  const metricLabel = topic.vars[metricVar][0];
  const statePhrase = stateEntry
    ? `${state.name}'s ${metricLabel.toLowerCase()} is ${fmt(stateEntry.value, chartInfo.type)} — that ranks #${stateRank} out of ${chartRanked.length} states.`
    : `${state.name} isn't reported for ${metricLabel.toLowerCase()} in this release.`;

  const html = cardHTML({
    kicker: "Census state comparison",
    title: `Highest and lowest states: ${metricLabel}`,
    hero: stateEntry ? fmt(stateEntry.value, chartInfo.type) : chartInfo.highestFormatted,
    heroLabel: stateEntry ? `${state.name} · #${stateRank} of ${chartRanked.length} states` : `${chartInfo.highestState}; U.S. ${chartInfo.usFormatted}`,
    chartSVG,
    source: "U.S. Census Bureau ACS 1-year Data Profile",
    vintage: String(year),
  });

  const facebook = [
    `${statePhrase}`,
    "",
    `Nationally, ${chartInfo.highestState} has the highest ${metricLabel.toLowerCase()} (${chartInfo.highestFormatted}) and ${chartInfo.lowestState} has the lowest (${chartInfo.lowestFormatted}) — the U.S. average is ${chartInfo.usFormatted}.`,
    "",
    "Source: U.S. Census Bureau, American Community Survey 1-year estimates.",
    "",
    engagementCTA("ranking", `${slug(state.abbr)}-${slug(topicKey)}-${slug(metricLabel)}-${stamp()}`),
  ];

  const lines = [
    `Census state extremes: ${state.name} — ${topic.label} (${stamp()})`,
    "",
    "Facebook post",
    "-------------",
    facebook.join("\n"),
    "",
    "Data table",
    "----------",
    `Chart metric: ${metricLabel}.`,
    "",
    "Metric | Highest state | Highest | U.S. | Lowest state | Lowest | Vintage",
    "---|---|---:|---:|---|---:|---:",
    ...rows.map((r) => `${r.metric} | ${r.highestState} | ${r.highestFormatted} | ${r.usFormatted} | ${r.lowestState} | ${r.lowestFormatted} | ${year}`),
    "",
    `${metricLabel} ranking used in chart`,
    "",
    "Rank | State | Value | Vintage",
    "---:|---|---:|---:",
    ...rankedTableRows.map((r) => `${r.rank} | ${r.state} | ${r.formatted} | ${year}`),
    "",
    "Source: U.S. Census Bureau ACS 1-year Data Profile.",
  ];

  writeFileSync(`${outBase}.txt`, lines.join("\n"));
  writeFileSync(`${outBase}.csv`, toCSV(
    ["metric", "variable", "highest_state", "highest_value", "us_value", "lowest_state", "lowest_value", "vintage"],
    rows.map((r) => [r.metric, r.variable, r.highestState, r.highestValue, r.usValue, r.lowestState, r.lowestValue, year])
  ));
  writeFileSync(`${outBase}-ranking.csv`, toCSV(
    ["rank", "state", "metric", "value", "formatted", "vintage"],
    rankedTableRows.map((r) => [r.rank, r.state, topic.vars[metricVar][0], r.value, r.formatted, year])
  ));
  writeFileSync(`${outBase}.html`, html);
  if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

  console.log(lines.join("\n"));
  console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`)).join(" / ")} / ${rel(`${outBase}-ranking.csv`)}`);
  process.exit(0);
}

const [az, us] = await Promise.all([
  acs(year, vars, `state:${state.fips}`, key),
  acs(year, vars, "us:1", key),
]);

const rows = vars.map((variable) => {
  const [label, type] = topic.vars[variable];
  const azValue = parseValue(az[variable]);
  const usValue = parseValue(us[variable]);
  return {
    metric: label,
    variable,
    type,
    azValue,
    usValue,
    azFormatted: fmt(azValue, type),
    usFormatted: fmt(usValue, type),
    difference: diff(azValue, usValue, type),
  };
});

// Lead with whichever metric actually differs most from the U.S., not
// whichever happens to be listed first in TOPICS — that's the hook worth
// reading past the fold for. Comparable magnitude across mixed units: percent
// relative difference for money/num1, percentage-point gap for pct (already
// on a 0-100 scale).
const strikingScore = (r) => {
  if (r.azValue == null || r.usValue == null) return -1;
  return r.type === "pct" ? Math.abs(r.azValue - r.usValue) : Math.abs(r.azValue / r.usValue - 1) * 100;
};
const heroRow = [...rows].sort((a, b) => strikingScore(b) - strikingScore(a))[0];
const outBase = path.join(SOCIAL, `${slug(state.abbr)}-vs-us-${slug(topicKey)}-${stamp()}`);
mkdirSync(SOCIAL, { recursive: true });

const chartType = heroRow.type;
const chartRows = rows.filter((r) => r.type === chartType && r.azValue != null);
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({
    label: r.metric.length > 34 ? `${r.metric.slice(0, 31)}...` : r.metric,
    v: r.azValue,
    labelValue: r.azFormatted,
    color: (r.azValue ?? 0) >= (r.usValue ?? 0) ? C.s2 : C.s1,
  })),
  {
    fmtTick: (v) => chartType === "money" ? `$${Math.round(v / 1000)}k` : `${Math.round(v)}`,
    fmtVal: (v) => chartRows.find((r) => r.azValue === v)?.azFormatted || fmt(v, chartType),
  }
);

const title = `${state.name} vs U.S.: ${topic.label}`;
const html = cardHTML({
  kicker: topic.kicker,
  title,
  hero: heroRow.azFormatted,
  heroLabel: `${heroRow.metric} in ${state.name}; U.S. ${heroRow.usFormatted}`,
  chartSVG,
  source: "U.S. Census Bureau ACS 1-year Data Profile",
  vintage: String(year),
});

const directionWord = (r) => {
  if (r.azValue == null || r.usValue == null) return "differs from";
  return r.azValue > r.usValue ? "is higher than" : r.azValue < r.usValue ? "is lower than" : "matches";
};

const facebook = [
  `In ${state.name}, ${heroRow.metric.toLowerCase()} is ${heroRow.azFormatted} — that ${directionWord(heroRow)} the U.S. average of ${heroRow.usFormatted} (${heroRow.difference}).`,
  "",
  `Other ${topic.label} stats, ${state.name} vs. U.S.: ${rows.filter((r) => r !== heroRow).map((r) => `${r.metric} ${r.azFormatted} vs ${r.usFormatted}`).join(", ")}.`,
  "",
  "Source: U.S. Census Bureau, American Community Survey 1-year estimates.",
  "",
  engagementCTA("generic", `${slug(state.abbr)}-${slug(topicKey)}-${stamp()}`),
];

const lines = [
  `${title} (${stamp()})`,
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
  "",
  "Data table",
  "----------",
  `Metric | ${state.abbr} | U.S. | ${state.abbr} minus U.S. | Vintage`,
  "---|---:|---:|---:|---:",
  ...rows.map((r) => `${r.metric} | ${r.azFormatted} | ${r.usFormatted} | ${r.difference} | ${year}`),
  "",
  "Source: U.S. Census Bureau ACS 1-year Data Profile.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["metric", "variable", "arizona", "us", "difference", "vintage"],
  rows.map((r) => [r.metric, r.variable, r.azValue, r.usValue, r.difference, year])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`)).join(" / ")}`);
