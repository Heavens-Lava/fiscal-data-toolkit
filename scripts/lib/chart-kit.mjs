// chart-kit.mjs — shared data-fetch, formatting, SVG chart, HTML card, and
// PNG-render helpers used by weekly-digest.mjs and the standalone "index"
// scripts (cost-of-living-index.mjs, arizona-economy.mjs, etc.) so every
// social card looks and behaves the same way, from one source of truth.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { STATE_PATHS, STATE_PATHS_BBOX, STATE_CENTROIDS, STATE_LABEL_ABBRS, DC_POINT } from "./us-state-paths.mjs";

// Real brand marks, embedded as data URIs so the standalone card HTML stays
// self-contained for file:// screenshots. JM = Jeff Macy's personal
// monogram (jeffreymacy2's BrandMark "warm" icon) — used as the footer
// signature. ABN = the "America By the Numbers" page's own mark — used as
// the header brand mark, since that's the wordmark it sits beside.
const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets");
const _dataUriCache = {};
function assetDataUri(filename, mime) {
  if (_dataUriCache[filename] !== undefined) return _dataUriCache[filename];
  const file = path.join(ASSETS_DIR, filename);
  _dataUriCache[filename] = existsSync(file) ? `data:${mime};base64,${readFileSync(file).toString("base64")}` : null;
  return _dataUriCache[filename];
}
const logoDataUri = () => assetDataUri("jm-logo.png", "image/png");
const abnLogoDataUri = () => assetDataUri("abn-logo.jpg", "image/jpeg");

// ── data sources ──────────────────────────────────────────────────────────────
export async function fred(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!res.ok) throw new Error(`FRED ${res.status} for ${id}`);
  return (await res.text())
    .trim().split("\n").slice(1)
    .map((l) => { const [d, v] = l.split(","); return { d, raw: v, v: Number(v) }; })
    .filter((x) => x.raw !== "" && x.raw !== "." && Number.isFinite(x.v));
}

export const FISCAL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";
export async function fiscal(pathq) {
  const res = await fetch(`${FISCAL}${pathq}`);
  if (!res.ok) throw new Error(`FiscalData ${res.status} for ${pathq}`);
  return res.json();
}

// ── formatting ────────────────────────────────────────────────────────────────
export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const mLabel  = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const mShort  = (iso) => MONTHS[Number(iso.slice(5, 7)) - 1];
export const mYr     = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} '${iso.slice(2, 4)}`;
export const moneyT  = (n) => `$${(n / 1e12).toFixed(2)}T`;
export const money0  = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
// Auto-scaling $ formatter for raw-dollar values (e.g. Census trade figures,
// which come back in whole dollars — unlike FRED's $-in-millions series).
export const fmtM = (n) => {
  const s = n < 0 ? "-" : "", a = Math.abs(n);
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
  return `${s}$${Math.round(a).toLocaleString("en-US")}`;
};
export const signK   = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n))}K`;
export const esc     = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const last    = (a) => a[a.length - 1];

// Collapse a weekly/daily series to one point per calendar month (last print
// in that month) — for multi-year charts where every weekly tick is too dense.
export function monthlyResample(series) {
  const byMonth = new Map();
  for (const x of series) byMonth.set(x.d.slice(0, 7), x); // later entries overwrite
  return [...byMonth.values()].sort((a, b) => a.d.localeCompare(b.d));
}

export function closest(series, targetDate) {
  const target = Date.parse(targetDate);
  return series.reduce((best, pt) =>
    Math.abs(Date.parse(pt.d) - target) < Math.abs(Date.parse(best.d) - target) ? pt : best
  );
}

// "1 year ago" relative to a series' OWN latest print, not wall-clock today —
// series lag behind today by different amounts (CPI ~1mo, gas ~1 day, GDP
// more), so anchoring to today silently shrinks the window for lagged series.
export function oneYearBefore(isoDate) {
  const d = new Date(isoDate);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export function monthlyPayment(principal, annualRatePct) {
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / 360;
  return principal * r / (1 - Math.pow(1 + r, -360));
}

export function parseUSDate(s) {
  const [m, d, y] = String(s).split("/").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isoFromUSDate(s) {
  return parseUSDate(s).toISOString().slice(0, 10);
}

export function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw  = span / count;
  const mag  = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || mag * 10;
  const lo   = Math.floor(min / step) * step;
  const hi   = Math.ceil(max / step) * step;
  const out  = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

// ── chart palette (dataviz reference palette, light mode, validated) ─────────
export const C = {
  surface: "#fcfcfb", ink: "#0b0b0b", ink2: "#52514e", muted: "#898781",
  grid: "#e1e0d9", baseline: "#c3c2b7",
  s1: "#2a78d6",  // categorical slot 1 (blue)
  s2: "#1baf7a",  // categorical slot 2 (aqua) — sub-3:1: always direct-labeled
  pos: "#2a78d6", neg: "#e34948",  // diverging pair (blue <-> red)
  // Full 8-hue categorical set, dataviz skill's validated default order —
  // documented-palette values (palette.md), not eyeballed. s1/s2/neg above
  // are slots 1/3/8 of this same set, kept as their own names since ~190
  // existing scripts already call them that way.
  cat: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  brand: "#0b3d2e",       // deep green brand chrome (header/footer/hero-tile fill) — white text on this is ~12:1 contrast
  brandText: "#e7f3ec",   // muted near-white for secondary text on brand-green chrome
};

// Plot geometry shared by both chart builders (SVG viewBox 1104 x 400).
// GUT leaves room for both the y-axis tick labels and (when present) a
// rotated y-axis title to their left.
export const PW = 1104, PH = 400, GUT = 96, PT = 26, PB = 36;
export const plotW = PW - GUT - 10, plotH = PH - PT - PB;

export function frame(ticks, yOf, fmtTick) {
  let s = "";
  for (const t of ticks) {
    const y = yOf(t);
    s += `<line x1="${GUT}" y1="${y}" x2="${PW}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>`;
    s += `<text x="${GUT - 10}" y="${y + 5}" text-anchor="end" font-size="15" fill="${C.muted}" style="font-variant-numeric:tabular-nums">${esc(fmtTick(t))}</text>`;
  }
  return s;
}

// Rotated axis title running along the left edge, to the left of the tick labels.
export function yAxisTitle(text) {
  if (!text) return "";
  const cx = 20, cy = PT + plotH / 2;
  return `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="14" fill="${C.muted}" transform="rotate(-90 ${cx} ${cy})">${esc(text)}</text>`;
}

// Diverging column chart: rounded 4px data-end, square at the zero baseline.
export function columnChart(points, { fmtTick, fmtVal, labelIndex = points.length - 1, yLabel }) {
  const vals  = points.map((p) => p.v);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const [lo, hi] = [ticks[0], ticks[ticks.length - 1]];
  const yOf  = (v) => PT + plotH * (1 - (v - lo) / (hi - lo));
  const band = plotW / points.length, bw = 24;

  let s = frame(ticks, yOf, fmtTick);
  const y0 = yOf(0);
  s += `<line x1="${GUT}" y1="${y0}" x2="${PW}" y2="${y0}" stroke="${C.baseline}" stroke-width="1"/>`;

  points.forEach((p, i) => {
    const x = GUT + band * i + (band - bw) / 2;
    const yv = yOf(p.v), up = p.v >= 0, h = Math.max(Math.abs(yv - y0), 2), r = Math.min(4, h);
    const top = up ? yv : y0;
    // rounded corners on the data end only
    const d = up
      ? `M${x},${y0} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + bw - r},${top} Q${x + bw},${top} ${x + bw},${top + r} L${x + bw},${y0} Z`
      : `M${x},${y0} L${x},${top + h - r} Q${x},${top + h} ${x + r},${top + h} L${x + bw - r},${top + h} Q${x + bw},${top + h} ${x + bw},${top + h - r} L${x + bw},${y0} Z`;
    s += `<path d="${d}" fill="${up ? C.pos : C.neg}"/>`;
    // value on the cap of one column only (axis carries the rest) — defaults to
    // the latest for time-series charts; callers can point it at the story instead
    if (i === labelIndex)
      s += `<text x="${x + bw / 2}" y="${up ? yv - 10 : yv + 20}" text-anchor="middle" font-size="16" font-weight="600" fill="${C.ink2}">${esc(fmtVal(p.v))}</text>`;
    s += `<text x="${x + bw / 2}" y="${PH - 8}" text-anchor="middle" font-size="14" fill="${C.muted}">${esc(p.label)}</text>`;
  });
  s += yAxisTitle(yLabel);
  return `<svg viewBox="0 0 ${PW} ${PH}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}

// Line chart, 1-2 series: 2px round-capped lines, ringed end dots, end labels.
export function lineChart(seriesList, { fmtTick, fmtVal, refLine, labelStep = 3, yLabel }) {
  const vals = seriesList.flatMap((sr) => sr.points.map((p) => p.v));
  if (refLine) vals.push(refLine.v);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const [lo, hi] = [ticks[0], ticks[ticks.length - 1]];
  const yOf = (v) => PT + plotH * (1 - (v - lo) / (hi - lo));
  const n   = seriesList[0].points.length;
  const endGutter = 148;                      // room for direct end labels
  const xOf = (i) => GUT + (plotW - endGutter) * (i / (n - 1));

  let s = frame(ticks, yOf, fmtTick);
  if (refLine) {
    const y = yOf(refLine.v);
    s += `<line x1="${GUT}" y1="${y}" x2="${PW - endGutter + 60}" y2="${y}" stroke="${C.baseline}" stroke-width="1"/>`;
    s += `<text x="${GUT + 6}" y="${y - 8}" font-size="14" fill="${C.muted}">${esc(refLine.label)}</text>`;
  }
  seriesList[0].points.forEach((p, i) => {
    const nearFinalLabel = i !== n - 1 && n - 1 - i < Math.max(2, Math.ceil(labelStep / 2));
    if (i === n - 1 || (i % labelStep === 0 && !nearFinalLabel))
      s += `<text x="${xOf(i)}" y="${PH - 8}" text-anchor="middle" font-size="14" fill="${C.muted}">${esc(p.label)}</text>`;
  });
  for (const sr of seriesList) {
    const d = sr.points.map((p, i) => `${i ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(" ");
    s += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const lastP = sr.points[n - 1], ex = xOf(n - 1), ey = yOf(lastP.v);
    s += `<circle cx="${ex}" cy="${ey}" r="5" fill="${sr.color}" stroke="${C.surface}" stroke-width="2"/>`;
    s += `<text x="${ex + 12}" y="${ey + 5}" font-size="16" font-weight="600" fill="${C.ink2}">${esc(sr.endLabel(fmtVal(lastP.v)))}</text>`;
  }
  s += yAxisTitle(yLabel);
  return `<svg viewBox="0 0 ${PW} ${PH}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}

export function horizontalBarChart(points, { fmtTick, fmtVal }) {
  const labelW = 300, rightW = 118, top = 18;
  // The card's .plot area is a fixed ~430px regardless of point count (the
  // card itself is a fixed 1200x675 PNG) — the SVG has no explicit
  // width/height, so it's stretched to fill that box by CSS. Past ~10 points
  // the old fixed 38px row height produced a viewBox taller than that box,
  // which doesn't scale down (width/height:100% stretches the viewport
  // rather than preserving aspect ratio) — it silently clips. Cap the target
  // height and shrink row/bar/font size together so any point count still
  // fits and stays legible, rather than clipping past ~10 bars.
  const MAX_H = 420;
  const idealRowH = 38;
  const rowH = Math.min(idealRowH, Math.max(16, (MAX_H - top - 34) / points.length));
  const scale = rowH / idealRowH;
  const barH = Math.max(8, Math.round(20 * scale));
  const labelSize = Math.max(11, Math.round(17 * scale));
  const valueSize = Math.max(10, Math.round(16 * scale));
  const tickSize = Math.max(10, Math.round(14 * scale));
  const w = PW, h = top + points.length * rowH + 34;
  // Diverging-safe domain: when every value is >= 0 this reduces to the old
  // [0, max] behavior exactly (zeroX lands on x0, bars grow rightward only).
  // When values are negative (e.g. "net migration", "% change"), the domain
  // spans below 0 too — otherwise xOf() folds negative values to a ~0-width
  // sliver at x0 regardless of magnitude, which misrepresents them as
  // negligible instead of proportionally showing how negative they are.
  const domainMin = Math.min(0, ...points.map((p) => p.v));
  const domainMax = Math.max(0, ...points.map((p) => p.v));
  const ticks = niceTicks(domainMin, domainMax, 4);
  const x0 = labelW, x1 = w - rightW;
  const tickSpan = ticks[ticks.length - 1] - ticks[0] || 1;
  const xOf = (v) => x0 + (x1 - x0) * (v - ticks[0]) / tickSpan;
  const zeroX = xOf(0);
  let s = "";
  for (const t of ticks) {
    const x = xOf(t);
    s += `<line x1="${x}" y1="${top - 6}" x2="${x}" y2="${h - 30}" stroke="${C.grid}" stroke-width="1"/>`;
    s += `<text x="${x}" y="${h - 8}" text-anchor="middle" font-size="${tickSize}" fill="${C.muted}">${esc(fmtTick(t))}</text>`;
  }
  points.forEach((p, i) => {
    const y = top + i * rowH;
    const barX = Math.min(xOf(p.v), zeroX);
    const bw = Math.max(Math.abs(xOf(p.v) - zeroX), 2);
    const negative = p.v < 0;
    const labelX = negative ? barX - 10 : barX + bw + 10;
    const anchor = negative ? ` text-anchor="end"` : "";
    s += `<text x="0" y="${y + barH + 2}" font-size="${labelSize}" font-weight="600" fill="${C.ink2}">${esc(p.label)}</text>`;
    s += `<rect x="${barX}" y="${y + 2}" width="${bw}" height="${barH}" rx="4" fill="${p.color || C.s1}"/>`;
    s += `<text x="${labelX}" y="${y + barH}" font-size="${valueSize}" font-weight="650" fill="${C.ink}"${anchor}>${esc(fmtVal(p.v))}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}

const STATE_TILE_POSITIONS = {
  WA:[0,0],ID:[1,0],MT:[2,0],ND:[3,0],MN:[4,0],WI:[5,0],MI:[6,0],NY:[9,0],VT:[10,0],NH:[11,0],ME:[12,0],
  OR:[0,1],NV:[1,1],WY:[2,1],SD:[3,1],IA:[4,1],IL:[5,1],IN:[6,1],OH:[7,1],PA:[8,1],NJ:[9,1],CT:[10,1],RI:[11,1],MA:[12,1],
  CA:[0,2],UT:[1,2],CO:[2,2],NE:[3,2],MO:[4,2],KY:[5,2],WV:[6,2],VA:[7,2],MD:[8,2],DE:[9,2],DC:[10,2],
  AZ:[1,3],NM:[2,3],KS:[3,3],AR:[4,3],TN:[5,3],NC:[7,3],SC:[8,3],
  TX:[2,4],OK:[3,4],LA:[4,4],MS:[5,4],AL:[6,4],GA:[7,4],FL:[8,4],AK:[0,5],HI:[1,5],
};

function colorBetween(a, b, amount) {
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const start = parse(a), end = parse(b);
  return `#${start.map((value, i) => Math.round(value + (end[i] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

export const STATE_MAP_PALETTE = ["#e66b5b", "#e4ad55", "#d9dddc", "#63b7ad", "#087f83"];

function mapColor(t, { palette, lowColor, highColor }) {
  const value = Math.max(0, Math.min(1, t));
  if (!palette) return colorBetween(lowColor, highColor, Math.sqrt(value));
  return palette[Math.min(palette.length - 1, Math.floor(value * palette.length))];
}

function readableInk(hex) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return luminance < 0.39 ? "#ffffff" : C.ink;
}

function segmentedLegend(palette, x, y, width, height) {
  const band = width / palette.length;
  return palette.map((color, index) => `<rect x="${x + index * band}" y="${y}" width="${band + 0.5}" height="${height}" fill="${color}"/>`).join("");
}

function labeledSegmentedLegend(palette, labels, x, y, width, height) {
  const band = width / palette.length;
  return `${segmentedLegend(palette, x, y, width, height)}${labels.map((label, index) =>
    `<text x="${x + (index + 0.5) * band}" y="${y + height + 18}" text-anchor="middle" font-size="10" font-weight="600" fill="${C.muted}">${esc(label)}</text>`
  ).join("")}`;
}

function thresholdColor(value, palette, thresholds) {
  const index = thresholds.reduce((count, threshold) => count + (value >= threshold ? 1 : 0), 0);
  return palette[Math.min(index, palette.length - 1)];
}

export function stateTileMap(rows, { fmtVal, lowColor, highColor, palette = STATE_MAP_PALETTE, thresholds = null, legendLabels = null }) {
  if (lowColor && highColor && palette === STATE_MAP_PALETTE) palette = null;
  lowColor ||= "#e8f1fb";
  highColor ||= "#1769c2";
  const usable = rows.filter((row) => STATE_TILE_POSITIONS[row.abbr] && Number.isFinite(row.v));
  const values = usable.map((row) => row.v), lo = Math.min(...values), hi = Math.max(...values);
  const tileW = 76, tileH = 52, gap = 5, x0 = 24, y0 = 20;
  let s = `<defs><linearGradient id="mapScale"><stop offset="0" stop-color="${lowColor}"/><stop offset="1" stop-color="${highColor}"/></linearGradient></defs>`;
  for (const row of usable) {
    const [col, line] = STATE_TILE_POSITIONS[row.abbr];
    const x = x0 + col * (tileW + gap), y = y0 + line * (tileH + gap);
    const t = hi === lo ? 0.5 : (row.v - lo) / (hi - lo);
    const fill = palette && thresholds ? thresholdColor(row.v, palette, thresholds) : mapColor(t, { palette, lowColor, highColor });
    const ink = readableInk(fill);
    s += `<rect x="${x}" y="${y}" width="${tileW}" height="${tileH}" rx="4" fill="${fill}" stroke="${C.surface}" stroke-width="2"/>`;
    s += `<text x="${x + tileW / 2}" y="${y + 21}" text-anchor="middle" font-size="15" font-weight="700" fill="${ink}">${esc(row.abbr)}</text>`;
    s += `<text x="${x + tileW / 2}" y="${y + 39}" text-anchor="middle" font-size="11" font-weight="600" fill="${ink}">${esc(fmtVal(row.v))}</text>`;
  }
  const labeled = palette && legendLabels?.length === palette.length;
  const legendX = labeled ? 560 : 730, legendY = 352, legendWidth = labeled ? 520 : 300;
  s += labeled
    ? labeledSegmentedLegend(palette, legendLabels, legendX, legendY, legendWidth, 12)
    : palette ? segmentedLegend(palette, legendX, legendY, legendWidth, 12) : `<rect x="${legendX}" y="${legendY}" width="${legendWidth}" height="12" rx="6" fill="url(#mapScale)"/>`;
  if (!labeled) {
    s += `<text x="${legendX}" y="${legendY + 31}" font-size="13" fill="${C.muted}">${esc(fmtVal(lo))}</text>`;
    s += `<text x="${legendX + legendWidth}" y="${legendY + 31}" text-anchor="end" font-size="13" fill="${C.muted}">${esc(fmtVal(hi))}</text>`;
  }
  s += `<text x="24" y="383" font-size="13" fill="${C.muted}">Equal-size state tiles; color represents value, not land area.</text>`;
  return `<svg viewBox="0 0 ${PW} ${PH}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}

// Real geographic US state outline map (actual state border shapes, Albers
// USA composite layout — continental US + Alaska/Hawaii insets) as a
// drop-in alternative to stateTileMap() above: same input shape
// (rows[].abbr/.v), same color-scale approach (colorBetween), same bottom
// gradient legend bar, same PW/PH viewBox. DC is rendered as a small circle
// marker near its real location since its shape is too tiny to render at
// this scale. Shape data is static (baked into us-state-paths.mjs) — no
// runtime network fetch.
export function stateOutlineMap(rows, { fmtVal, lowColor, highColor, palette = STATE_MAP_PALETTE }) {
  if (lowColor && highColor && palette === STATE_MAP_PALETTE) palette = null;
  lowColor ||= "#e8f1fb";
  highColor ||= "#1769c2";
  const byAbbr = new Map(rows.filter((row) => Number.isFinite(row.v)).map((row) => [row.abbr, row.v]));
  const values = [...byAbbr.values()];
  const lo = Math.min(...values), hi = Math.max(...values);
  const noDataFill = "#dedcd4";

  // Fit the native 960x600 Albers projection space into a plot area within
  // our 1104x400 viewBox, leaving room below for the legend bar/caption
  // (mirrors stateTileMap's legendY=352 / caption y=383 footer band).
  const [bx0, by0, bx1, by1] = STATE_PATHS_BBOX;
  const bboxW = bx1 - bx0, bboxH = by1 - by0;
  const targetX0 = 20, targetY0 = 14, targetX1 = PW - 20, targetY1 = 336;
  const targetW = targetX1 - targetX0, targetH = targetY1 - targetY0;
  const scale = Math.min(targetW / bboxW, targetH / bboxH);
  const tx = targetX0 + (targetW - bboxW * scale) / 2 - bx0 * scale;
  const ty = targetY0 + (targetH - bboxH * scale) / 2 - by0 * scale;

  const fillFor = (abbr) => {
    const v = byAbbr.get(abbr);
    if (!Number.isFinite(v)) return noDataFill;
    const t = hi === lo ? 0.5 : (v - lo) / (hi - lo);
    return mapColor(t, { palette, lowColor, highColor });
  };

  let s = `<defs><linearGradient id="mapScaleOutline"><stop offset="0" stop-color="${lowColor}"/><stop offset="1" stop-color="${highColor}"/></linearGradient></defs>`;
  s += `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(4)})">`;
  for (const abbr of Object.keys(STATE_PATHS)) {
    const fill = fillFor(abbr);
    const name = esc(abbr);
    s += `<path d="${STATE_PATHS[abbr]}" fill="${fill}" stroke="${C.surface}" stroke-width="1" vector-effect="non-scaling-stroke"><title>${name}${byAbbr.has(abbr) ? `: ${esc(fmtVal(byAbbr.get(abbr)))}` : ""}</title></path>`;
  }
  // Abbreviation labels for states whose on-screen shape is big enough.
  for (const abbr of STATE_LABEL_ABBRS) {
    const [cx, cy] = STATE_CENTROIDS[abbr];
    const v = byAbbr.get(abbr);
    const t = Number.isFinite(v) ? (hi === lo ? 0.5 : (v - lo) / (hi - lo)) : 0;
    const ink = byAbbr.has(abbr) ? readableInk(fillFor(abbr)) : C.ink;
    s += `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="${(11 / scale).toFixed(1)}" font-weight="700" fill="${ink}">${esc(abbr)}</text>`;
  }
  // DC marker — too small to show as a filled shape at this scale.
  {
    const [dx, dy] = DC_POINT;
    const fill = fillFor("DC");
    s += `<circle cx="${dx}" cy="${dy}" r="${(4 / scale).toFixed(1)}" fill="${fill}" stroke="${C.surface}" stroke-width="1" vector-effect="non-scaling-stroke"><title>DC${byAbbr.has("DC") ? `: ${esc(fmtVal(byAbbr.get("DC")))}` : ""}</title></circle>`;
  }
  s += `</g>`;

  const legendX = 730, legendY = 352;
  s += palette ? segmentedLegend(palette, legendX, legendY, 300, 12) : `<rect x="${legendX}" y="${legendY}" width="300" height="12" rx="6" fill="url(#mapScaleOutline)"/>`;
  s += `<text x="${legendX}" y="${legendY + 31}" font-size="13" fill="${C.muted}">${esc(fmtVal(lo))}</text>`;
  s += `<text x="${legendX + 300}" y="${legendY + 31}" text-anchor="end" font-size="13" fill="${C.muted}">${esc(fmtVal(hi))}</text>`;
  s += `<text x="24" y="383" font-size="13" fill="${C.muted}">DC shown as a marker near its real location (too small to render at this scale).</text>`;
  return `<svg viewBox="0 0 ${PW} ${PH}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}

export function donutChart(rows, { fmtVal, centerTop = "", centerBottom = "" }) {
  const palette = ["#2a78d6", "#1baf7a", "#e34948", "#e0a429", "#6d62c7", "#2f9da8", "#d66b9a", "#8a8a84"];
  const usable = rows.filter((row) => Number.isFinite(row.v) && row.v > 0);
  const total = usable.reduce((sum, row) => sum + row.v, 0);
  const cx = 225, cy = 194, radius = 126, circumference = 2 * Math.PI * radius;
  let offset = 0, s = "";
  usable.forEach((row, index) => {
    const share = row.v / total, length = share * circumference, color = row.color || palette[index % palette.length];
    s += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${color}" stroke-width="54" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += length;
  });
  s += `<circle cx="${cx}" cy="${cy}" r="88" fill="${C.surface}"/>`;
  s += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="25" font-weight="700" fill="${C.ink}">${esc(centerTop)}</text>`;
  s += `<text x="${cx}" y="${cy + 24}" text-anchor="middle" font-size="14" fill="${C.muted}">${esc(centerBottom)}</text>`;
  usable.forEach((row, index) => {
    const y = 42 + index * 43, color = row.color || palette[index % palette.length], share = row.v / total * 100;
    s += `<rect x="455" y="${y - 14}" width="14" height="14" rx="3" fill="${color}"/>`;
    s += `<text x="480" y="${y}" font-size="16" font-weight="600" fill="${C.ink2}">${esc(row.label)}</text>`;
    s += `<text x="1010" y="${y}" text-anchor="end" font-size="16" font-weight="650" fill="${C.ink}">${esc(`${fmtVal(row.v)} · ${share.toFixed(1)}%`)}</text>`;
  });
  return `<svg viewBox="0 0 ${PW} ${PH}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}

export const legend = (items) => `<div class="legend">${items.map((it) =>
  `<span class="key"><span class="dot" style="background:${it.color}"></span>${esc(it.name)}</span>`).join("")}</div>`;

// ── table output (terminal preview + .csv export) ────────────────────────────
export const rpad = (s, n) => String(s).slice(0, n).padEnd(n);
export const lpad = (s, n) => String(s).padStart(n);

export function csvEscape(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCSV(columns, rows) {
  return [columns, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";
}

// ── engagement close (comment + share prompts) ───────────────────────────
// A closing line every caption should end with — Facebook's algorithm and
// basic word-of-mouth both reward comments/shares, and a post that just ends
// on a source link asks the reader for nothing. Pick by "kind" so the prompt
// actually fits the content (a ranking invites "where do you rank"; a
// cost/trend post invites "does this match your own bill"). Deterministic
// rotation (by a caller-supplied seed, e.g. the post's date or slug) rather
// than Math.random() — scripts must stay reproducible/resumable.
const ENGAGEMENT_PROMPTS = {
  ranking: [
    "Surprised by who's at the top (or bottom) of this list? Say so in the comments.",
    "Does this ranking match what you expected? Comment below.",
    "Tag someone who'd be surprised by where they land on this list.",
  ],
  cost: [
    "Does this match what you're actually paying? Tell me in the comments.",
    "How does your own number compare to this? Comment below.",
    "If this number surprised you, share it with someone it'll surprise too.",
  ],
  trend: [
    "What do you think is driving this trend? Comment your take.",
    "Does this match what you've noticed personally? Let me know below.",
    "Share this if the trend surprised you.",
  ],
  generic: [
    "What's your take? Comment below.",
    "Know someone who'd find this surprising? Share it with them.",
    "Questions about the data or the source? Ask in the comments.",
  ],
};

export function engagementCTA(kind = "generic", seed = "") {
  const prompts = ENGAGEMENT_PROMPTS[kind] || ENGAGEMENT_PROMPTS.generic;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return prompts[h % prompts.length];
}

// Terminal preview: right-aligns numeric-looking cells. Pass unlimited=true
// (e.g. when the caller explicitly asked for a specific window, like
// --years) to print every row instead of truncating to MAX_ROWS — the .csv
// written alongside always has every row regardless.
export function printTable(title, columns, rows, source, unlimited = false) {
  const MAX_ROWS = unlimited ? rows.length : 120;
  const shown = rows.slice(-MAX_ROWS);
  const widths = columns.map((c, i) =>
    Math.max(c.length, ...shown.map((r) => String(r[i]).length)));
  const numeric = columns.map((_, i) => shown.every((r) => /^-?[\d.,$%×"]+$/.test(String(r[i]))));
  const line = (cells) => "  " + cells.map((c, i) =>
    numeric[i] ? lpad(c, widths[i]) : rpad(c, widths[i])).join("  |  ");

  const rowNote = rows.length > MAX_ROWS
    ? `last ${MAX_ROWS} of ${rows.length} rows — full set in the .csv`
    : `${rows.length} row${rows.length === 1 ? "" : "s"}`;
  console.log(`\n  ── ${title} — DATA TABLE (${rowNote}) ──`);
  console.log(line(columns));
  console.log("  " + widths.map((w) => "─".repeat(w)).join("──┼──"));
  for (const r of shown) console.log(line(r.map(String)));
  console.log(`  Source: ${source}`);
}

// ── the card (1200x675, light mode — a social image ships in one mode) ───────
// heroTrend (optional, opt-in — omit for the exact prior look): a small
// colored status arrow beside the hero number. { direction: "up"|"down",
// tone: "good"|"bad" } — tone picks the color (skill's reserved status
// green vs. the existing diverging red), not the direction, since "up" is
// good for some metrics (wages) and bad for others (debt) — callers decide.
const TREND_ARROW = { up: "▲", down: "▼" };
const TREND_COLOR = { good: "#0ca30c", bad: C.neg };

export function cardHTML({
  kicker, title, hero, heroLabel, legendHTML = "", chartSVG, source, vintage, heroTrend = null,
  brand = C.brand, wordmark = "America by the Numbers", authorInitials = "JM", authorName = "Jeff Macy",
}) {
  const deltaHTML = heroTrend
    ? `<span class="delta" style="color:${TREND_COLOR[heroTrend.tone]}">${TREND_ARROW[heroTrend.direction]}</span>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1200px; height:675px; background:${C.surface}; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; display:flex; flex-direction:column; }
  .accent-top { height:4px; background:${brand}; flex-shrink:0; }
  .header { background:${C.surface}; height:64px; flex-shrink:0; display:flex; align-items:center; padding:0 40px; gap:12px; border-bottom:1px solid ${C.grid}; }
  .header .wordmark-wrap { display:flex; flex-direction:column; gap:3px; }
  .header .wordmark { color:${brand}; font-size:15px; font-weight:800; letter-spacing:0.1em; text-transform:uppercase; }
  .header .rule { width:28px; height:2px; background:${brand}; }
  .brand-mark-img { width:48px; height:48px; display:block; object-fit:contain; }
  .avatar-img { width:26px; height:26px; border-radius:50%; display:block; }
  .card { flex:1; min-height:0; padding:20px 40px 14px; display:flex; flex-direction:column; overflow:hidden; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; flex-shrink:0; }
  .kicker { font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${C.muted}; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-size:28px; font-weight:700; color:${C.ink}; margin-top:6px; max-width:700px; line-height:1.2; }
  .hero { text-align:right; flex-shrink:0; }
  .hero-row { display:flex; align-items:baseline; justify-content:flex-end; gap:10px; }
  .hero .v { font-size:48px; font-weight:800; color:${brand}; line-height:1; }
  .delta { font-size:18px; font-weight:700; }
  .hero .l { font-size:14px; color:${C.ink2}; margin-top:6px; max-width:260px; }
  .legend { display:flex; gap:24px; margin-top:14px; flex-shrink:0; }
  .key { display:flex; align-items:center; gap:8px; font-size:15px; color:${C.ink2}; }
  .dot { width:12px; height:12px; border-radius:50%; display:inline-block; }
  .plotbox { flex:1; min-height:0; margin-top:14px; background:#fff; border:1px solid ${C.grid}; border-radius:14px; padding:16px 20px 10px; }
  .plotbox svg { width:100%; height:100%; }
  .footer { background:${brand}; height:48px; flex-shrink:0; display:flex; align-items:center; justify-content:space-between; padding:0 40px; margin-top:14px; }
  .footer-left { display:flex; align-items:center; gap:10px; }
  .avatar { width:26px; height:26px; border-radius:50%; border:1.5px solid ${C.brandText}; display:flex; align-items:center; justify-content:center; color:${C.brandText}; font-size:10px; font-weight:700; }
  .footer-text { color:${C.brandText}; font-size:12px; line-height:1.3; }
  .footer-right { display:flex; align-items:center; gap:8px; color:${C.brandText}; font-size:12px; }
  .footer-right b { color:#fff; }
  </style></head><body>
  <div class="accent-top"></div>
  <div class="header"><span class="mark">${abnLogoDataUri() ? `<img class="brand-mark-img" src="${abnLogoDataUri()}" alt="">` : iconSVG("building", brand)}</span><div class="wordmark-wrap"><span class="wordmark">${esc(wordmark)}</span><span class="rule"></span></div></div>
  <div class="card">
    <div class="head">
      <div><div class="kicker">${esc(kicker)}</div><h1>${esc(title)}</h1></div>
      <div class="hero"><div class="hero-row">${deltaHTML}<div class="v">${esc(hero)}</div></div><div class="l">${esc(heroLabel)}</div></div>
    </div>
    ${legendHTML}
    <div class="plotbox">${chartSVG}</div>
  </div>
  <div class="footer">
    <div class="footer-left">${logoDataUri() ? `<img class="avatar-img" src="${logoDataUri()}" alt="">` : `<div class="avatar">${esc(authorInitials)}</div>`}<div class="footer-text">Source: ${esc(source)}<br>Chart: ${esc(authorName)}</div></div>
    <div class="footer-right">${iconSVG("calendar", C.brandText)}<span>Data through <b>${esc(vintage)}</b></span></div>
  </div>
  </body></html>`;
}

// ── branded metric-list card (1200x675) ───────────────────────────────────
// A richer alternative to cardHTML for "several standalone numbers, each
// worth its own row" stories (vs. cardHTML's single ranked bar chart): a
// branded header/footer, a hero stat tile, one icon+bar per metric with
// categorical color carrying identity (dataviz skill's validated 8-hue
// order, C.cat — never invented per-row), an optional group divider, and up
// to 3 callout insights. Bar length is one shared scale across every row
// (dataviz skill's "one axis" rule) — don't mix units within a single card.
const ICONS = {
  globe: '<circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 10h16M10 2c2.5 2.2 2.5 13.8 0 16M10 2c-2.5 2.2-2.5 13.8 0 16" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  // True-color mini US flag (not currentColor — a flag only reads as "US" in
  // its real red/white/blue, not tinted to whatever the row's category hue is).
  flag: '<rect x="2" y="4" width="16" height="12" rx="1" fill="#fff" stroke="#00000022" stroke-width="0.5"/><g clip-path="url(#flagclip)"><rect x="2" y="4" width="16" height="1.71" fill="#B22234"/><rect x="2" y="7.43" width="16" height="1.71" fill="#B22234"/><rect x="2" y="10.86" width="16" height="1.71" fill="#B22234"/><rect x="2" y="14.29" width="16" height="1.71" fill="#B22234"/><rect x="2" y="4" width="7.5" height="8.57" fill="#3C3B6E"/><circle cx="3.6" cy="5.4" r="0.45" fill="#fff"/><circle cx="5.6" cy="5.4" r="0.45" fill="#fff"/><circle cx="7.6" cy="5.4" r="0.45" fill="#fff"/><circle cx="4.6" cy="7" r="0.45" fill="#fff"/><circle cx="6.6" cy="7" r="0.45" fill="#fff"/><circle cx="3.6" cy="8.6" r="0.45" fill="#fff"/><circle cx="5.6" cy="8.6" r="0.45" fill="#fff"/><circle cx="7.6" cy="8.6" r="0.45" fill="#fff"/><circle cx="4.6" cy="10.2" r="0.45" fill="#fff"/><circle cx="6.6" cy="10.2" r="0.45" fill="#fff"/></g><rect x="2" y="4" width="16" height="12" rx="1" fill="none" stroke="#00000030" stroke-width="0.6"/><clipPath id="flagclip"><rect x="2" y="4" width="16" height="12" rx="1"/></clipPath>',
  trend: '<path d="M3 14l5-5 4 3 5-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 5h4v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  percent: '<circle cx="6" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="14" cy="14" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15 3L3 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  doc: '<path d="M5 2h7l3 3v13H5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 2v3h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7 10h6M7 13h6M7 16h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  building: '<path d="M3 18V5l7-3 7 3v13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M3 18h14M7 8h2M11 8h2M7 12h2M11 12h2M9 18v-4h2v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  calendar: '<rect x="3" y="4" width="14" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 8h14M7 2v4M13 2v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
};

function iconSVG(icon, color) {
  if (icon === "flag") return `<svg viewBox="0 0 20 20" width="20" height="20">${ICONS.flag}</svg>`; // true-color, ignores row hue
  if (ICONS[icon]) return `<svg viewBox="0 0 20 20" width="20" height="20" color="${color}">${ICONS[icon]}</svg>`;
  // Short text badge (e.g. "IPO", "%") when no glyph fits — same slot as an icon.
  return `<span style="font-size:11px;font-weight:800;color:${color};letter-spacing:0.02em">${esc(icon)}</span>`;
}

export function metricListCard({
  title, subtitle = "", heroLabel, heroValue, heroSub = "",
  rows, dividerAfterIndex = null, callouts = [],
  source, vintage, brand = C.brand, wordmark = "America by the Numbers",
  authorInitials = "JM", authorName = "Jeff Macy",
}) {
  const max = Math.max(...rows.map((r) => r.value));
  const barMaxWidth = 560; // px, inside the plot column
  const rowsHTML = rows.map((r, i) => {
    const color = r.color || C.cat[0];
    const bw = Math.max((r.value / max) * barMaxWidth, 6);
    const divider = dividerAfterIndex === i ? `<div class="row-divider"></div>` : "";
    return `<div class="row">
      <div class="row-icon" style="background:${color}1f"><div style="color:${color}">${iconSVG(r.icon || "trend", color)}</div></div>
      <div class="row-label">${esc(r.label)}</div>
      <div class="row-bar-track"><div class="row-bar" style="width:${bw}px;background:${color}"></div></div>
      <div class="row-value" style="color:${color}">${esc(r.value_display ?? r.value)}</div>
    </div>${divider}`;
  }).join("");

  const calloutsHTML = callouts.length ? `<div class="callouts">${callouts.map((c) => `
    <div class="callout"><div class="callout-icon" style="color:${brand}">${iconSVG(c.icon || "trend", brand)}</div><div class="callout-text">${c.html}</div></div>
  `).join("")}</div>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1200px; height:675px; background:${C.surface}; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; display:flex; flex-direction:column; }
  .accent-top { height:4px; background:${brand}; flex-shrink:0; }
  .header { background:${C.surface}; height:64px; flex-shrink:0; display:flex; align-items:center; padding:0 40px; gap:12px; border-bottom:1px solid ${C.grid}; }
  .header .wordmark-wrap { display:flex; flex-direction:column; gap:3px; }
  .header .wordmark { color:${brand}; font-size:15px; font-weight:800; letter-spacing:0.1em; text-transform:uppercase; }
  .header .rule { width:28px; height:2px; background:${brand}; }
  .header .mark { color:${brand}; }
  .logo-img { width:30px; height:30px; border-radius:50%; display:block; }
  .brand-mark-img { width:48px; height:48px; display:block; object-fit:contain; }
  .avatar-img { width:26px; height:26px; border-radius:50%; display:block; }
  .body { flex:1; min-height:0; padding:16px 40px 12px; display:flex; flex-direction:column; overflow:hidden; }
  .top { display:flex; justify-content:space-between; align-items:flex-start; gap:24px; flex-shrink:0; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-size:33px; font-weight:700; color:${C.ink}; line-height:1.22; max-width:640px; }
  .subtitle { font-size:16px; color:${C.ink2}; margin-top:8px; }
  .hero-tile { background:linear-gradient(180deg, #12503c 0%, ${brand} 55%); border-radius:16px; padding:20px 30px; text-align:center; min-width:320px; flex-shrink:0; }
  .hero-tile .label { color:${C.brandText}; font-size:12px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; }
  .hero-tile .value { color:#fff; font-size:64px; font-weight:800; line-height:1.1; margin-top:6px; }
  .hero-tile .sub-row { display:flex; align-items:center; gap:10px; margin-top:8px; }
  .hero-tile .sub-rule { flex:1; height:1px; background:linear-gradient(90deg, transparent, ${C.brandText}66); }
  .hero-tile .sub-rule.right { background:linear-gradient(270deg, transparent, ${C.brandText}66); }
  .hero-tile .sub { color:${C.brandText}; font-size:13px; flex-shrink:0; }
  .rows { margin-top:10px; background:#fff; border:1px solid ${C.grid}; border-radius:14px; padding:6px 28px; flex-shrink:0; }
  .row { display:flex; align-items:center; gap:16px; padding:6px 0; }
  .row-icon { width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .row-icon svg { width:19px; height:19px; }
  .row-label { font-size:16px; font-weight:700; color:${C.ink}; width:290px; flex-shrink:0; }
  .row-bar-track { flex:1; }
  .row-bar { height:15px; border-radius:5px; }
  .row-value { font-size:16px; font-weight:800; width:110px; text-align:right; flex-shrink:0; font-variant-numeric: tabular-nums; }
  .row-divider { border-top:1px solid ${C.grid}; margin:6px 0; }
  .callouts { display:flex; gap:20px; margin-top:8px; background:${C.surface}; border:1px solid ${C.grid}; border-radius:12px; padding:9px 24px; flex-shrink:0; }
  .callout { flex:1; display:flex; gap:12px; align-items:flex-start; }
  .callout-icon { flex-shrink:0; margin-top:1px; }
  .callout-icon svg { width:20px; height:20px; }
  .callout-text { font-size:14px; color:${C.ink2}; line-height:1.4; }
  .callout-text b { color:${C.ink}; }
  .footer { background:${brand}; height:48px; flex-shrink:0; display:flex; align-items:center; justify-content:space-between; padding:0 40px; }
  .footer-left { display:flex; align-items:center; gap:10px; }
  .avatar { width:26px; height:26px; border-radius:50%; border:1.5px solid ${C.brandText}; display:flex; align-items:center; justify-content:center; color:${C.brandText}; font-size:10px; font-weight:700; }
  .footer-text { color:${C.brandText}; font-size:12px; line-height:1.3; }
  .footer-right { display:flex; align-items:center; gap:8px; color:${C.brandText}; font-size:12px; }
  .footer-right b { color:#fff; }
  </style></head><body>
  <div class="accent-top"></div>
  <div class="header"><span class="mark">${abnLogoDataUri() ? `<img class="brand-mark-img" src="${abnLogoDataUri()}" alt="">` : iconSVG("building", brand)}</span><div class="wordmark-wrap"><span class="wordmark">${esc(wordmark)}</span><span class="rule"></span></div></div>
  <div class="body">
    <div class="top">
      <div><h1>${esc(title)}</h1>${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ""}</div>
      <div class="hero-tile"><div class="label">${esc(heroLabel)}</div><div class="value">${esc(heroValue)}</div>${heroSub ? `<div class="sub-row"><span class="sub-rule"></span><span class="sub">${esc(heroSub)}</span><span class="sub-rule right"></span></div>` : ""}</div>
    </div>
    <div class="rows">${rowsHTML}</div>
    ${calloutsHTML}
  </div>
  <div class="footer">
    <div class="footer-left">${logoDataUri() ? `<img class="avatar-img" src="${logoDataUri()}" alt="">` : `<div class="avatar">${esc(authorInitials)}</div>`}<div class="footer-text">Source: ${esc(source)}<br>Chart: ${esc(authorName)}</div></div>
    <div class="footer-right">${iconSVG("calendar", C.brandText)}<span>Data through <b>${esc(vintage)}</b></span></div>
  </div>
  </body></html>`;
}

// ── the comparison table card (1200x675) ──────────────────────────────────
// For "many labeled rows that each carry meaning" data (dataviz skill:
// choosing-a-form.md — a table, not a chart, once you're past ~7 classes).
// Two value columns (e.g. two years) get fixed categorical colors in their
// header only; every cell is a direct-labeled number, which is what the
// skill requires as the mitigation for C.s2's sub-3:1 contrast WARN.
export function tableCard({
  kicker, title, subtitle = "", rows, columnLabels, columnColors = [C.s1, C.s2], source, vintage, footnote = "",
  brand = C.brand, wordmark = "America by the Numbers", authorInitials = "JM", authorName = "Jeff Macy",
}) {
  const headCells = columnLabels.map((label, i) =>
    `<th style="background:${columnColors[i]}">${esc(label)}</th>`).join("");
  const bodyRows = rows.map((row) =>
    `<tr><td class="item">${esc(row.label)}</td>${row.values.map((v) => `<td class="val">${esc(v)}</td>`).join("")}</tr>`
  ).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1200px; height:675px; background:${C.surface}; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; display:flex; flex-direction:column; }
  .accent-top { height:4px; background:${brand}; flex-shrink:0; }
  .header { background:${C.surface}; height:64px; flex-shrink:0; display:flex; align-items:center; padding:0 40px; gap:12px; border-bottom:1px solid ${C.grid}; }
  .header .wordmark-wrap { display:flex; flex-direction:column; gap:3px; }
  .header .wordmark { color:${brand}; font-size:15px; font-weight:800; letter-spacing:0.1em; text-transform:uppercase; }
  .header .rule { width:28px; height:2px; background:${brand}; }
  .brand-mark-img { width:48px; height:48px; display:block; object-fit:contain; }
  .avatar-img { width:26px; height:26px; border-radius:50%; display:block; }
  .card { flex:1; min-height:0; padding:20px 56px 14px; display:flex; flex-direction:column; overflow:hidden; }
  .kicker { font-size:14px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:${C.muted}; text-align:center; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-size:30px; font-weight:700; color:${C.ink}; margin-top:8px; text-align:center; }
  .subtitle { font-size:16px; color:${C.ink2}; margin-top:6px; text-align:center; }
  table { width:100%; table-layout:fixed; border-collapse:collapse; margin-top:20px; flex:1; }
  col.item-col { width:44%; }
  th { color:#fff; font-size:16px; font-weight:700; padding:10px 16px; text-align:center; }
  th:first-child { background:${C.surface} !important; color:${C.ink}; text-align:left; }
  td { padding:10px 16px; font-size:15px; border-bottom:1px solid ${C.grid}; }
  td.item { font-weight:600; color:${C.ink2}; }
  td.val { text-align:center; font-weight:650; color:${C.ink}; font-variant-numeric:tabular-nums; }
  .footnote { font-size:12px; color:${C.muted}; margin-top:10px; text-align:center; }
  .footer { background:${brand}; height:48px; flex-shrink:0; display:flex; align-items:center; justify-content:space-between; padding:0 40px; margin-top:12px; }
  .footer-left { display:flex; align-items:center; gap:10px; }
  .avatar { width:26px; height:26px; border-radius:50%; border:1.5px solid ${C.brandText}; display:flex; align-items:center; justify-content:center; color:${C.brandText}; font-size:10px; font-weight:700; }
  .footer-text { color:${C.brandText}; font-size:12px; line-height:1.3; }
  .footer-right { display:flex; align-items:center; gap:8px; color:${C.brandText}; font-size:12px; }
  .footer-right b { color:#fff; }
  </style></head><body>
  <div class="accent-top"></div>
  <div class="header"><span class="mark">${abnLogoDataUri() ? `<img class="brand-mark-img" src="${abnLogoDataUri()}" alt="">` : iconSVG("building", brand)}</span><div class="wordmark-wrap"><span class="wordmark">${esc(wordmark)}</span><span class="rule"></span></div></div>
  <div class="card">
    <div class="kicker">${esc(kicker)}</div>
    <h1>${esc(title)}</h1>
    ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ""}
    <table>
      <colgroup><col class="item-col">${columnLabels.map(() => "<col>").join("")}</colgroup>
      <thead><tr><th></th>${headCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    ${footnote ? `<div class="footnote">${esc(footnote)}</div>` : ""}
  </div>
  <div class="footer">
    <div class="footer-left">${logoDataUri() ? `<img class="avatar-img" src="${logoDataUri()}" alt="">` : `<div class="avatar">${esc(authorInitials)}</div>`}<div class="footer-text">Source: ${esc(source)}<br>Chart: ${esc(authorName)}</div></div>
    <div class="footer-right">${iconSVG("calendar", C.brandText)}<span>Data through <b>${esc(vintage)}</b></span></div>
  </div>
  </body></html>`;
}

// ISO 3166-1 alpha-2 code → Unicode regional-indicator flag emoji (e.g. "US" → 🇺🇸).
// Kept for callers that render in an environment with real flag-emoji font
// support; headless Chromium on Windows does NOT reliably have it (renders
// bare "US" letter tiles instead), so screenshot-rendered cards should use
// flagDataUri() below instead.
export function flagEmoji(iso2) {
  if (!iso2 || iso2.length !== 2) return "🏳️";
  return String.fromCodePoint(...[...iso2.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Fetch a small flag PNG (flagcdn.com, free/keyless) ONCE per code, cached to
// disk forever after. Screenshot rendering must not depend on live network
// fetches mid-render (40 concurrent external image loads racing the render
// timeout is exactly the kind of flakiness this avoids) — so callers should
// resolve every flag to a data: URI up front, then hand cardHTML/template
// functions the already-embedded string, not a remote src.
const FLAG_CACHE_DIR = path.join(os.tmpdir(), "fiscal-toolkit-flag-cache");
export async function flagDataUri(iso2) {
  if (!iso2 || iso2.length !== 2) return "";
  const code = iso2.toLowerCase();
  mkdirSync(FLAG_CACHE_DIR, { recursive: true });
  const cachePath = path.join(FLAG_CACHE_DIR, `${code}.png`);
  if (!existsSync(cachePath)) {
    const res = await fetch(`https://flagcdn.com/24x18/${code}.png`);
    if (!res.ok) return "";
    writeFileSync(cachePath, Buffer.from(await res.arrayBuffer()));
  }
  return `data:image/png;base64,${readFileSync(cachePath).toString("base64")}`;
}

// Resolve flagDataUri() for every row in one batch (dedup + parallel fetch),
// returning a Map<iso2, dataUri> for callers to attach before building HTML.
export async function flagDataUriMap(iso2Codes) {
  const unique = [...new Set(iso2Codes.filter(Boolean).map((c) => c.toLowerCase()))];
  const entries = await Promise.all(unique.map(async (code) => [code, await flagDataUri(code)]));
  return new Map(entries);
}

// A tall "best vs. worst" ranked infographic — full-length lists side by
// side (Visual-Capitalist-style), not a top-10 cutoff. Each row: flag, rank,
// name, proportional bar, value. Bar length is scaled from a shared [domainMin,
// domainMax] across BOTH columns so left/right stay honestly comparable —
// not independently rescaled per column, which would exaggerate small gaps.
export function rankedTwoColumnHTML({
  kicker, title, leftLabel, rightLabel, leftRows, rightRows,
  domainMin, domainMax, fmtVal, source, vintage, accent = C.s1, accent2 = C.neg, showFlags = true,
}) {
  const rowH = 34;
  const rows = Math.max(leftRows.length, rightRows.length);
  const bodyH = rows * rowH + 40;
  const height = 210 + bodyH + 60;

  const barPct = (v) => `${Math.max(2, Math.min(100, ((v - domainMin) / (domainMax - domainMin)) * 100))}%`;

  // Flag emoji font support is unreliable in headless Chromium on Windows
  // (renders as bare "US" letter codes instead of a flag glyph), so rows use
  // a pre-resolved data: URI (see flagDataUri/flagDataUriMap) instead of a
  // font glyph OR a live network src — screenshot rendering must not depend
  // on network fetches mid-render. showFlags:false skips the image entirely
  // (e.g. US-state rankings, where there's no equivalent flag convention).
  const column = (rows, color) => rows.map((r, i) => `
    <div class="row">
      <span class="rank">${i + 1}</span>
      ${showFlags ? `<img class="flag" src="${r.flagSrc || ""}" width="24" height="18" alt="" />` : ""}
      <span class="name" style="${showFlags ? "" : "width:182px"}">${esc(r.name)}</span>
      <span class="bar-track"><span class="bar" style="width:${barPct(r.value)};background:${r.color || color}"></span></span>
      <span class="val">${esc(fmtVal(r.value))}</span>
    </div>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1200px; height:${height}px; background:${C.surface};
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .card { width:100%; height:100%; padding:44px 48px 36px; display:flex; flex-direction:column; }
  .kicker { font-size:15px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:${C.muted}; }
  h1 { font-size:32px; font-weight:650; color:${C.ink}; margin-top:8px; max-width:1080px; line-height:1.2; }
  .cols { display:flex; gap:32px; margin-top:26px; }
  .col { flex:1; min-width:0; }
  .col-head { font-size:17px; font-weight:700; color:${C.ink}; padding-bottom:8px; border-bottom:2px solid ${C.grid}; margin-bottom:6px; }
  .row { display:flex; align-items:center; height:${rowH}px; gap:8px; font-size:14px; }
  .rank { width:20px; color:${C.muted}; font-weight:600; text-align:right; flex-shrink:0; }
  .flag { flex-shrink:0; width:24px; height:18px; object-fit:cover; border-radius:2px; box-shadow:0 0 0 1px rgba(0,0,0,0.08); }
  .name { width:150px; flex-shrink:0; color:${C.ink2}; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bar-track { flex:1; height:14px; background:${C.grid}; border-radius:7px; overflow:hidden; }
  .bar { display:block; height:100%; border-radius:7px; }
  .val { width:52px; flex-shrink:0; text-align:right; font-weight:700; color:${C.ink}; font-variant-numeric:tabular-nums; }
  .foot { display:flex; justify-content:space-between; font-size:15px; color:${C.muted}; margin-top:20px; }
  </style></head><body><div class="card">
    <div class="kicker">${esc(kicker)}</div>
    <h1>${esc(title)}</h1>
    <div class="cols">
      <div class="col"><div class="col-head">${esc(leftLabel)}</div>${column(leftRows, accent)}</div>
      <div class="col"><div class="col-head">${esc(rightLabel)}</div>${column(rightRows, accent2)}</div>
    </div>
    <div class="foot"><span>Source: ${esc(source)} · Chart: Jeff Macy</span><span>Data through ${esc(vintage)}</span></div>
  </div></body></html>`;
}

// ── PNG via headless Edge/Chrome ──────────────────────────────────────────────
export function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

export function screenshot(htmlPath, pngPath, { width = 1200, height = 675 } = {}) {
  const browser = findBrowser();
  if (!browser) {
    console.log("  ! No Edge/Chrome found for PNG rendering (set BROWSER_PATH). HTML card was still written.");
    return false;
  }
  const profile = path.join(os.tmpdir(), `digest-shot-profile-${process.pid}-${Date.now()}`);
  const renderPath = `${pngPath}.render-${process.pid}-${Date.now()}.png`;
  for (const headless of ["--headless=new", "--headless"]) {
    try {
      execFileSync(browser, [
        headless, "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${profile}`,
        `--window-size=${width},${height}`, `--screenshot=${renderPath}`, `file:///${htmlPath.replace(/\\/g, "/")}`,
      ], { stdio: "ignore", timeout: 60000 });
    } catch { /* try older headless flag */ }
    // Edge can hand rendering to a child process and return before the PNG is
    // flushed. Wait briefly for a new file instead of reporting a false failure.
    for (let attempt = 0; attempt < 50; attempt++) {
      if (existsSync(renderPath) && statSync(renderPath).size > 0) {
        if (existsSync(pngPath)) unlinkSync(pngPath);
        renameSync(renderPath, pngPath);
        return true;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  console.log("  ! PNG render failed; the HTML card was still written.");
  return false;
}
