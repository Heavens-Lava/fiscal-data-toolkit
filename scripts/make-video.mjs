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
    if (/^Sources?:/i.test(line) && /[A-Z]{4,}/.test(line)) continue; // FRED-code-style source dumps
    if (!keepCaveats && /^(Caveat|Note)\b\s*[:\-]/i.test(line)) continue; // disclaimer asides
    beats.push(stripDates(line.replace(/https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim()));
  }
  if (beats.length) {
    beats[0] = beats[0].replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "");
  }

  if (table) {
    const tableBeats = table.rows.slice(0, 6).map((row) => stripDates(tableRowToSentence(table.headers, row)));
    // narrative headline first, then table sentences, then remaining narrative/notes/source
    beats.splice(1, 0, ...tableBeats);
  }
  return beats.filter(Boolean);
}

const topic = process.argv[2];
if (!topic || topic.startsWith("--")) {
  console.error("Usage: node scripts/make-video.mjs <topic> [--date YYYY-MM-DD] [--keep-script] [--rate 1.15] [--accent #2a78d6] [--music <mood|file>] [--no-music] [--voice <name>] [--brand <name>]");
  process.exit(1);
}
const date = argValue("--date", localDateStamp());
const keepScript = process.argv.includes("--keep-script");
const keepCaveats = process.argv.includes("--keep-caveats");
const rate = argValue("--rate");
const accent = argValue("--accent");
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

const beats = customScriptPath
  ? JSON.parse(readFileSync(customScriptPath, "utf8"))
  : textToBeats(extractCaption(readFileSync(txtFile, "utf8")), { keepCaveats });
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

console.log(`\nRendering via ${VIDEO_MAKER} ...`);
const assembleArgs = ["assemble.cjs", "--script", scriptPath, "--portrait", "--motion"];
if (rate) assembleArgs.push("--rate", rate);
if (accent) assembleArgs.push("--accent", accent);
if (music) assembleArgs.push("--music", music);
if (voice) assembleArgs.push("--voice", voice);
if (brand) assembleArgs.push("--brand", brand);
execFileSync("node", assembleArgs, {
  cwd: VIDEO_MAKER,
  stdio: "inherit",
});

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
