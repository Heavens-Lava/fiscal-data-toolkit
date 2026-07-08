#!/usr/bin/env node
// nasa-space-watch.mjs - NASA APOD + near-Earth object snapshot.
// Uses NASA_API_KEY if present, otherwise DEMO_KEY.

import { mkdirSync, writeFileSync } from "node:fs";
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

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function miles(n) {
  return `${Math.round(n).toLocaleString("en-US")} mi`;
}

function feet(n) {
  return `${Math.round(n).toLocaleString("en-US")} ft`;
}

function lunar(distanceMiles) {
  return distanceMiles / 238855;
}

const apiKey = process.env.NASA_API_KEY || "DEMO_KEY";
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `nasa-space-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

async function nasa(pathq) {
  const sep = pathq.includes("?") ? "&" : "?";
  const res = await fetch(`https://api.nasa.gov${pathq}${sep}api_key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) throw new Error(`NASA HTTP ${res.status} for ${pathq}`);
  return res.json();
}

const [apod, neo] = await Promise.all([
  nasa("/planetary/apod"),
  nasa("/neo/rest/v1/feed"),
]);

const asteroidRows = Object.values(neo.near_earth_objects || {})
  .flat()
  .map((r) => {
    const approach = r.close_approach_data?.[0] || {};
    const distance = Number(approach.miss_distance?.miles);
    const velocity = Number(approach.relative_velocity?.miles_per_hour);
    const diameterFt = Number(r.estimated_diameter?.feet?.estimated_diameter_max);
    return {
      name: r.name,
      hazardous: Boolean(r.is_potentially_hazardous_asteroid),
      date: approach.close_approach_date || "",
      distance,
      velocity,
      diameterFt,
    };
  })
  .filter((r) => Number.isFinite(r.distance))
  .sort((a, b) => a.distance - b.distance);

if (!asteroidRows.length) throw new Error("NASA NEO feed returned no approach rows");

const closest = asteroidRows[0];
const chartRows = asteroidRows.slice(0, 10);
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({
    label: r.name.length > 34 ? `${r.name.slice(0, 31)}...` : r.name,
    v: lunar(r.distance),
    color: r.hazardous ? C.neg : C.s1,
  })),
  { fmtTick: (v) => `${v.toFixed(0)}x`, fmtVal: (v) => `${v.toFixed(1)}x Moon` }
);

const html = cardHTML({
  kicker: "NASA space watch",
  title: "Closest near-Earth objects in NASA's current feed",
  hero: `${lunar(closest.distance).toFixed(1)}x`,
  heroLabel: `Moon distance: ${closest.name}`,
  chartSVG,
  source: "NASA APOD + NeoWs APIs",
  vintage: stamp,
});

const lines = [
  `NASA space watch (${stamp})`,
  "",
  `Astronomy picture/video: ${apod.title || "n/a"} (${apod.date || "latest"})`,
  `Closest NEO in current feed: ${closest.name}, ${miles(closest.distance)} away (${lunar(closest.distance).toFixed(1)} lunar distances).`,
  "",
  "Rank | Object | Close approach | Miss distance | Est. max diameter | Hazardous?",
  "---:|---|---:|---:|---:|---:",
  ...chartRows.map((r, i) => `${i + 1} | ${r.name} | ${r.date} | ${miles(r.distance)} | ${Number.isFinite(r.diameterFt) ? feet(r.diameterFt) : "-"} | ${r.hazardous ? "yes" : "no"}`),
  "",
  "Source: NASA Astronomy Picture of the Day and NeoWs APIs.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "name", "date", "distance_miles", "lunar_distance", "velocity_mph", "max_diameter_ft", "hazardous"],
  chartRows.map((r, i) => [i + 1, r.name, r.date, r.distance, lunar(r.distance).toFixed(4), r.velocity || "", r.diameterFt || "", r.hazardous])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
