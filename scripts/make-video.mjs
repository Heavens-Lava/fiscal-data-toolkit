#!/usr/bin/env node
// make-video.mjs - turn a social/ post's caption into a short vertical video
// using the sibling inventor-video project (TTS voiceover + Fireship-style
// motion graphics), then save it back into social/{topic}-{date}.mp4.
//
// Run:  node scripts/make-video.mjs az-vs-us-income
//       node scripts/make-video.mjs az-vs-us-income --date 2026-07-08
//       node scripts/make-video.mjs debt --keep-script   (leave the generated beats JSON for inspection)
//       node scripts/make-video.mjs debt --keep-caveats  (include Caveat:/Note: asides, dropped by default)
//       node scripts/make-video.mjs debt --script social/_video-scripts/debt.storyboard.json
//
// Storyboard beats may include a Fireship-style meme cutaway:
//   { "text": "...", "visual": { "type": "meme", "query": "this is fine fire" } }
// `query` is optional — omit it and lib/meme-kit.mjs auto-picks a reaction
// from the beat's own text. Requires GIPHY_API_KEY (free signup at
// https://developers.giphy.com/, see COMMANDS.md).

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractCaption } from "./lib/social-posts.mjs";
import { resolveMemeForBeat } from "./lib/meme-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const SCRIPTS_DIR = path.join(SOCIAL, "_video-scripts");
const VIDEO_MAKER = process.env.VIDEO_MAKER_DIR || "C:\\Users\\jmacy\\projects\\inventor-video";

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function localDateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Parse a markdown table (header row + |---|---| separator + data rows) out of
// the caption text, if one is present.
function extractTable(lines) {
  for (let i = 0; i < lines.length - 1; i++) {
    const head = lines[i], sep = lines[i + 1];
    if (head.includes("|") && /^[-:|\s]+$/.test(sep) && sep.includes("-")) {
      const headers = head.split("|").map((s) => s.trim()).filter(Boolean);
      const rows = [];
      let j = i + 2;
      for (; j < lines.length; j++) {
        if (!lines[j].includes("|")) break;
        const cells = lines[j].split("|").map((s) => s.trim()).filter(Boolean);
        if (cells.length) rows.push(cells);
      }
      return { headers, rows, start: i, end: j };
    }
  }
  return null;
}

function tableRowToSentence(headers, row) {
  const label = row[0];
  const rest = headers.slice(1, row.length)
    .map((h, k) => `${h} ${row[k + 1]}`)
    .filter((_, k) => headers[k + 1] && !/^vintage$/i.test(headers[k + 1]))
    .join(", ");
  return `${label}: ${rest}.`;
}

// Drop ISO dates (YYYY-MM-DD) from spoken text — Edge TTS reads them out
// character-by-character ("twenty twenty six dash oh five..."), which sounds
// bad. Month-name dates ("Apr 2026") are left alone; those read fine.
function stripDates(text) {
  return text
    .replace(/\s*as of \d{4}-\d{2}-\d{2}\b/gi, "")
    .replace(/\(\s*\d{4}-\d{2}-\d{2}\s*,\s*/g, "(")
    .replace(/\s*\(\s*\d{4}-\d{2}-\d{2}\s*\)/g, "")
    .replace(/,\s*\d{4}-\d{2}-\d{2}\b/g, "")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function splitForSpeech(line) {
  const parts = String(line)
    .split(/(?<=[!?])\s+|(?<=[a-z0-9%)])\.\s+(?=[A-Z])/)
    .map((value) => value.trim())
    .filter(Boolean);
  const out = [];
  for (const part of parts) {
    const words = part.split(/\s+/);
    if (words.length <= 27) {
      out.push(part);
      continue;
    }
    const clauses = part.split(/;\s+|,\s+(?=(?:but|while|and|which|meaning|or)\b)/i);
    if (clauses.length > 1) out.push(...clauses.map((value) => value.trim()).filter(Boolean));
    else out.push(part);
  }
  return out;
}

// Turn a post's raw .txt caption into a beats array for the video assembler.
// Each surviving source line becomes one beat (a beat may hold more than one
// spoken sentence — the assembler times captions per-word regardless, so
// that's fine). Deliberately does NOT re-split on periods: this text is full
// of decimals ("$4.82") and abbreviations ("U.S.") that a naive sentence
// splitter mangles.
//
// Caveat/Note asides are dropped by default (they're the longest, least
// essential lines for a short-form video) — pass keepCaveats to retain them.
function textToBeats(raw, { keepCaveats = false } = {}) {
  const rawLines = raw.split(/\r?\n/).map((l) => l.trim());
  const table = extractTable(rawLines);

  const beats = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (table && i >= table.start && i < table.end) continue; // skip table block
    const line = rawLines[i];
    if (!line) continue;
    if (/^https?:\/\//.test(line)) continue; // bare URL line
    if (/^(?:Sources?|Source website|Information retrieved|Data retrieved|Graphs? (?:made|created)|Charts? (?:made|created))\b/i.test(line)) continue;
    if (/^[#*_\-=]{3,}$/.test(line)) continue;
    if (/^(?:why it matters|did you know|understanding the data|historical context)\s*:?\s*$/i.test(line)) continue;
    if (/:\s*$/.test(line) && line.split(/\s+/).length <= 5) continue;
    if (!keepCaveats && /^(Caveat|Note)\b\s*[:\-]/i.test(line)) continue; // disclaimer asides
    const cleaned = stripDates(line.replace(/https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim());
    beats.push(...splitForSpeech(cleaned));
  }
  if (beats.length) {
    beats[0] = beats[0].replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "");
  }

  if (table) {
    const tableBeats = table.rows.slice(0, 3).map((row) => stripDates(tableRowToSentence(table.headers, row)));
    beats.splice(2, 0, ...tableBeats);
  }
  const unique = [];
  for (const beat of beats.filter(Boolean)) {
    const key = beat.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || unique.some((item) => item.key === key)) continue;
    unique.push({ key, text: beat });
  }
  return unique.map((item) => item.text);
}

function displayNumbers(text) {
  const matches = String(text).match(/\$[\d,.]+(?:\s*(?:trillion|billion|million|T|B|M|k))?|\b\d[\d,.]*(?:\.\d+)?\s*(?:%|percent|years?|million|billion|trillion|hours?|minutes?|dollars?|people|households?|jobs?|GW|kWh)(?=\s|[.,;:!?)]|$)/gi) || [];
  return [...new Set(matches.map((value) => value.trim()))].slice(0, 3);
}

function numericValue(display) {
  const base = Number(String(display).replace(/[$,%]/g, "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
  if (!Number.isFinite(base)) return 0;
  if (/\btrillion\b|\bT\b/i.test(display)) return base * 1e12;
  if (/\bbillion\b|\bB\b/i.test(display)) return base * 1e9;
  if (/\bmillion\b|\bM\b/i.test(display)) return base * 1e6;
  if (/\bk\b/i.test(display)) return base * 1e3;
  return base;
}

function compactTitle(text, number = "") {
  const cleaned = String(text)
    .replace(number, "")
    .replace(/^[\s:,.!-]+|[\s:,.!-]+$/g, "")
    .replace(/\s+/g, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);
  return (words.length > 12 ? `${words.slice(0, 12).join(" ")}...` : cleaned) || "The headline number";
}

function badgeFor(text, index, total) {
  if (index === 0) return "THE NUMBER THAT MATTERS";
  if (/\?$/.test(text)) return "WHAT DO YOU SEE?";
  if (/\b(?:highest|lowest|record|all-time)\b/i.test(text)) return "THE EXTREME";
  if (/\b(?:versus|vs\.?|compared|while|but)\b/i.test(text)) return "THE COMPARISON";
  if (displayNumbers(text).length) return "FOLLOW THE NUMBER";
  return "WHY IT MATTERS";
}

function sourceName(raw) {
  const line = String(raw).split(/\r?\n/).find((value) => /^Sources?:/i.test(value.trim()));
  if (line) return line.replace(/^Sources?:\s*/i, "").split(/[;|]/)[0].trim().replace(/[.:\s]+$/, "").slice(0, 100);
  const known = [
    ["U.S. Census Bureau", /census bureau|american community survey|\bACS\b/i],
    ["U.S. Bureau of Labor Statistics", /bureau of labor statistics|\bBLS\b/i],
    ["U.S. Treasury Fiscal Data", /treasury fiscal data|fiscaldata/i],
    ["Federal Reserve Economic Data", /\bFRED\b|federal reserve/i],
    ["U.S. Energy Information Administration", /energy information administration|\bEIA\b/i],
    ["USDA", /\bUSDA\b|agricultural statistics/i],
  ];
  return known.find(([, pattern]) => pattern.test(raw))?.[0] || "Official public data";
}

function rankedItem(text) {
  const match = String(text).match(/^#?(\d+)\s+([^:|]+?)\s*[:|]\s*(.+)$/);
  if (!match) return null;
  const display = displayNumbers(match[3])[0];
  if (!display) return null;
  return {
    rank: Number(match[1]),
    label: match[2].trim(),
    display,
    value: numericValue(display),
  };
}

function automaticStoryboard(lines, { raw, chartFile, maxBeats = 8 }) {
  if (!lines.length) return [];
  const hook = lines[0];
  const question = [...lines].reverse().find((line) => line !== hook && /\?$/.test(line));
  const ranking = lines.map(rankedItem).filter(Boolean).sort((a, b) => a.rank - b.rank).slice(0, 3);
  const narrative = lines
    .slice(1)
    .filter((line) => line !== question && !rankedItem(line))
    .filter((line) => !(/\bdata\b/i.test(line) && /\b(?:by state|estimates?|dataset|ranking)\b/i.test(line) && !displayNumbers(line).length))
    .slice(0, Math.max(2, maxBeats - 4));
  const selected = [hook, ...narrative];
  if (question) selected.push(question);
  const headlineNumber = lines.flatMap(displayNumbers)[0];

  const beats = selected.map((text, index) => {
    const numbers = displayNumbers(text);
    let visual;
    if (numbers.length >= 2 && /\b(?:versus|vs\.?|compared|while|but|from|to)\b/i.test(text)) {
      const values = numbers.slice(0, 2).map(numericValue);
      const max = Math.max(...values, 1);
      visual = {
        type: "comparison",
        title: compactTitle(text),
        items: numbers.slice(0, 2).map((display, itemIndex) => ({
          label: itemIndex === 0 ? "First figure" : "Second figure",
          value: values[itemIndex],
          display,
          color: itemIndex === 0 ? "#df5547" : "#1769aa",
        })),
        min: 0,
        max: max * 1.08,
      };
    } else if (numbers.length) {
      visual = {
        type: "number",
        title: compactTitle(text, numbers[0]),
        value: numbers[0],
        subtitle: index === 0 ? "The result, before the explanation" : undefined,
      };
    } else if (index === 0 && headlineNumber) {
      visual = {
        type: "number",
        title: compactTitle(text),
        value: headlineNumber,
        subtitle: "The headline result",
      };
    } else {
      visual = {
        type: "source",
        title: compactTitle(text),
        subtitle: "One clear point at a time",
      };
    }
    return { text, badge: index === 0 ? badgeFor(text, index, selected.length) : undefined, visual };
  });

  let insertionIndex = 1;
  if (chartFile && beats.length > 1) {
    beats.splice(1, 0, {
      text: "Here is the full comparison in the underlying data.",
      visual: {
        type: "chart",
        src: chartFile,
        title: compactTitle(lines[0]),
      },
    });
    insertionIndex = 2;
  }

  if (ranking.length >= 2) {
    const spoken = ranking.map((item, index) => {
      const lead = ranking.length > 2 && index === ranking.length - 1 ? "and " : "";
      return `${lead}${item.label} at ${item.display}`;
    }).join(ranking.length > 2 ? ", " : " and ");
    beats.splice(insertionIndex, 0, {
      text: `The top ${ranking.length} are ${spoken}.`,
      visual: {
        type: "comparison",
        title: `Top ${ranking.length} in the ranking`,
        items: ranking.map((item, index) => ({
          label: `#${item.rank} ${item.label}`,
          value: item.value,
          display: item.display,
          color: ["#df5547", "#1769aa", "#168c83"][index],
        })),
        min: 0,
        max: Math.max(...ranking.map((item) => item.value)) * 1.08,
      },
    });
  }

  const source = sourceName(raw);
  beats.splice(Math.max(1, beats.length - (question ? 1 : 0)), 0, {
    text: `The source is ${source}.`,
    visual: {
      type: "source",
      title: source,
      subtitle: "Official data, with the full source listed in the post",
    },
  });

  if (!question) {
    beats.push({
      text: "What does this look like where you live?",
      visual: {
        type: "number",
        title: "What does the data look like where you live?",
        value: "YOU",
        subtitle: "Add your experience in the comments",
      },
    });
  }

  return beats.slice(0, maxBeats);
}

const topic = process.argv[2];
if (!topic || topic.startsWith("--")) {
  console.error("Usage: node scripts/make-video.mjs <topic> [--date YYYY-MM-DD] [--storyboard-only] [--max-beats 8] [--keep-script] [--keep-caveats] [--rate 1.12] [--accent #df5547] [--music <mood|file>] [--no-music] [--voice <name>] [--brand <name>]");
  process.exit(1);
}
const date = argValue("--date", localDateStamp());
const keepScript = process.argv.includes("--keep-script");
const storyboardOnly = process.argv.includes("--storyboard-only");
const keepCaveats = process.argv.includes("--keep-caveats");
const rate = argValue("--rate", process.env.VIDEO_RATE || "1.12");
const accent = argValue("--accent", process.env.VIDEO_ACCENT || "#df5547");
const music = process.argv.includes("--no-music") ? null : argValue("--music", process.env.VIDEO_MUSIC || "suspense");
const voice = argValue("--voice");
const brand = argValue("--brand", process.env.VIDEO_BRAND || "AMERICA BY THE NUMBERS");
const customScriptArg = argValue("--script");
const customScriptPath = customScriptArg
  ? (path.isAbsolute(customScriptArg) ? customScriptArg : path.resolve(ROOT, customScriptArg))
  : null;

const txtFile = path.join(SOCIAL, `${topic}-${date}.txt`);
if (!customScriptPath && !existsSync(txtFile)) {
  console.error(`Missing caption file: ${path.relative(ROOT, txtFile)}`);
  process.exit(1);
}
if (customScriptPath && !existsSync(customScriptPath)) {
  console.error(`Missing storyboard file: ${path.relative(ROOT, customScriptPath)}`);
  process.exit(1);
}
if (!existsSync(VIDEO_MAKER)) {
  console.error(`Video maker not found at ${VIDEO_MAKER} (set VIDEO_MAKER_DIR to override)`);
  process.exit(1);
}

const rawCaption = customScriptPath ? "" : extractCaption(readFileSync(txtFile, "utf8"));
const beats = customScriptPath
  ? JSON.parse(readFileSync(customScriptPath, "utf8"))
  : automaticStoryboard(
      textToBeats(rawCaption, { keepCaveats }),
      {
        raw: rawCaption,
        chartFile: existsSync(path.join(SOCIAL, `${topic}-${date}.png`))
          ? path.join(SOCIAL, `${topic}-${date}.png`)
          : null,
        maxBeats: Number(argValue("--max-beats", "8")),
      },
    );
if (!beats.length) {
  console.error("Could not extract any speakable beats from the caption.");
  process.exit(1);
}
if (!Array.isArray(beats) || beats.some((beat) => typeof beat !== "string" && typeof beat?.text !== "string")) {
  console.error("Storyboard must be a JSON array of strings or objects containing a text field.");
  process.exit(1);
}

// Resolve any "meme" cutaway beats (storyboard-authored only) to a locally
// cached Giphy MP4 before handing off to the renderer — the renderer only
// knows how to play a local visual.src, not a Giphy query. A beat that
// already has a `src` (a specific clip picked and pinned by hand, e.g. after
// spot-checking search results) is left alone — re-resolving by query would
// silently overwrite an intentional pick with whatever the seeded search
// returns today.
for (const beat of beats) {
  if (beat?.visual?.type !== "meme" || beat.visual.src) continue;
  const resolved = await resolveMemeForBeat(beat.text, beat.visual.query);
  if (resolved) {
    beat.visual.src = resolved.src;
    beat.visual.credit = resolved.credit;
    delete beat.visual.query;
  } else {
    console.warn(`  ! Could not resolve a meme clip for beat: "${beat.text}" — rendering without a cutaway.`);
    delete beat.visual;
  }
}

console.log(`Topic: ${topic}  Date: ${date}`);
console.log(`Beats (${beats.length}):`);
beats.forEach((b, i) => console.log(`  ${i + 1}. ${typeof b === "string" ? b : b.text}`));

mkdirSync(SCRIPTS_DIR, { recursive: true });
// assemble.cjs runs as a separate child process and re-reads the script from
// disk — it never sees the in-memory `beats` mutated above (meme query ->
// resolved src/credit), so that resolution must always be written out here,
// even when --script pointed at a hand-authored storyboard. Writing to a
// generated path (not customScriptPath) also avoids clobbering the user's
// authored source file with resolved-in-place meme src/credit fields.
const scriptPath = path.join(SCRIPTS_DIR, `${topic}-${date}.json`);
writeFileSync(scriptPath, JSON.stringify(beats, null, 2));

if (storyboardOnly) {
  console.log(`\nStoryboard: ${path.relative(ROOT, scriptPath)}`);
  process.exit(0);
}

console.log(`\nRendering via ${VIDEO_MAKER} ...`);
const assembleArgs = ["assemble.cjs", "--script", scriptPath, "--portrait", "--motion"];
if (rate) assembleArgs.push("--rate", rate);
if (accent) assembleArgs.push("--accent", accent);
if (music) assembleArgs.push("--music", music);
if (voice) assembleArgs.push("--voice", voice);
if (brand) assembleArgs.push("--brand", brand);
let renderedSuccessfully = false;
let renderError;
for (let attempt = 1; attempt <= 3 && !renderedSuccessfully; attempt++) {
  try {
    execFileSync("node", assembleArgs, {
      cwd: VIDEO_MAKER,
      stdio: "inherit",
    });
    renderedSuccessfully = true;
  } catch (error) {
    renderError = error;
    if (attempt < 3) {
      const waitMs = attempt * 4_000;
      console.warn(`Renderer attempt ${attempt} failed. Retrying in ${waitMs / 1000} seconds...`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
    }
  }
}
if (!renderedSuccessfully) throw renderError;

const rendered = path.join(VIDEO_MAKER, "out", "final.mp4");
if (!existsSync(rendered)) {
  console.error("Render finished but out/final.mp4 was not found.");
  process.exit(1);
}
const outFile = path.join(SOCIAL, `${topic}-${date}.mp4`);
copyFileSync(rendered, outFile);
const fastStartFile = `${outFile}.compatible.mp4`;
try {
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-fflags", "+genpts", "-i", outFile,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", "setpts=PTS-STARTPTS,scale=in_range=auto:out_range=tv,format=yuv420p",
    "-af", "asetpts=PTS-STARTPTS",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-r", "30", "-fps_mode", "cfr",
    "-profile:v", "high", "-level:v", "4.2",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", fastStartFile,
  ], { stdio: "inherit" });
  copyFileSync(fastStartFile, outFile);
  rmSync(fastStartFile, { force: true });
} catch {
  rmSync(fastStartFile, { force: true });
  console.warn("Video rendered, but the playback-compatibility pass was skipped.");
}
const thumbnailFile = path.join(SOCIAL, `${topic}-${date}-thumbnail.png`);
try {
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-ss", "0.8", "-i", outFile,
    "-frames:v", "1", "-vf", "scale=1080:1920", thumbnailFile,
  ], { stdio: "inherit" });
} catch {
  console.warn("Video rendered, but the thumbnail could not be generated.");
}
const musicCreditSource = path.join(VIDEO_MAKER, "out", "music-credit.txt");
const videoCreditFile = path.join(SOCIAL, `${topic}-${date}-video-credit.txt`);
if (music && existsSync(musicCreditSource)) {
  writeFileSync(videoCreditFile, `${readFileSync(musicCreditSource, "utf8").trim()}\n`);
} else {
  rmSync(videoCreditFile, { force: true });
}
if (!keepScript) rmSync(scriptPath, { force: true });

console.log(`\nDone: ${path.relative(ROOT, outFile)}`);
if (existsSync(thumbnailFile)) console.log(`Thumbnail: ${path.relative(ROOT, thumbnailFile)}`);
if (existsSync(videoCreditFile)) console.log(`Video credit: ${path.relative(ROOT, videoCreditFile)}`);
