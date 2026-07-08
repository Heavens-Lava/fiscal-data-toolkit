#!/usr/bin/env node
// osm-place-profile.mjs - OpenStreetMap/Nominatim place profile + nearby POI counts.
// No key required. Please keep usage light and identify the app via User-Agent.

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
const UA = "fiscal-data-toolkit/1.0 social-data-script";

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "place";
}

async function getJSON(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal, headers: { "User-Agent": UA, ...(options.headers || {}) } });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function geocode(place) {
  const qs = new URLSearchParams({ q: place, format: "jsonv2", limit: "1", addressdetails: "1", extratags: "1" });
  const rows = await getJSON(`https://nominatim.openstreetmap.org/search?${qs}`);
  if (!rows?.length) throw new Error(`Place not found: ${place}`);
  return rows[0];
}

async function overpassCounts(lat, lon, radius) {
  const categories = [
    { key: "amenity", value: "school", label: "Schools" },
    { key: "amenity", value: "restaurant", label: "Restaurants" },
    { key: "amenity", value: "hospital", label: "Hospitals" },
    { key: "shop", value: "supermarket", label: "Supermarkets" },
    { key: "leisure", value: "park", label: "Parks" },
    { key: "tourism", value: "hotel", label: "Hotels" },
    { key: "public_transport", value: "platform", label: "Transit stops" },
  ];
  const unions = categories.map((c) => `node["${c.key}"="${c.value}"](around:${radius},${lat},${lon});way["${c.key}"="${c.value}"](around:${radius},${lat},${lon});relation["${c.key}"="${c.value}"](around:${radius},${lat},${lon});`).join("");
  const query = `[out:json][timeout:25];(${unions});out tags;`;
  const data = await getJSON("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }),
  });
  return categories.map((c) => ({
    label: c.label,
    count: (data.elements || []).filter((el) => el.tags?.[c.key] === c.value).length,
  })).sort((a, b) => b.count - a.count);
}

const placeQuery = argValue("--place", process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ") || "Phoenix, Arizona");
const radius = Number(argValue("--radius", "2000"));
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `osm-place-profile-${slug(placeQuery)}-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const place = await geocode(placeQuery);
const lat = Number(place.lat);
const lon = Number(place.lon);
const counts = await overpassCounts(lat, lon, radius).catch((err) => {
  console.error(`Overpass POI counts unavailable: ${err.message}`);
  return [];
});
const chartRows = counts.length ? counts : [{ label: "POI counts unavailable", count: 1 }];
const top = counts[0];

const chartSVG = horizontalBarChart(
  chartRows.map((r, i) => ({ label: r.label, v: r.count, color: i === 0 ? C.s2 : C.s1 })),
  { fmtTick: (v) => String(Math.round(v)), fmtVal: (v) => String(Math.round(v)) }
);

const html = cardHTML({
  kicker: "OpenStreetMap profile",
  title: place.display_name,
  hero: top ? String(top.count) : "n/a",
  heroLabel: top ? `${top.label} within ${radius.toLocaleString("en-US")}m` : "nearby POI counts",
  chartSVG,
  source: "OpenStreetMap Nominatim + Overpass",
  vintage: stamp,
});

const lines = [
  `OpenStreetMap place profile (${stamp})`,
  "",
  `Place: ${place.display_name}`,
  `OSM type: ${place.osm_type} ${place.osm_id}`,
  `Class/type: ${place.class || "-"} / ${place.type || "-"}`,
  `Coordinates: ${lat.toFixed(5)}, ${lon.toFixed(5)}`,
  `Nearby search radius: ${radius.toLocaleString("en-US")} meters`,
  "",
  "Nearby OpenStreetMap feature counts",
  "",
  "Category | Count",
  "---|---:",
  ...counts.map((r) => `${r.label} | ${r.count}`),
  "",
  "Source: OpenStreetMap Nominatim geocoding and Overpass feature query.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["place", "lat", "lon", "radius_m", "category", "count"],
  counts.map((r) => [place.display_name, lat, lon, radius, r.label, r.count])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
