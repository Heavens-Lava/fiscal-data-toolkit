#!/usr/bin/env node
// Current U.S. city air-quality ranking using Open-Meteo air-quality API.
// No key required. This is a city watchlist, not an all-monitor national rank.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

const PLACES = [
  ["Phoenix, AZ", 33.4484, -112.0740],
  ["Tucson, AZ", 32.2226, -110.9747],
  ["Los Angeles, CA", 34.0522, -118.2437],
  ["San Francisco, CA", 37.7749, -122.4194],
  ["Sacramento, CA", 38.5816, -121.4944],
  ["Las Vegas, NV", 36.1699, -115.1398],
  ["Salt Lake City, UT", 40.7608, -111.8910],
  ["Denver, CO", 39.7392, -104.9903],
  ["Albuquerque, NM", 35.0844, -106.6504],
  ["Dallas, TX", 32.7767, -96.7970],
  ["Houston, TX", 29.7604, -95.3698],
  ["Austin, TX", 30.2672, -97.7431],
  ["Oklahoma City, OK", 35.4676, -97.5164],
  ["Kansas City, MO", 39.0997, -94.5786],
  ["Chicago, IL", 41.8781, -87.6298],
  ["Detroit, MI", 42.3314, -83.0458],
  ["Minneapolis, MN", 44.9778, -93.2650],
  ["St. Louis, MO", 38.6270, -90.1994],
  ["New Orleans, LA", 29.9511, -90.0715],
  ["Atlanta, GA", 33.7490, -84.3880],
  ["Miami, FL", 25.7617, -80.1918],
  ["Orlando, FL", 28.5383, -81.3792],
  ["Charlotte, NC", 35.2271, -80.8431],
  ["Nashville, TN", 36.1627, -86.7816],
  ["Washington, DC", 38.9072, -77.0369],
  ["Philadelphia, PA", 39.9526, -75.1652],
  ["New York, NY", 40.7128, -74.0060],
  ["Boston, MA", 42.3601, -71.0589],
  ["Portland, OR", 45.5152, -122.6784],
  ["Seattle, WA", 47.6062, -122.3321],
];

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function aqiLabel(aqi) {
  if (aqi == null) return "n/a";
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for sensitive groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very unhealthy";
  return "Hazardous";
}

function fmt(n, digits = 1) {
  if (!Number.isFinite(Number(n))) return "n/a";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: digits });
}

async function airQuality([place, latitude, longitude]) {
  const qs = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,carbon_monoxide",
    timezone: "auto",
  });
  const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${qs}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status} for ${place}: ${text.slice(0, 160)}`);
  const json = JSON.parse(text);
  return {
    place,
    time: json.current?.time,
    aqi: json.current?.us_aqi,
    pm25: json.current?.pm2_5,
    pm10: json.current?.pm10,
    ozone: json.current?.ozone,
    no2: json.current?.nitrogen_dioxide,
    co: json.current?.carbon_monoxide,
  };
}

const noImage = process.argv.includes("--no-image");
const topN = Math.max(5, Math.min(20, Number(argValue("--top", "10")) || 10));
const today = stamp();
const outBase = path.join(SOCIAL, `air-quality-watch-${today}`);
mkdirSync(SOCIAL, { recursive: true });

const rows = (await Promise.all(PLACES.map((p) => airQuality(p).catch((err) => ({ place: p[0], error: err.message })))))
  .filter((r) => Number.isFinite(r.aqi))
  .sort((a, b) => b.aqi - a.aqi)
  .map((r, i) => ({ ...r, rank: i + 1 }));

if (!rows.length) throw new Error("No air-quality rows returned.");

const worst = rows.slice(0, topN);
const best = rows.slice(-5).reverse();
const phoenix = rows.find((r) => r.place === "Phoenix, AZ");
const chartRows = [...worst.slice(0, 5), ...best.slice().reverse()];
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({
    label: `#${r.rank} ${r.place}`,
    v: r.aqi,
    color: r.rank <= 5 ? C.neg : C.s2,
  })),
  { fmtTick: (v) => `${Math.round(v)}`, fmtVal: (v) => `${Math.round(v)} AQI` }
);

const hero = worst[0];
const html = cardHTML({
  kicker: "Air quality watch",
  title: "Current US AQI across major cities",
  hero: `${Math.round(hero.aqi)} AQI`,
  heroLabel: `${hero.place}; ${aqiLabel(hero.aqi)}`,
  chartSVG,
  source: "Open-Meteo air-quality API",
  vintage: hero.time || today,
});

const facebook = [
  "Which major U.S. cities have the cleanest air today?",
  "",
  `At the time of this check, AQI ranged from ${Math.round(best[0].aqi)} in ${best[0].place} to ${Math.round(hero.aqi)} in ${hero.place}.`,
  "",
  `Highest AQI: ${hero.place} - ${Math.round(hero.aqi)} (${aqiLabel(hero.aqi)})`,
  ...(phoenix ? [`Phoenix: #${phoenix.rank} (${Math.round(phoenix.aqi)} AQI, ${aqiLabel(phoenix.aqi)}).`] : []),
  `Lowest AQI: ${best[0].place} - ${Math.round(best[0].aqi)} (${aqiLabel(best[0].aqi)})`,
  "",
  "AQI can change hour by hour with wind, wildfire smoke, ozone, and local pollution. This is a 30-city snapshot, not an official ranking of every U.S. monitor.",
  "",
  "What is the air quality where you live today? Post your city and AQI in the comments.",
  "",
  "Follow for fresh public-data checks, and share this with someone who watches local air quality.",
];

const lines = [
  `Air quality watch (${today})`,
  "",
  "Metric: current US AQI from Open-Meteo for a major-city watchlist.",
  "",
  "Rank | Place | US AQI | Category | PM2.5 | PM10 | Ozone | NO2",
  "---:|---|---:|---|---:|---:|---:|---:",
  ...worst.map((r) => `${r.rank} | ${r.place} | ${Math.round(r.aqi)} | ${aqiLabel(r.aqi)} | ${fmt(r.pm25)} | ${fmt(r.pm10)} | ${fmt(r.ozone)} | ${fmt(r.no2)}`),
  "",
  "Lowest AQI in watchlist",
  "",
  "Rank | Place | US AQI | Category | PM2.5 | PM10 | Ozone | NO2",
  "---:|---|---:|---|---:|---:|---:|---:",
  ...best.map((r) => `${r.rank} | ${r.place} | ${Math.round(r.aqi)} | ${aqiLabel(r.aqi)} | ${fmt(r.pm25)} | ${fmt(r.pm10)} | ${fmt(r.ozone)} | ${fmt(r.no2)}`),
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
  "",
  "Source: Open-Meteo air-quality API.",
  "Note: This is a curated major-city watchlist, not an all-monitor official national ranking.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "place", "us_aqi", "category", "pm2_5", "pm10", "ozone", "nitrogen_dioxide", "carbon_monoxide", "time"],
  rows.map((r) => [r.rank, r.place, r.aqi, aqiLabel(r.aqi), r.pm25, r.pm10, r.ozone, r.no2, r.co, r.time])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
