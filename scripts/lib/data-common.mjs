import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SOCIAL = path.join(ROOT, "social");
const outputDateIndex = process.argv.indexOf("--output-date");
export const STAMP = process.env.OUTPUT_DATE || (outputDateIndex >= 0 ? process.argv[outputDateIndex + 1] : null) || new Date().toISOString().slice(0, 10);

export const STATES = [
  ["01", "AL", "Alabama"], ["02", "AK", "Alaska"], ["04", "AZ", "Arizona"], ["05", "AR", "Arkansas"],
  ["06", "CA", "California"], ["08", "CO", "Colorado"], ["09", "CT", "Connecticut"], ["10", "DE", "Delaware"],
  ["11", "DC", "District of Columbia"], ["12", "FL", "Florida"], ["13", "GA", "Georgia"], ["15", "HI", "Hawaii"],
  ["16", "ID", "Idaho"], ["17", "IL", "Illinois"], ["18", "IN", "Indiana"], ["19", "IA", "Iowa"],
  ["20", "KS", "Kansas"], ["21", "KY", "Kentucky"], ["22", "LA", "Louisiana"], ["23", "ME", "Maine"],
  ["24", "MD", "Maryland"], ["25", "MA", "Massachusetts"], ["26", "MI", "Michigan"], ["27", "MN", "Minnesota"],
  ["28", "MS", "Mississippi"], ["29", "MO", "Missouri"], ["30", "MT", "Montana"], ["31", "NE", "Nebraska"],
  ["32", "NV", "Nevada"], ["33", "NH", "New Hampshire"], ["34", "NJ", "New Jersey"], ["35", "NM", "New Mexico"],
  ["36", "NY", "New York"], ["37", "NC", "North Carolina"], ["38", "ND", "North Dakota"], ["39", "OH", "Ohio"],
  ["40", "OK", "Oklahoma"], ["41", "OR", "Oregon"], ["42", "PA", "Pennsylvania"], ["44", "RI", "Rhode Island"],
  ["45", "SC", "South Carolina"], ["46", "SD", "South Dakota"], ["47", "TN", "Tennessee"], ["48", "TX", "Texas"],
  ["49", "UT", "Utah"], ["50", "VT", "Vermont"], ["51", "VA", "Virginia"], ["53", "WA", "Washington"],
  ["54", "WV", "West Virginia"], ["55", "WI", "Wisconsin"], ["56", "WY", "Wyoming"],
].map(([fips, abbr, name]) => ({ fips, fips7: `${fips}00000`, abbr, name }));

export function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

export function envValue(name) {
  if (process.env[name]) return process.env[name];
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return null;
  const match = readFileSync(file, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
  return match ? match[1].trim() : null;
}

export async function getJSON(url, label = "API") {
  const res = await fetch(url, { headers: { "User-Agent": "fiscal-data-toolkit/1.0" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}: ${text.slice(0, 180)}`);
  return JSON.parse(text);
}

export function parseTable(json) {
  const [header, ...rows] = json;
  return rows.map((row) => Object.fromEntries(header.map((name, i) => [name, row[i]])));
}

export async function censusRows(year, dataset, variables, geography, key) {
  const qs = new URLSearchParams({ get: ["NAME", ...variables].join(","), for: geography, key });
  return parseTable(await getJSON(`https://api.census.gov/data/${year}/${dataset}?${qs}`, "Census"));
}

export function money(value) {
  const rounded = Math.round(value);
  return `${rounded < 0 ? "-" : ""}$${Math.abs(rounded).toLocaleString("en-US")}`;
}

export function pct(value, digits = 1) {
  return `${Number(value).toFixed(digits)}%`;
}

export function num(value) {
  return Math.round(value).toLocaleString("en-US");
}

export function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

export function uniqueRows(rows, key) {
  const seen = new Set();
  return rows.filter((row) => !seen.has(row[key]) && seen.add(row[key]));
}
