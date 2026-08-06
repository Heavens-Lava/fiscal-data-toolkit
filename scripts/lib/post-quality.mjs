import { closeSync, openSync, readSync } from "node:fs";
import path from "node:path";

function clamp(value, min = 0, max = 20) {
  return Math.max(min, Math.min(max, value));
}

function firstLine(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

function captionBody(text) {
  return String(text || "").split(/\r?\n(?:Sources?|Source website):/i)[0].trim();
}

function sentenceWordCounts(text) {
  return captionBody(text)
    .replace(/https?:\/\/\S+/g, "")
    .split(/[.!?]+(?:\s+|$)/)
    .map((sentence) => sentence.trim().split(/\s+/).filter(Boolean).length)
    .filter(Boolean);
}

function pngDimensions(file) {
  if (!file) return null;
  let fd;
  try {
    fd = openSync(file, "r");
    const header = Buffer.alloc(24);
    if (readSync(fd, header, 0, header.length, 0) !== header.length) return null;
    if (header.toString("hex", 0, 8) !== "89504e470d0a1a0a") return null;
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function addSuggestion(suggestions, value) {
  if (!suggestions.includes(value)) suggestions.push(value);
}

export function scorePostQuality({ caption, files = {}, socialDir = "" }) {
  const text = String(caption || "").trim();
  const hook = firstLine(text);
  const suggestions = [];
  const breakdown = {};

  let hookScore = 0;
  if (hook.length >= 18 && hook.length <= 120) hookScore += 8;
  else if (hook.length > 0) hookScore += 4;
  if (/[?$%]|\b\d[\d,.]*\b/.test(hook)) hookScore += 6;
  if (/\b(how|what|where|which|why|most|least|highest|lowest|cost|worth|changed|really)\b/i.test(hook)) hookScore += 6;
  breakdown.hook = clamp(hookScore);
  if (hook.length > 120) addSuggestion(suggestions, "Shorten the opening hook to 120 characters or less.");
  if (!/[?$%]|\b\d[\d,.]*\b/.test(hook)) addSuggestion(suggestions, "Put a concrete number or question in the opening line.");

  const words = text.split(/\s+/).filter(Boolean).length;
  const sentenceCounts = sentenceWordCounts(text);
  const averageSentence = sentenceCounts.length
    ? sentenceCounts.reduce((sum, value) => sum + value, 0) / sentenceCounts.length
    : 0;
  const dataRows = text.split(/\r?\n/).filter((line) => /^\s*(?:#?\d+|[A-Za-z .'-]+)\s*\|/.test(line)).length;
  let clarityScore = averageSentence > 0 && averageSentence <= 24 ? 9 : averageSentence <= 32 ? 6 : 3;
  clarityScore += words >= 45 && words <= 350 ? 7 : words <= 550 ? 4 : 2;
  clarityScore += dataRows <= 12 ? 4 : dataRows <= 20 ? 2 : 0;
  breakdown.clarity = clamp(clarityScore);
  if (averageSentence > 24) addSuggestion(suggestions, "Use shorter sentences; the current average is over 24 words.");
  if (words > 350) addSuggestion(suggestions, "Trim the main caption or move the full ranking to a linked table.");
  if (dataRows > 12) addSuggestion(suggestions, "Show the most revealing rows in the post instead of the entire ranking.");
  if (/\b(?:Btu|MMBtu|CPI|index value|basis points?)\b/i.test(text)
      && !/\b(?:means|equivalent|in plain English|measures)\b/i.test(text)) {
    breakdown.clarity = clamp(breakdown.clarity - 4);
    addSuggestion(suggestions, "Translate specialized units into a familiar real-world comparison.");
  }

  let relevanceScore = 0;
  if (/\b(why (?:it|this) matters|what (?:it|this) means|for families|for workers|household|per person|your budget|your state)\b/i.test(text)) relevanceScore += 8;
  if (/\bArizona\b|\bwhere you live\b|\byour state\b/i.test(text)) relevanceScore += 4;
  const questions = text.match(/[^?\n]{8,}\?/g) || [];
  if (questions.length) relevanceScore += 8;
  breakdown.relevance = clamp(relevanceScore);
  if (relevanceScore < 8) addSuggestion(suggestions, "Add one sentence connecting the result to everyday life.");
  if (!questions.length) addSuggestion(suggestions, "End with one specific question people can answer from experience.");

  const resolveAsset = (file) => file
    ? (path.isAbsolute(file) ? file : path.join(socialDir, file))
    : null;
  const imageFile = resolveAsset(files.png);
  const portraitFile = resolveAsset(files.portrait);
  const imageSize = pngDimensions(imageFile);
  const portraitSize = pngDimensions(portraitFile);
  let visualScore = files.png || files.mp4 ? 8 : 0;
  if (files.portrait && portraitSize?.height > portraitSize?.width) visualScore += 7;
  else if (imageSize?.height > imageSize?.width) visualScore += 7;
  if (files.mp4) visualScore += 5;
  breakdown.visual = clamp(visualScore);
  if (files.png && !files.portrait && !(imageSize?.height > imageSize?.width)) {
    addSuggestion(suggestions, "Create a 1080 x 1350 portrait image for the Facebook feed.");
  }
  if (!files.mp4) addSuggestion(suggestions, "Consider a 9:16 narrated video for this topic.");

  let sourcingScore = 0;
  if (/\bSources?:/i.test(text)) sourcingScore += 5;
  if (/Source website:\s*https?:\/\//i.test(text)) sourcingScore += 5;
  if (/\b(?:retrieved|processed) programmatically\b/i.test(text)
      || /\b(?:transcribed|official data download)\b/i.test(text)) sourcingScore += 4;
  if (/\b(?:Graph|Chart)s? (?:made|created) by Jeffrey Macy\b/i.test(text)) sourcingScore += 3;
  if (/\b(?:19|20)\d{2}(?:-\d{2}(?:-\d{2})?)?\b/.test(text)) sourcingScore += 3;
  breakdown.sourcing = clamp(sourcingScore);
  if (sourcingScore < 17) addSuggestion(suggestions, "Include the source link, data vintage, retrieval note, and chart credit.");

  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const label = score >= 85 ? "strong" : score >= 70 ? "good" : score >= 55 ? "fair" : "needs improvement";

  return {
    score,
    label,
    breakdown,
    suggestions: suggestions.slice(0, 5),
    imageSize,
    portraitSize,
    wordCount: words,
  };
}
