#!/usr/bin/env node
// Weather and air-quality snapshot using Open-Meteo APIs. No key required.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  C,
  cardHTML,
  lineChart,
  screenshot,
  toCSV,
} from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

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

function weatherCodeText(code) {
  const map = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Rime fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow",
    80: "Rain showers", 81: "Rain showers", 82: "Heavy showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
  };
  return map[code] || `Weather code ${code}`;
}

async function geocode(q) {
  const parts = q.split(",").map((p) => p.trim()).filter(Boolean);
  const city = parts[0] || q;
  const region = parts.slice(1).join(" ").toLowerCase();
  const attempts = [...new Set([q, city])];
  let hit = null;

  for (const attempt of attempts) {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(attempt)}&count=10&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo geocoding HTTP ${res.status}`);
    const results = (await res.json()).results || [];
    hit = results.find((r) => {
      if (!region) return true;
      const haystack = [r.name, r.admin1, r.admin2, r.country, r.country_code]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(region);
    }) || results[0] || null;
    if (hit) break;
  }

  if (!hit) throw new Error(`Location not found: ${q}`);
  return {
    name: [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(", "),
    latitude: hit.latitude,
    longitude: hit.longitude,
    timezone: hit.timezone || "auto",
  };
}

async function forecast(place) {
  const qs = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: place.timezone,
    forecast_days: "7",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${qs}`);
  if (!res.ok) throw new Error(`Open-Meteo forecast HTTP ${res.status}`);
  return res.json();
}

async function airQuality(place) {
  const qs = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: "us_aqi,pm2_5,ozone",
    timezone: place.timezone,
  });
  const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${qs}`);
  if (!res.ok) throw new Error(`Open-Meteo air quality HTTP ${res.status}`);
  return res.json();
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

const location = argValue("--location", "Phoenix, Arizona");
const noImage = process.argv.includes("--no-image");
const stamp = new Date().toISOString().slice(0, 10);
const outBase = path.join(SOCIAL, `weather-check-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const place = await geocode(location);
const [wx, aq] = await Promise.all([forecast(place), airQuality(place).catch(() => null)]);
const current = wx.current;
const daily = wx.daily;
const aqi = aq?.current?.us_aqi ?? null;

const points = daily.time.map((d, i) => ({
  label: d.slice(5),
  max: daily.temperature_2m_max[i],
  min: daily.temperature_2m_min[i],
  rain: daily.precipitation_sum[i],
  rainProb: daily.precipitation_probability_max[i],
  wind: daily.wind_speed_10m_max[i],
  code: daily.weather_code[i],
}));

const chartSVG = lineChart(
  [
    {
      name: "High",
      color: C.neg,
      points: points.map((p) => ({ label: p.label, v: p.max })),
      endLabel: (v) => `${v} high`,
    },
    {
      name: "Low",
      color: C.s1,
      points: points.map((p) => ({ label: p.label, v: p.min })),
      endLabel: (v) => `${v} low`,
    },
  ],
  {
    fmtTick: (t) => `${Math.round(t)}°`,
    fmtVal: (v) => `${Math.round(v)}°`,
    labelStep: 1,
    yLabel: "Temperature (F)",
  }
);

const html = cardHTML({
  kicker: "Weather check",
  title: `${place.name}: 7-day high/low forecast`,
  hero: `${Math.round(current.temperature_2m)}°`,
  heroLabel: `${weatherCodeText(current.weather_code)} now; AQI ${aqi ?? "n/a"} (${aqiLabel(aqi)})`,
  chartSVG,
  source: "Open-Meteo",
  vintage: current.time,
});

const lines = [
  `Weather check (${stamp})`,
  "",
  `Location: ${place.name}`,
  `Now: ${Math.round(current.temperature_2m)}°F, feels like ${Math.round(current.apparent_temperature)}°F, ${weatherCodeText(current.weather_code)}.`,
  `Humidity: ${f(current.relative_humidity_2m)}%. Wind: ${f(current.wind_speed_10m)} mph; gusts ${f(current.wind_gusts_10m)} mph.`,
  `Air quality: US AQI ${aqi ?? "n/a"} (${aqiLabel(aqi)}). PM2.5 ${aq?.current?.pm2_5 ?? "n/a"} ug/m3; ozone ${aq?.current?.ozone ?? "n/a"} ug/m3.`,
  "",
  "Date | Forecast | High | Low | Rain | Rain chance | Wind",
  "---|---|---:|---:|---:|---:|---:",
  ...points.map((p) => `${p.label} | ${weatherCodeText(p.code)} | ${Math.round(p.max)}°F | ${Math.round(p.min)}°F | ${p.rain.toFixed(2)} in | ${p.rainProb ?? 0}% | ${Math.round(p.wind)} mph`),
  "",
  "Source: Open-Meteo forecast and air-quality APIs. No API key required.",
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["date", "forecast", "high_f", "low_f", "rain_inches", "rain_chance_pct", "wind_mph"],
  points.map((p) => [p.label, weatherCodeText(p.code), Math.round(p.max), Math.round(p.min), p.rain.toFixed(2), p.rainProb ?? 0, Math.round(p.wind)])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
