#!/usr/bin/env node
// Current temperatures for a curated list of Earth's hottest and coldest places.
// Source: Open-Meteo forecast API, no key required.

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

const PLACES = [
  // Known heat/extreme-desert locations.
  { name: "Death Valley, California", lat: 36.4623, lon: -116.8666, group: "hot" },
  { name: "Furnace Creek, California", lat: 36.4570, lon: -116.8670, group: "hot" },
  { name: "Mitribah, Kuwait", lat: 29.8072, lon: 47.3697, group: "hot" },
  { name: "Basra, Iraq", lat: 30.5085, lon: 47.7804, group: "hot" },
  { name: "Ahvaz, Iran", lat: 31.3183, lon: 48.6706, group: "hot" },
  { name: "Jacobabad, Pakistan", lat: 28.2810, lon: 68.4386, group: "hot" },
  { name: "Dallol, Ethiopia", lat: 14.2417, lon: 40.3000, group: "hot" },
  { name: "Timbuktu, Mali", lat: 16.7666, lon: -3.0026, group: "hot" },
  { name: "Wadi Halfa, Sudan", lat: 21.8000, lon: 31.3500, group: "hot" },
  { name: "Yuma, Arizona", lat: 32.6927, lon: -114.6277, group: "hot" },

  // Known polar/subarctic cold locations.
  { name: "Vostok Station, Antarctica", lat: -78.4645, lon: 106.8376, group: "cold" },
  { name: "Dome Fuji, Antarctica", lat: -77.3170, lon: 39.7000, group: "cold" },
  { name: "Dome C, Antarctica", lat: -75.1000, lon: 123.3500, group: "cold" },
  { name: "South Pole Station, Antarctica", lat: -90.0000, lon: 0.0000, group: "cold" },
  { name: "Oymyakon, Russia", lat: 63.4641, lon: 142.7737, group: "cold" },
  { name: "Verkhoyansk, Russia", lat: 67.5447, lon: 133.3850, group: "cold" },
  { name: "Yakutsk, Russia", lat: 62.0355, lon: 129.6755, group: "cold" },
  { name: "Alert, Nunavut", lat: 82.5018, lon: -62.3481, group: "cold" },
  { name: "Eureka, Nunavut", lat: 79.9889, lon: -85.9408, group: "cold" },
  { name: "Summit Station, Greenland", lat: 72.5796, lon: -38.4592, group: "cold" },
];

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function f(n, digits = 0) {
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: digits });
}

function cFromF(fahrenheit) {
  return (fahrenheit - 32) * 5 / 9;
}

function localDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

async function currentWeather(place) {
  const qs = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: "temperature_2m,apparent_temperature,wind_speed_10m,relative_humidity_2m",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${qs}`);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status} for ${place.name}`);
  const json = await res.json();
  return {
    ...place,
    time: json.current?.time || "",
    timezone: json.timezone || "",
    tempF: json.current?.temperature_2m,
    feelsF: json.current?.apparent_temperature,
    windMph: json.current?.wind_speed_10m,
    humidity: json.current?.relative_humidity_2m,
  };
}

function rowLine(r) {
  return `${r.name} | ${f(r.tempF, 1)}°F / ${f(cFromF(r.tempF), 1)}°C | ${f(r.feelsF, 1)}°F | ${f(r.windMph, 0)} mph | ${r.time}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const mode = argValue("--mode", "both");
const count = Math.max(3, Math.min(10, Number(argValue("--count", "8")) || 8));
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `weather-extremes-${mode}-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const rows = [];
const skipped = [];
for (const place of PLACES) {
  try {
    rows.push(await currentWeather(place));
  } catch (err) {
    skipped.push(`${place.name}: ${err.message}`);
  }
  await sleep(150);
}
const validRows = rows.filter((r) => Number.isFinite(r.tempF));
if (validRows.length < 4) {
  throw new Error(`Only ${validRows.length} weather locations returned data; try again later.`);
}
const hottest = validRows.slice().sort((a, b) => b.tempF - a.tempF).slice(0, count);
const coldest = validRows.slice().sort((a, b) => a.tempF - b.tempF).slice(0, count);

const selected = mode === "hot"
  ? hottest
  : mode === "cold"
    ? coldest.filter((r) => r.tempF < 32)
    : [
        ...hottest.slice(0, Math.ceil(count / 2)),
        ...coldest.filter((r) => r.tempF < 32).slice(0, Math.floor(count / 2)),
      ];

const heroRow = mode === "cold" ? coldest[0] : hottest[0];
const chartRows = selected.map((r) => ({
  ...r,
  chartValue: mode === "hot" ? r.tempF : r.tempF < 32 ? 32 - r.tempF : r.tempF,
}));
const chartSVG = horizontalBarChart(
  chartRows.map((r) => ({
    label: r.name.length > 34 ? `${r.name.slice(0, 31)}...` : r.name,
    v: r.chartValue,
    color: r.tempF < 32 ? C.s1 : C.neg,
  })),
  {
    fmtTick: (v) => mode === "cold" ? `${Math.round(v)}° below 32` : `${Math.round(v)}°F`,
    fmtVal: (v) => {
      const row = chartRows.find((r) => Math.abs(r.chartValue - v) < 0.001);
      return row ? `${f(row.tempF, 1)}°F` : `${f(v, 1)}°F`;
    },
  }
);

const html = cardHTML({
  kicker: "Weather extremes check",
  title: mode === "cold"
    ? "Coldest places right now"
    : mode === "hot"
      ? "Hottest places right now"
      : "Hottest and coldest places right now",
  hero: `${f(heroRow.tempF, 1)}°F`,
  heroLabel: `${heroRow.name}; ${f(cFromF(heroRow.tempF), 1)}°C`,
  chartSVG,
  source: "Open-Meteo; selected known extreme-weather locations",
  vintage: heroRow.time,
});

const lines = [
  `Weather extremes check (${stamp})`,
  "",
  "This compares current Open-Meteo temperatures for a curated list of known extreme-weather locations, not every weather station on Earth.",
  skipped.length ? `Skipped ${skipped.length} location(s) due to API errors in this run.` : "",
  "",
  "Hottest selected places right now",
  "",
  "Place | Temperature | Feels like | Wind | Local time",
  "---|---:|---:|---:|---",
  ...hottest.map(rowLine),
  "",
  "Coldest selected places right now",
  "",
  "Place | Temperature | Feels like | Wind | Local time",
  "---|---:|---:|---:|---",
  ...coldest.map(rowLine),
  "",
  "Source: Open-Meteo forecast API. Places are a curated watchlist of known heat/cold extremes.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank_hot", "rank_cold", "place", "group", "temperature_f", "temperature_c", "feels_like_f", "wind_mph", "humidity_pct", "local_time", "timezone"],
  validRows
    .slice()
    .sort((a, b) => b.tempF - a.tempF)
    .map((r, i) => {
      const coldRank = coldest.findIndex((c) => c.name === r.name) + 1;
      return [i + 1, coldRank || "", r.name, r.group, r.tempF, cFromF(r.tempF).toFixed(1), r.feelsF, r.windMph, r.humidity, r.time, r.timezone];
    })
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`)).join(" / ")}`);
