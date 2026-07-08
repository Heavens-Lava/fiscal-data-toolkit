#!/usr/bin/env node
// census-topic-snapshot.mjs - data-first Census social posts by topic.
// Sources: ACS 5-year Data Profile and County Business Patterns. Requires CENSUS_API_KEY.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  C,
  cardHTML,
  horizontalBarChart,
  screenshot,
  toCSV,
} from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

const STATES = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11",
  FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21",
  LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30",
  NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39",
  OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48", UT: "49",
  VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56",
};

const TOPICS = {
  housing: {
    title: "Housing",
    kicker: "Census housing check",
    vars: {
      "DP04_0003PE": ["Vacancy rate", "pct"],
      "DP02_0016E": ["Average household size", "num1"],
      "DP04_0046PE": ["Homeownership rate", "pct"],
      "DP04_0134E": ["Median gross rent", "money"],
      "DP04_0089E": ["Median home value", "money"],
      "DP04_0017PE": ["Housing built 2020 or later", "pct"],
      "DP04_0018PE": ["Housing built 2010-2019", "pct"],
      "DP04_0019PE": ["Housing built 2000-2009", "pct"],
    },
  },
  income: {
    title: "Income",
    kicker: "Census income check",
    vars: {
      "DP03_0062E": ["Median household income", "money"],
      "DP03_0063E": ["Mean household income", "money"],
      "DP03_0128PE": ["Poverty rate", "pct"],
      "DP03_0052E": ["Households under $10k", "count"],
      "DP03_0061E": ["Households $200k+", "count"],
    },
  },
  education: {
    title: "Education",
    kicker: "Census education check",
    vars: {
      "DP02_0067PE": ["High school graduate or higher", "pct"],
      "DP02_0066PE": ["Graduate or professional degree", "pct"],
      "DP02_0068PE": ["Bachelor's degree or higher", "pct"],
      "DP02_0058PE": ["Enrolled in college or graduate school", "pct"],
    },
  },
  family: {
    title: "Households and family",
    kicker: "Census family check",
    vars: {
      "DP02_0002PE": ["Married-couple households", "pct"],
      "DP02_0003PE": ["Married-couple households with children", "pct"],
      "DP02_0004PE": ["Cohabiting couple households", "pct"],
      "DP02_0014PE": ["Households with people under 18", "pct"],
      "DP02_0015PE": ["Households with people 65+", "pct"],
      "DP02_0008PE": ["Male householders living alone", "pct"],
      "DP02_0012PE": ["Female householders living alone", "pct"],
    },
  },
  commute: {
    title: "Work and commuting",
    kicker: "Census commute check",
    vars: {
      "DP03_0019PE": ["Drove alone to work", "pct"],
      "DP03_0021PE": ["Used public transportation", "pct"],
      "DP03_0024PE": ["Worked from home", "pct"],
      "DP03_0025PE": ["Mean travel time to work", "num1"],
      "DP03_0027PE": ["Management/business/science/arts occupations", "pct"],
    },
  },
  demographics: {
    title: "Demographics",
    kicker: "Census demographics check",
    vars: {
      "DP05_0005PE": ["Under age 5", "pct"],
      "DP05_0019PE": ["Under age 18", "pct"],
      "DP05_0018PE": ["Median age", "num1"],
      "DP05_0024PE": ["Age 65+", "pct"],
      "DP02_0094PE": ["Foreign-born population", "pct"],
      "DP05_0037PE": ["White alone", "pct"],
      "DP05_0045PE": ["Black or African American alone", "pct"],
      "DP05_0061PE": ["Asian alone", "pct"],
      "DP05_0090PE": ["Hispanic or Latino", "pct"],
    },
  },
  "health-social": {
    title: "Health-adjacent and social",
    kicker: "Census health/social check",
    vars: {
      "DP02_0072PE": ["With a disability", "pct"],
      "DP03_0096PE": ["With health insurance", "pct"],
      "DP03_0099PE": ["No health insurance", "pct"],
      "DP02_0153PE": ["Households with a computer", "pct"],
      "DP02_0154PE": ["Households with broadband", "pct"],
      "DP04_0058PE": ["Occupied households with no vehicle", "pct"],
    },
  },
};

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
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

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function stateCode(input) {
  const s = String(input || "AZ").trim().toUpperCase();
  if (STATES[s]) return { abbr: s, code: STATES[s] };
  if (/^\d{2}$/.test(s)) {
    const abbr = Object.entries(STATES).find(([, code]) => code === s)?.[0] || s;
    return { abbr, code: s };
  }
  throw new Error(`Unknown --state "${input}". Use a postal abbreviation like AZ, CA, TX.`);
}

function parseValue(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > -100000 ? n : null;
}

function fmt(v, type) {
  if (v == null) return "n/a";
  if (type === "money") return `$${Math.round(v).toLocaleString("en-US")}`;
  if (type === "pct") return `${v.toFixed(1)}%`;
  if (type === "num1") return v.toFixed(1);
  if (type === "payroll") return money(v);
  return Math.round(v).toLocaleString("en-US");
}

function money(v) {
  const n = Number(v);
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function chartValue(value, type) {
  if (value == null) return null;
  if (type === "money") return value;
  if (type === "count" || type === "payroll") return value;
  return value;
}

async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    if (text.includes("Missing Key") || text.includes("Invalid Key")) throw new Error("Census API key missing or invalid");
    if (!res.ok) throw new Error(`Census HTTP ${res.status}: ${text.slice(0, 160)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function acs(year, variables, forClause, key) {
  const qs = new URLSearchParams({ get: ["NAME", ...variables].join(","), for: forClause, key });
  const json = await getJSON(`https://api.census.gov/data/${year}/acs/acs5/profile?${qs}`);
  const [header, ...rows] = json;
  return rows.map((row) => Object.fromEntries(header.map((h, i) => [h, row[i]])));
}

async function latestAcsYear(key) {
  for (const year of [2025, 2024, 2023, 2022, 2021, 2020]) {
    try {
      await acs(year, ["DP05_0001E"], "state:04", key);
      return year;
    } catch (err) {
      if (/key/i.test(err.message)) throw err;
    }
  }
  throw new Error("No ACS 5-year profile vintage available");
}

async function topicSnapshot(topicKey, state, key, year) {
  const topic = TOPICS[topicKey];
  const variables = Object.keys(topic.vars);
  const [row] = await acs(year, variables, `state:${state.code}`, key);
  const rows = variables.map((v) => {
    const [label, type] = topic.vars[v];
    return { metric: label, value: parseValue(row[v]), formatted: fmt(parseValue(row[v]), type), type, variable: v };
  });
  const preferredType = rows.filter((r) => r.type === "pct").length >= 3
    ? "pct"
    : rows[0]?.type;
  const chartRows = rows
    .filter((r) => r.type === preferredType)
    .map((r) => ({ ...r, chart: chartValue(r.value, r.type) }))
    .filter((r) => r.chart != null)
    .slice(0, 8);
  return {
    title: `${row.NAME}: ${topic.title}`,
    kicker: topic.kicker,
    hero: rows[0]?.formatted || "n/a",
    heroLabel: rows[0]?.metric || "latest",
    source: "U.S. Census Bureau ACS 5-year profile",
    vintage: String(year),
    rows,
    chartRows,
    chartType: preferredType,
  };
}

async function migrationSnapshot(key, year, baseYear) {
  const vars = ["DP05_0001E"];
  const [latestRows, baseRows] = await Promise.all([
    acs(year, vars, "state:*", key),
    acs(baseYear, vars, "state:*", key),
  ]);
  const baseByState = new Map(baseRows.map((r) => [r.state, r]));
  const rows = latestRows.map((r) => {
    const base = baseByState.get(r.state);
    const latestPop = parseValue(r.DP05_0001E);
    const basePop = parseValue(base?.DP05_0001E);
    const added = latestPop - basePop;
    return {
      metric: r.NAME,
      value: added,
      formatted: added.toLocaleString("en-US", { maximumFractionDigits: 0 }),
      pctChange: (added / basePop) * 100,
      latestPop,
      basePop,
      type: "count",
    };
  }).filter((r) => Number.isFinite(r.value)).sort((a, b) => b.value - a.value);
  const chartRows = rows.slice(0, 10).map((r) => ({ ...r, chart: r.value }));
  return {
    title: `Which states gained the most population?`,
    kicker: "Census migration/growth check",
    hero: rows[0].formatted,
    heroLabel: `${rows[0].metric} people added, ${baseYear}-${year}`,
    source: "U.S. Census Bureau ACS 5-year profile",
    vintage: `${baseYear}-${year}`,
    rows,
    chartRows,
    chartType: "count",
    extraColumns: ["base_population", "latest_population", "pct_change"],
  };
}

async function businessSnapshot(state, key) {
  for (const year of [2024, 2023, 2022, 2021, 2020]) {
    try {
      const qs = new URLSearchParams({
        get: "NAME,NAICS2017_LABEL,ESTAB,EMP,PAYANN",
        for: `state:${state.code}`,
        NAICS2017: "*",
        key,
      });
      const json = await getJSON(`https://api.census.gov/data/${year}/cbp?${qs}`);
      const [header, ...rawRows] = json;
      const rows = rawRows.map((row) => Object.fromEntries(header.map((h, i) => [h, row[i]])))
        .filter((r) => /^\d{2}$/.test(r.NAICS2017) && r.NAICS2017 !== "00")
        .map((r) => ({
          metric: r.NAICS2017_LABEL,
          value: Number(r.EMP),
          formatted: Number(r.EMP).toLocaleString("en-US"),
          establishments: Number(r.ESTAB),
          payroll: Number(r.PAYANN) * 1000,
          type: "count",
        }))
        .sort((a, b) => b.value - a.value);
      return {
        title: `${rawRows[0]?.[0] || state.abbr}: jobs by private-sector industry`,
        kicker: "Census business check",
        hero: rows[0].formatted,
        heroLabel: `${rows[0].metric} employees`,
        source: "U.S. Census Bureau County Business Patterns",
        vintage: String(year),
        rows,
        chartRows: rows.slice(0, 10).map((r) => ({ ...r, chart: r.value })),
        chartType: "count",
        extraColumns: ["establishments", "annual_payroll"],
      };
    } catch (err) {
      if (/key/i.test(err.message)) throw err;
    }
  }
  throw new Error("No County Business Patterns vintage available");
}

const key = getCensusKey();
if (!key) {
  console.error("Missing CENSUS_API_KEY. Add CENSUS_API_KEY=your_key to .env.");
  process.exit(1);
}

const topicKey = argValue("--topic", "migration");
const state = stateCode(argValue("--state", "AZ"));
const baseYear = Number(argValue("--base", "2020"));
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();

const year = await latestAcsYear(key);
const snapshot = topicKey === "migration"
  ? await migrationSnapshot(key, year, baseYear)
  : topicKey === "business"
    ? await businessSnapshot(state, key)
    : TOPICS[topicKey]
      ? await topicSnapshot(topicKey, state, key, year)
      : null;

if (!snapshot) {
  console.error(`Unknown --topic "${topicKey}". Options: migration, business, ${Object.keys(TOPICS).join(", ")}`);
  process.exit(1);
}

const outBase = path.join(SOCIAL, `census-${slug(topicKey)}-${state.abbr.toLowerCase()}-${stamp}`);
mkdirSync(SOCIAL, { recursive: true });

const chartSVG = horizontalBarChart(
  snapshot.chartRows.map((r, i) => ({
    label: r.metric.length > 34 ? `${r.metric.slice(0, 31)}...` : r.metric,
    v: r.chart,
    color: i === 0 ? C.s2 : C.s1,
  })),
  {
    fmtTick: (v) => {
      const firstType = snapshot.chartType || snapshot.chartRows[0]?.type;
      if (firstType === "money" || firstType === "payroll") return money(v);
      if (firstType === "pct") return `${Math.round(v)}%`;
      if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
      if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3)}k`;
      return `${Math.round(v)}`;
    },
    fmtVal: (v) => {
      const firstType = snapshot.chartType || snapshot.chartRows[0]?.type;
      if (firstType === "money" || firstType === "payroll") return money(v);
      if (firstType === "pct") return `${v.toFixed(1)}%`;
      if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
      if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3)}k`;
      return `${Math.round(v)}`;
    },
  }
);

const html = cardHTML({
  kicker: snapshot.kicker,
  title: snapshot.title,
  hero: snapshot.hero,
  heroLabel: snapshot.heroLabel,
  chartSVG,
  source: snapshot.source,
  vintage: snapshot.vintage,
});

const shown = snapshot.rows.slice(0, topicKey === "migration" || topicKey === "business" ? 15 : snapshot.rows.length);
const lines = [
  `${snapshot.kicker} (${stamp})`,
  "",
  snapshot.title,
  "",
  "Metric | Latest | Date/source",
  "---|---:|---",
  ...shown.map((r) => `${r.metric} | ${r.formatted} | ${snapshot.vintage}`),
  "",
  "Source: " + snapshot.source + ".",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["metric", "value", "formatted", "vintage", ...(snapshot.extraColumns || [])],
  snapshot.rows.map((r) => [
    r.metric,
    r.value,
    r.formatted,
    snapshot.vintage,
    ...(snapshot.extraColumns || []).map((c) => {
      if (c === "base_population") return r.basePop ?? "";
      if (c === "latest_population") return r.latestPop ?? "";
      if (c === "pct_change") return r.pctChange?.toFixed(4) ?? "";
      if (c === "establishments") return r.establishments ?? "";
      if (c === "annual_payroll") return r.payroll ?? "";
      return "";
    }),
  ])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
