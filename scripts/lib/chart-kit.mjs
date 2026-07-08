// chart-kit.mjs — shared data-fetch, formatting, SVG chart, HTML card, and
// PNG-render helpers used by weekly-digest.mjs and the standalone "index"
// scripts (cost-of-living-index.mjs, arizona-economy.mjs, etc.) so every
// social card looks and behaves the same way, from one source of truth.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

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
    if (i % labelStep === 0 || i === n - 1)
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
  const labelW = 300, rightW = 118, top = 18, rowH = 38, barH = 20;
  const w = PW, h = top + points.length * rowH + 34;
  const max = Math.max(...points.map((p) => p.v));
  const ticks = niceTicks(0, max, 4).filter((t) => t >= 0);
  const x0 = labelW, x1 = w - rightW;
  const xOf = (v) => x0 + (x1 - x0) * (v / ticks[ticks.length - 1]);
  let s = "";
  for (const t of ticks) {
    const x = xOf(t);
    s += `<line x1="${x}" y1="${top - 6}" x2="${x}" y2="${h - 30}" stroke="${C.grid}" stroke-width="1"/>`;
    s += `<text x="${x}" y="${h - 8}" text-anchor="middle" font-size="14" fill="${C.muted}">${esc(fmtTick(t))}</text>`;
  }
  points.forEach((p, i) => {
    const y = top + i * rowH;
    const bw = Math.max(xOf(p.v) - x0, 2);
    s += `<text x="0" y="${y + 20}" font-size="17" font-weight="600" fill="${C.ink2}">${esc(p.label)}</text>`;
    s += `<rect x="${x0}" y="${y + 2}" width="${bw}" height="${barH}" rx="4" fill="${p.color || C.s1}"/>`;
    s += `<text x="${x0 + bw + 10}" y="${y + 18}" font-size="16" font-weight="650" fill="${C.ink}">${esc(fmtVal(p.v))}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
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
export function cardHTML({ kicker, title, hero, heroLabel, legendHTML = "", chartSVG, source, vintage }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1200px; height:675px; background:${C.surface};
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .card { width:100%; height:100%; padding:44px 48px 36px; display:flex; flex-direction:column; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; }
  .kicker { font-size:15px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:${C.muted}; }
  h1 { font-size:33px; font-weight:650; color:${C.ink}; margin-top:10px; max-width:760px; line-height:1.2; }
  .hero { text-align:right; }
  .hero .v { font-size:56px; font-weight:650; color:${C.ink}; line-height:1; }
  .hero .l { font-size:16px; color:${C.ink2}; margin-top:6px; }
  .legend { display:flex; gap:24px; margin-top:18px; }
  .key { display:flex; align-items:center; gap:8px; font-size:16px; color:${C.ink2}; }
  .dot { width:12px; height:12px; border-radius:50%; display:inline-block; }
  .plot { flex:1; margin-top:8px; }
  .plot svg { width:100%; height:100%; }
  .foot { display:flex; justify-content:space-between; font-size:15px; color:${C.muted}; }
  </style></head><body><div class="card">
    <div class="head">
      <div><div class="kicker">${esc(kicker)}</div><h1>${esc(title)}</h1></div>
      <div class="hero"><div class="v">${esc(hero)}</div><div class="l">${esc(heroLabel)}</div></div>
    </div>
    ${legendHTML}
    <div class="plot">${chartSVG}</div>
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

export function screenshot(htmlPath, pngPath) {
  const browser = findBrowser();
  if (!browser) {
    console.log("  ! No Edge/Chrome found for PNG rendering (set BROWSER_PATH). HTML card was still written.");
    return false;
  }
  const profile = path.join(os.tmpdir(), "digest-shot-profile");
  for (const headless of ["--headless=new", "--headless"]) {
    try {
      execFileSync(browser, [
        headless, "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${profile}`,
        "--window-size=1200,675", `--screenshot=${pngPath}`, `file:///${htmlPath.replace(/\\/g, "/")}`,
      ], { stdio: "ignore", timeout: 60000 });
      if (existsSync(pngPath)) return true;
    } catch { /* try older headless flag */ }
  }
  console.log("  ! PNG render failed; the HTML card was still written.");
  return false;
}
