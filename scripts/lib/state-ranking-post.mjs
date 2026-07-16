import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./chart-kit.mjs";
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
    label: `#${row.rank} ${row.state}`, v: row.value, color: row.state === "Arizona" ? C.s2 : C.s1,
  })), { fmtTick: tickFormat, fmtVal: valueFormat });
  const html = cardHTML({
    kicker, title, hero: valueFormat(high[0].value), heroLabel: `${high[0].state}; ${metricLabel}`,
    chartSVG, source, vintage,
  });
  const describe = (row) => rowDetail ? rowDetail(row) : valueFormat(row.value);
  const facebook = [
    question,
    `${high[0].state} ranks highest at ${describe(high[0])}, while ${low[0].state} ranks lowest at ${describe(low[0])}.`, "",
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
