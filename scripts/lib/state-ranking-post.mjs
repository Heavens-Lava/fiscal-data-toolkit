import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cardHTML, horizontalBarChart, screenshot, toCSV } from "./chart-kit.mjs";
import { SOCIAL, STAMP, money, rel, uniqueRows } from "./data-common.mjs";

export function writeStateRankingPost({
  topic, kicker, title, question, rows, metricLabel, source, sourceWebsite, vintage,
  note, valueFormat = money, tickFormat = money, rowDetail, extraColumns = [], noImage = false,
  retrievalNote = "Information retrieved programmatically via API.",
  engagementQuestion = "Which state surprised you most? Comment below and share this with someone comparing states.",
}) {
  mkdirSync(SOCIAL, { recursive: true });
  const outBase = path.join(SOCIAL, `${topic}-${STAMP}`);
  const ranked = rows.filter((row) => Number.isFinite(row.value))
    .sort((a, b) => b.value - a.value)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  if (!ranked.length) throw new Error(`No usable rows for ${topic}.`);
  const az = ranked.find((row) => row.state === "Arizona");
  const high = ranked.slice(0, 5);
  const low = ranked.slice(-5).reverse();
  const chartRows = uniqueRows([...high, az, ...low.slice().reverse()], "state");
  const chartSVG = horizontalBarChart(chartRows.map((row) => ({
    label: `#${row.rank} ${row.state}`,
    v: row.value,
    color: row.state === "Arizona" ? "#e4ad55" : row.rank <= 5 ? "#087f83" : "#e66b5b",
  })), { fmtTick: tickFormat, fmtVal: valueFormat });
  const html = cardHTML({
    kicker, title, hero: valueFormat(high[0].value), heroLabel: `${high[0].state}; ${metricLabel}`,
    chartSVG, source, vintage,
  });
  const describe = (row) => rowDetail ? rowDetail(row) : valueFormat(row.value);
  // The hook always compares on the single primary `value` metric (never the
  // richer per-row rowDetail, which can bundle in a second unrelated figure
  // that doesn't move in the same direction -- mixing two metrics into one
  // ranking claim reads as incoherent, e.g. "$X premium; $Y deductible" vs.
  // "$X2 premium; $Y2 deductible" when X2<X but Y2>Y).
  const ratio = low[0].value > 0 ? high[0].value / low[0].value : null;
  const ratioClause = ratio != null && ratio >= 3
    ? ` — ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}x ${low[0].state}'s`
    : " — versus";
  const facebook = [
    `${high[0].state} ranks highest at ${valueFormat(high[0].value)}${ratioClause} ${valueFormat(low[0].value)}${ratioClause.includes("versus") ? ` in ${low[0].state}` : ""}. Every state, ranked:`, "",
    `State | ${metricLabel}`,
    ...ranked.map((row) => `#${row.rank} ${row.state} | ${describe(row)}`), "",
    az ? `Arizona ranks #${az.rank}: ${describe(az)}.` : "", "", note, "",
    engagementQuestion, "",
    "Sources:", `• ${source}`, `Source website: ${sourceWebsite}`, retrievalNote,
    "Graph made by Jeffrey Macy.",
  ].filter(Boolean);
  const lines = [
    `${title} (${STAMP})`, "", `State | ${metricLabel}`, "---|---:",
    ...ranked.map((row) => `#${row.rank} ${row.state} | ${describe(row)}`), "",
    `Source: ${source}. Data through ${vintage}.`, "",
    "Facebook post", "-------------", facebook.join("\n"), "", note,
  ];
  writeFileSync(`${outBase}.txt`, lines.join("\n"));
  writeFileSync(`${outBase}.csv`, toCSV(
    ["rank", "state", "value", ...extraColumns.map((column) => column.key), "vintage"],
    ranked.map((row) => [row.rank, row.state, row.value, ...extraColumns.map((column) => row[column.key]), vintage])
  ));
  writeFileSync(`${outBase}.html`, html);
  const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
  console.log(`${title}: ${ranked.length} rows. Arizona ${az ? `#${az.rank} (${describe(az)})` : "unavailable"}.`);
  console.log(`Files: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`)).join(" / ")}`);
  return { topic, ranked, wroteImage };
}
