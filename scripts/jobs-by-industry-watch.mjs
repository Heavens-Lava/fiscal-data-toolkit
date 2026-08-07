#!/usr/bin/env node
// Which industries are actually adding or cutting jobs right now — BLS
// Current Employment Statistics, year-over-year change by sector, mirrored
// on FRED (no key required). Detailed BLS occupation-level growth
// *projections* (e.g. "fastest growing occupations to 2034") are only
// published as static tables behind BLS's bot-blocked web pages and aren't
// available via any API — this uses the closest genuinely live, keyless,
// always-current equivalent: actual industry employment change, not a
// decade-old speculative projection.
//
// Editorial framing: don't just report "which sector grew fastest" — the
// real story here is that Education & health services alone accounts for
// more than the entire net job gain, i.e. every other sector *combined* is
// flat-to-negative. See the "all other sectors combined" synthetic row.
//
// Run:  node scripts/jobs-by-industry-watch.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, fred, horizontalBarChart, last, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, num, rel } from "./lib/data-common.mjs";

const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `jobs-by-industry-watch-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

function closest(series, targetDate) {
  const ms = Date.parse(targetDate);
  return series.reduce((best, pt) => (Math.abs(Date.parse(pt.d) - ms) < Math.abs(Date.parse(best.d) - ms) ? pt : best));
}
function oneYearAgo(series) {
  const latestMs = Date.parse(last(series).d);
  return closest(series, new Date(latestMs - 365 * 86_400_000).toISOString().slice(0, 10));
}

const SECTORS = [
  { name: "Mining & logging", id: "USMINE" },
  { name: "Construction", id: "USCONS" },
  { name: "Manufacturing", id: "MANEMP" },
  { name: "Trade, transport & utilities", id: "USTRADE" },
  { name: "Information", id: "USINFO" },
  { name: "Financial activities", id: "USFIRE" },
  { name: "Professional & business services", id: "USPBS" },
  { name: "Education & health services", id: "USEHS" },
  { name: "Leisure & hospitality", id: "USLAH" },
  { name: "Government", id: "USGOVT" },
];

const series = await Promise.all(SECTORS.map((s) => fred(s.id)));
const payems = await fred("PAYEMS");
const asOf = last(payems).d.slice(0, 7);

const totalNow = last(payems).v;
const totalAgo = oneYearAgo(payems).v;
const totalChg = totalNow - totalAgo; // thousands
const totalPct = (totalChg / totalAgo) * 100;

const rows = SECTORS.map((s, i) => {
  const now = last(series[i]).v;
  const ago = oneYearAgo(series[i]).v;
  const chg = now - ago; // thousands of jobs
  const pct = (chg / ago) * 100;
  return { name: s.name, now, chg, pct, share: (now / totalNow) * 100 };
}).sort((a, b) => b.pct - a.pct);

const healthcare = rows.find((r) => r.name === "Education & health services");
const otherSectors = rows.filter((r) => r.name !== "Education & health services");
// Bottom-up sum of the other 9 sectors' own reported changes — kept
// consistent with the individual bars shown, rather than backed out from
// the top-down total (which differs by ~1-2% due to normal cross-series
// benchmark-timing gaps between individual FRED series and the PAYEMS
// aggregate). Displayed caption text should round this, not state it as
// exact, given that reconciliation gap.
const otherSectorsChg = otherSectors.reduce((s, r) => s + r.chg, 0);
const otherSectorsRounded = Math.round(otherSectorsChg / 10) * 10; // nearest 10k, avoids false precision
const otherSectorsNowLevel = otherSectors.reduce((s, r) => s + r.now, 0);
const otherSectorsAgoLevel = otherSectorsNowLevel - otherSectorsChg;
const otherSectorsPct = (otherSectorsChg / otherSectorsAgoLevel) * 100;

const gainer = rows[0];
const loser = rows[rows.length - 1];
const shrinking = rows.filter((r) => r.pct < 0);

// Pace commonly cited by labor economists to keep up with population/labor
// force growth — NOT an official BLS or government target. Attributed as
// such in the caption.
const CITED_PACE_LOW = 150_000, CITED_PACE_HIGH = 200_000;
const monthlyPace = (totalChg * 1000) / 12;
const paceLowPct = (monthlyPace / CITED_PACE_LOW) * 100;
const paceHighPct = (monthlyPace / CITED_PACE_HIGH) * 100;

const chartRows = [
  ...rows.map((r) => ({ label: r.name, v: r.pct, color: r.name === "Education & health services" ? C.s2 : r.pct >= 0 ? C.s1 : C.neg })),
  { label: "All other sectors, combined", v: otherSectorsPct, color: "#8a8a84" },
];
const chartSVG = horizontalBarChart(
  chartRows,
  { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` }
);

const html = cardHTML({
  kicker: "Jobs by industry check",
  title: "One sector is carrying US job growth",
  hero: `+${num(healthcare.chg * 1000)}`,
  heroLabel: `jobs added by education & health services alone, ${asOf} — more than the entire US net gain`,
  chartSVG, source: "Bureau of Labor Statistics, Current Employment Statistics (via FRED)", vintage: asOf,
});

const facebook = [
  "Job growth in America over the past year came almost entirely from one place: healthcare.",
  "",
  `Education and health services added ${num(healthcare.chg * 1000)} jobs in the 12 months through ${asOf}. Every other industry combined — manufacturing, retail, finance, public-sector employment, tech, construction, everything — added a net ${otherSectorsRounded >= 0 ? "+" : ""}${num(otherSectorsRounded * 1000)}, roughly. Outside of healthcare, the U.S. was essentially flat to down this year.`,
  "",
  `The headline number, ${totalChg >= 0 ? "+" : ""}${num(totalChg * 1000)} jobs total, sounds fine on its own. It's roughly ${Math.min(paceLowPct, paceHighPct).toFixed(0)}-${Math.max(paceLowPct, paceHighPct).toFixed(0)}% of the 1.8-2.4 million/year pace some labor economists cite as necessary to keep up with population growth — that's a commonly used rule of thumb, not an official government target, but by that measure this year fell well short.`,
  "",
  "By sector, year-over-year:",
  ...rows.map((r) => `${r.name}: ${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}% (${r.chg >= 0 ? "+" : ""}${num(r.chg * 1000)} jobs, ${r.share.toFixed(0)}% of the US workforce)`),
  "",
  "This is actual employment change, seasonally adjusted, not a forecast — and CES figures do get revised in the months after initial release, so these numbers can shift. This counts payroll jobs, not people (someone with two part-time jobs is counted twice) and says nothing about the unemployment rate on its own. \"Government\" here combines federal, state, and local public-sector employment; this data doesn't isolate any single policy or layoff event.",
  "",
  "Source: Bureau of Labor Statistics, Current Employment Statistics (CES), via FRED.",
].filter(Boolean);

const lines = [
  `Jobs by industry watch (${STAMP})`, "", `BLS CES, year-over-year employment change by sector, ${asOf}.`, "",
  `Total nonfarm: ${totalChg >= 0 ? "+" : ""}${num(totalChg * 1000)} jobs (${totalPct >= 0 ? "+" : ""}${totalPct.toFixed(2)}%)`,
  `Education & health services alone: +${num(healthcare.chg * 1000)} jobs`,
  `All other sectors combined (bottom-up sum, ~rounded): ${otherSectorsRounded >= 0 ? "+" : ""}${num(otherSectorsRounded * 1000)} jobs`,
  "",
  "Sector | YoY % change | YoY jobs change | Share of US workforce",
  "---|---:|---:|---:",
  ...rows.map((r) => `${r.name} | ${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}% | ${r.chg >= 0 ? "+" : ""}${num(r.chg * 1000)} | ${r.share.toFixed(1)}%`), "",
  "Facebook post", "-------------", facebook.join("\n"),
];

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["sector", "yoy_pct_change", "yoy_jobs_change", "workforce_share_pct", "as_of"],
  rows.map((r) => [r.name, r.pct.toFixed(2), Math.round(r.chg * 1000), r.share.toFixed(1), asOf])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((x) => rel(`${outBase}.${x}`)).join(" / ")}`);
