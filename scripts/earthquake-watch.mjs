#!/usr/bin/env node
// earthquake-watch.mjs - recent earthquake snapshot from USGS. No key required.

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

function fmtDate(ms) {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
}

function fmtDepth(km) {
  return `${Number(km).toFixed(1)} km`;
}

const minMag = Number(argValue("--min-mag", "4.5"));
const days = Number(argValue("--days", "7"));
const noImage = process.argv.includes("--no-image");
const stamp = localDateStamp();
const outBase = path.join(SOCIAL, `earthquake-watch-${stamp}`);

mkdirSync(SOCIAL, { recursive: true });

const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const qs = new URLSearchParams({
  format: "geojson",
  starttime: start,
  minmagnitude: String(minMag),
  orderby: "magnitude",
  limit: "100",
});

const res = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?${qs}`);
if (!res.ok) throw new Error(`USGS earthquake API HTTP ${res.status}`);
const json = await res.json();
const rows = (json.features || []).map((f) => ({
  place: f.properties.place || "Unknown",
  mag: Number(f.properties.mag),
  time: f.properties.time,
  depth: Number(f.geometry?.coordinates?.[2]),
  lon: Number(f.geometry?.coordinates?.[0]),
  lat: Number(f.geometry?.coordinates?.[1]),
  url: f.properties.url,
})).filter((r) => Number.isFinite(r.mag)).sort((a, b) => b.mag - a.mag);

if (!rows.length) throw new Error(`No earthquakes found for min magnitude ${minMag} over ${days} days`);

const top = rows.slice(0, 10);
const biggest = top[0];

// Aftershock sequence: a ~2-degree box around the biggest event's epicenter,
// M2.5+, from the mainshock through now — same USGS feed, no extra source.
let aftershocks = null;
if (Number.isFinite(biggest.lat) && Number.isFinite(biggest.lon)) {
  const box = 1;
  const aqs = new URLSearchParams({
    format: "geojson",
    starttime: new Date(biggest.time).toISOString(),
    endtime: new Date().toISOString(),
    minmagnitude: "2.5",
    minlatitude: String(biggest.lat - box), maxlatitude: String(biggest.lat + box),
    minlongitude: String(biggest.lon - box), maxlongitude: String(biggest.lon + box),
    orderby: "time",
    limit: "1000",
  });
  const aRes = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?${aqs}`);
  if (aRes.ok) {
    const aJson = await aRes.json();
    const events = (aJson.features || [])
      .map((f) => ({ mag: Number(f.properties.mag), time: f.properties.time, place: f.properties.place }))
      .filter((r) => Number.isFinite(r.mag) && r.time !== biggest.time);
    aftershocks = {
      count: events.length,
      m5plus: events.filter((r) => r.mag >= 5).length,
      m4to5: events.filter((r) => r.mag >= 4 && r.mag < 5).length,
      latest: events.sort((a, b) => b.time - a.time)[0] || null,
    };
  }
}
const chartSVG = horizontalBarChart(
  top.map((r, i) => ({
    label: r.place.length > 34 ? `${r.place.slice(0, 31)}...` : r.place,
    v: r.mag,
    color: i === 0 ? C.neg : C.s1,
  })),
  { fmtTick: (v) => `M${v.toFixed(0)}`, fmtVal: (v) => `M${v.toFixed(1)}` }
);

const html = cardHTML({
  kicker: "Earthquake watch",
  title: `Largest earthquakes in the last ${days} days`,
  hero: `M${biggest.mag.toFixed(1)}`,
  heroLabel: biggest.place,
  chartSVG,
  source: "USGS Earthquake Hazards Program",
  vintage: stamp,
});

// Magnitude is logarithmic (each +1.0 is ~31.6x more energy release), so a
// linear bar chart visually understates how much bigger the top events were.
const energyVsSmallest = Math.pow(10, 1.5 * (biggest.mag - top[top.length - 1].mag));
const scaleNote = `Reminder: earthquake magnitude is logarithmic, not linear — each whole number is about 31.6x more energy released, not "one more unit." The M${biggest.mag.toFixed(1)} in this list released roughly ${Math.round(energyVsSmallest).toLocaleString("en-US")}x more energy than the M${top[top.length - 1].mag.toFixed(1)} at the bottom of it, even though the chart bars don't look ${Math.round(energyVsSmallest).toLocaleString("en-US")}x different in length.`;

const aftershockLines = aftershocks && aftershocks.count > 0
  ? [
      "",
      `Aftershock activity near the largest event: ${aftershocks.count} M2.5+ events within ~1° (roughly 110 km) of the epicenter since the mainshock, including ${aftershocks.m5plus} at M5+ and ${aftershocks.m4to5} in the M4-5 range.` +
        (aftershocks.latest ? ` Most recent: M${aftershocks.latest.mag.toFixed(1)} near ${aftershocks.latest.place} (${fmtDate(aftershocks.latest.time)} UTC).` : ""),
    ]
  : [];

const facebook = [
  `Earthquake watch:`,
  "",
  `The largest earthquake in the last ${days} days was M${biggest.mag.toFixed(1)} near ${biggest.place} (${fmtDate(biggest.time)} UTC, depth ${fmtDepth(biggest.depth)}).`,
  ...aftershockLines,
  "",
  scaleNote,
  "",
  "Real numbers, real source — USGS Earthquake Hazards Program, live feed:",
  "https://earthquake.usgs.gov/earthquakes/map/",
];

const lines = [
  `Earthquake watch (${stamp})`,
  "",
  `Filter: magnitude ${minMag}+ over the last ${days} days.`,
  `Largest event: M${biggest.mag.toFixed(1)} near ${biggest.place} (${fmtDate(biggest.time)} UTC).`,
  "",
  "Rank | Magnitude | Place | Time (UTC) | Depth",
  "---:|---:|---|---:|---:",
  ...top.map((r, i) => `${i + 1} | M${r.mag.toFixed(1)} | ${r.place} | ${fmtDate(r.time)} | ${fmtDepth(r.depth)}`),
  "",
  "Source: USGS Earthquake Hazards Program GeoJSON API.",
  "",
  "Facebook post",
  "-------------",
  facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["rank", "magnitude", "place", "time_utc", "depth_km", "url"],
  top.map((r, i) => [i + 1, r.mag, r.place, fmtDate(r.time), r.depth, r.url || ""])
));
writeFileSync(`${outBase}.html`, html);
if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);

console.log(lines.join("\n"));
const files = ["txt", "csv", "html", !noImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
console.log(`\nFiles: ${files.join(" / ")}`);
