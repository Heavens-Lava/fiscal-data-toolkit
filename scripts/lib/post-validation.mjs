// post-validation.mjs — automated pre-approval checks for generated posts.
// This is a data/claim-consistency gate, separate from post-quality.mjs's
// "is this well-written" scoring: it asks "does the caption's headline claim
// actually match the underlying data," not "is the writing good." Rules-
// based static analysis over the .txt/.csv/.html a script already wrote --
// no live re-fetching, no LLM call, so it's fast and deterministic.
//
// Every check returns { id, severity, message } where severity is one of
// "fail" (block/needs-fix), "review" (flag for a human or a second pass to
// look at, not an automatic block), or "info" (fyi only, doesn't count
// against the verdict). validatePost() rolls these into one overall verdict:
// "fail" if any fail, "review" if any review, else "pass".
//
// Checks run against the FINAL prepared caption (via prepareFacebookCaption,
// the same function the real publishing pipeline uses) rather than the raw
// .txt -- the "Source website:" line and a few other footer lines are
// auto-appended at that step, not stored in the raw file, and that's
// precisely where the religion-adherence-watch source-attribution bug lived.

import { extractCaption as extractCaptionRaw, prepareFacebookCaption } from "./social-posts.mjs";

const GOV_DOMAIN_RE = /\.(gov|mil)$/i;
// Non-.gov sources this project already treats as official/audited
// (see CLAUDE.md's data-standards list) -- extend as new sources are added.
const KNOWN_OFFICIAL_DOMAINS = [
  "stlouisfed.org", // FRED
  "fred.stlouisfed.org",
  "worldbank.org",
  "data.worldbank.org",
  "datahelpdesk.worldbank.org",
  "naic.org",
  "content.naic.org",
  "usreligioncensus.org",
  "www.usreligioncensus.org",
  "voteview.com",
  "coingecko.com",
  "www.coingecko.com",
  "finance.yahoo.com",
  "open-meteo.com",
  "gold-api.com",
  "openstreetmap.org",
  "wiki.openstreetmap.org",
];

function hasMarker(raw) {
  return /^Facebook post\r?\n-{3,}\r?\n/m.test(raw);
}

function firstParagraph(caption) {
  const para = caption.split(/\r?\n\r?\n/)[0] || "";
  // Some captions run the hook straight into a "Label | Value" ranked-list
  // table with no blank-line break -- cut at the first such row so checks
  // that scan "the opening paragraph" don't accidentally scan the entire
  // table (which then gets misread as one giant number-dense hook).
  const tableRowIdx = para.search(/\n[^\n|]{1,40}\|/);
  return tableRowIdx === -1 ? para : para.slice(0, tableRowIdx);
}

function parseCSV(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (!lines.length) return { header: [], rows: [] };
  const splitLine = (line) => {
    const cells = [];
    let cur = "", inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return cells;
  };
  const header = splitLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).filter(Boolean).map((line) => {
    const cells = splitLine(line);
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
  return { header, rows };
}

// ── Check: Facebook post marker present ─────────────────────────────────
// The exact bug class found 3x this session: no "Facebook post\n---"
// marker means prepareFacebookCaption() falls back to dumping the entire
// raw .txt (including the full markdown table) as the caption.
function checkCaptionMarker(rawTxt) {
  if (!hasMarker(rawTxt)) {
    return { id: "caption-marker", severity: "fail", message: "No 'Facebook post' section found in the .txt file -- the caption will fall back to the entire raw file (data table included) instead of the intended caption." };
  }
  if (!extractCaptionRaw(rawTxt).trim()) {
    return { id: "caption-marker", severity: "fail", message: "Facebook post section exists but is empty." };
  }
  return { id: "caption-marker", severity: "pass", message: "Facebook post marker present and non-empty." };
}

// ── Check: rendered HTML doesn't contain a literal "undefined" ──────────
// Catches the cardHTML()-called-with-wrong-params bug directly (hero/kicker
// render as the literal string "undefined" when the param name is wrong).
function checkNoUndefinedInHtml(htmlText) {
  if (!htmlText) return { id: "html-undefined", severity: "info", message: "No HTML to check." };
  // Look for undefined as a rendered text node, not inside <script> or a URL.
  const stripped = htmlText.replace(/<script[\s\S]*?<\/script>/gi, "");
  if (/>\s*undefined\s*</i.test(stripped) || />[^<]*\bundefined\b[^<]*</i.test(stripped)) {
    return { id: "html-undefined", severity: "fail", message: "The literal text 'undefined' appears in the rendered HTML -- almost always a template call with a wrong/missing parameter name." };
  }
  return { id: "html-undefined", severity: "pass", message: "No literal 'undefined' found in rendered HTML." };
}

// ── Check: headline claim matches the CSV's actual #1 row ───────────────
// If the CSV has a rank column, find the rank-1 entity and confirm its name
// appears in the caption's opening paragraph. Would have caught the
// turkeys bug (Minnesota claimed "worth more" when it was only #1 by
// quantity, not value) if the value-superlative and the rank-by-quantity
// disagreed -- this check flags exactly that kind of mismatch.
function checkHeadlineMatchesTopRow(caption, csvRows) {
  const header = csvRows.header || [];
  const rankCol = header.find((h) => /^rank$/i.test(h));
  if (!rankCol || !csvRows.rows.length) return { id: "headline-vs-top-row", severity: "info", message: "No rank column found in CSV; skipped." };
  const rank1 = csvRows.rows.find((r) => String(r[rankCol]).trim() === "1");
  if (!rank1) return { id: "headline-vs-top-row", severity: "info", message: "No rank=1 row found; skipped." };
  // Best-effort "entity name" = first non-numeric, non-rank column.
  const nameCol = header.find((h) => h !== rankCol && Number.isNaN(Number(rank1[h])) && rank1[h] && rank1[h].length > 1);
  if (!nameCol) return { id: "headline-vs-top-row", severity: "info", message: "Could not identify an entity-name column; skipped." };
  const topName = rank1[nameCol];
  const hook = firstParagraph(caption);
  const superlative = /\b(highest|most|leads?|ranks?\s+highest|worth more|largest|biggest|top|leading)\b/i.test(hook);
  if (superlative && topName && !hook.includes(topName)) {
    return { id: "headline-vs-top-row", severity: "review", message: `Caption's opening claims a leader/superlative, but "${topName}" (the CSV's rank-1 row) isn't named in that opening paragraph. Verify the caption's named entity actually matches what's ranked #1.` };
  }
  return { id: "headline-vs-top-row", severity: "pass", message: `Rank-1 entity ("${topName}") appears in the caption's opening paragraph.` };
}

// ── Check: dollar/count figures in the hook actually appear in the CSV ──
// Loose numeric-reconciliation check: every "$X" or bare large number in
// the caption's opening paragraph should be traceable to a value in the
// CSV (within small rounding tolerance). Flags hallucinated or miscomputed
// headline numbers -- the exact failure mode seen in Gemini's suggested
// hooks earlier this session.
function checkHookNumbersInCsv(caption, csvRows) {
  const hook = firstParagraph(caption);
  const dollarMatches = [...hook.matchAll(/\$([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  if (!dollarMatches.length) return { id: "hook-numbers-in-csv", severity: "info", message: "No dollar figures in the opening paragraph to check." };
  const csvNumbers = [];
  for (const row of csvRows.rows) {
    for (const v of Object.values(row)) {
      const n = Number(String(v).replace(/,/g, ""));
      if (Number.isFinite(n)) csvNumbers.push(n);
    }
  }
  if (!csvNumbers.length) return { id: "hook-numbers-in-csv", severity: "info", message: "No numeric CSV data to check against." };
  // Compare at several common unit scales (raw dollars vs. thousands vs.
  // millions vs. billions vs. trillions) since a hook often quotes "$19.5T"
  // while the CSV stores the raw dollar figure, or vice versa.
  const SCALES = [1, 1e3, 1e6, 1e9, 1e12];
  const matchesAtSomeScale = (n, c) => SCALES.some((s) => Math.abs(c - n * s) <= Math.max(1, c * 0.02) || Math.abs(c * s - n) <= Math.max(1, n * 0.02));
  const unmatched = dollarMatches.filter((n) => !csvNumbers.some((c) => matchesAtSomeScale(n, c)));
  if (unmatched.length) {
    return { id: "hook-numbers-in-csv", severity: "review", message: `Dollar figure(s) in the opening paragraph not found in the CSV data (within 2% tolerance): ${unmatched.map((n) => `$${n}`).join(", ")}. Could be a unit mismatch (e.g. thousands vs. whole dollars) or a computed/derived figure -- verify by hand.` };
  }
  return { id: "hook-numbers-in-csv", severity: "pass", message: "All dollar figures in the opening paragraph trace to CSV values." };
}

// ── Check: source URL is a plausible official domain ─────────────────────
function checkSourceDomain(caption) {
  const m = caption.match(/Source website:\s*(https?:\/\/[^\s<>]+)/i);
  if (!m) return { id: "source-domain", severity: "review", message: "No 'Source website:' line found in the caption." };
  let host;
  try { host = new URL(m[1]).hostname.toLowerCase(); } catch { return { id: "source-domain", severity: "review", message: `Source website URL could not be parsed: ${m[1]}` }; }
  const bare = host.replace(/^www\./, "");
  if (GOV_DOMAIN_RE.test(host) || KNOWN_OFFICIAL_DOMAINS.includes(host) || KNOWN_OFFICIAL_DOMAINS.includes(bare)) {
    return { id: "source-domain", severity: "pass", message: `Source domain (${host}) is a recognized official/audited source.` };
  }
  return { id: "source-domain", severity: "review", message: `Source domain (${host}) is not on the .gov/.mil allowlist or the known-official list -- verify it belongs there before publishing (add to KNOWN_OFFICIAL_DOMAINS in post-validation.mjs if it's legitimate).` };
}

// ── Check: source attribution doesn't contradict the post's own text ────
// Catches the religion-adherence-watch bug: caption explicitly says a
// dataset does NOT come from an agency, but the auto-detected source URL
// points at that agency anyway.
function checkSourceNotSelfContradicting(caption) {
  const m = caption.match(/Source website:\s*(https?:\/\/[^\s<>]+)/i);
  if (!m) return { id: "source-contradiction", severity: "info", message: "No source URL to check." };
  let host;
  try { host = new URL(m[1]).hostname.toLowerCase(); } catch { return { id: "source-contradiction", severity: "info", message: "Source URL unparseable." }; }
  const agencyDomainHints = {
    "census bureau": "census.gov", "bls": "bls.gov", "bureau of labor statistics": "bls.gov",
    "irs": "irs.gov", "treasury": "treasury.gov", "eia": "eia.gov", "fbi": "fbi.gov", "hud": "hud.gov",
  };
  const negationRe = /\b(is not|isn't|does not|doesn't|no federal data|not (?:from|available from|collected by|track(?:ed|ing)? by)|legally barred|does not (?:collect|track|publish))\b/gi;
  for (const [agency, domain] of Object.entries(agencyDomainHints)) {
    if (!host.endsWith(domain)) continue;
    const agencyIdx = caption.toLowerCase().indexOf(agency);
    if (agencyIdx === -1) continue;
    // Check for a negation phrase within ~120 chars either side of the agency mention.
    const window = caption.slice(Math.max(0, agencyIdx - 120), agencyIdx + agency.length + 120);
    if (negationRe.test(window)) {
      // "review" not "fail": this regex can't reliably tell a true
      // self-contradiction (this post's own data isn't from that agency)
      // from an aside about a DIFFERENT dataset the same agency doesn't
      // cover (e.g. "the Census Bureau tracks X separately") -- needs a
      // human/second-pass read either way, but isn't safe to hard-block on.
      return { id: "source-contradiction", severity: "review", message: `Caption mentions ${agency} near negation language ("no", "doesn't", etc.), and the cited source URL (${host}) is that agency's domain -- read the surrounding sentence to confirm this isn't a self-contradictory attribution (like claiming the data ISN'T from an agency whose domain is then cited as the source).` };
    }
  }
  return { id: "source-contradiction", severity: "pass", message: "Source attribution doesn't contradict the caption's own disclaimers." };
}

// ── Check: causal language without an evidentiary basis ─────────────────
function checkCausalLanguage(caption) {
  const hook = firstParagraph(caption);
  const m = hook.match(/\b(because|causes?|caused by|leads? to|due to|drives?|driven by|results? in)\b/i);
  if (!m) return { id: "causal-language", severity: "pass", message: "No causal language in the opening paragraph." };
  return { id: "causal-language", severity: "review", message: `Opening paragraph uses causal language ("${m[0]}") -- confirm the underlying data supports causation, not just correlation, or soften to "associated with"/"coincides with".` };
}

// ── Check: extreme magnitude values worth a second look ──────────────────
function checkMagnitudeSanity(caption) {
  const hook = firstParagraph(caption);
  const flags = [];
  for (const m of hook.matchAll(/([+-]?\d+(?:\.\d+)?)\s*%/g)) {
    const v = Math.abs(Number(m[1]));
    if (v >= 200) flags.push(`${m[0].trim()}`);
  }
  for (const m of hook.matchAll(/(\d+(?:\.\d+)?)\s*[x×]\b/gi)) {
    const v = Number(m[1]);
    if (v >= 15) flags.push(`${m[0].trim()}`);
  }
  if (flags.length) {
    return { id: "magnitude-sanity", severity: "review", message: `Large magnitude value(s) in the opening paragraph worth double-checking: ${flags.join(", ")}. Not necessarily wrong -- just the kind of number worth re-verifying against the source.` };
  }
  return { id: "magnitude-sanity", severity: "pass", message: "No extreme magnitude values flagged." };
}

// ── Check: stale-sounding immediacy language ──────────────────────────────
function checkStaleLanguage(caption, stampDate) {
  const hook = firstParagraph(caption);
  if (!/\b(today|currently|right now|as of now|this year)\b/i.test(hook)) {
    return { id: "stale-language", severity: "pass", message: "No immediacy language ('today', 'currently', etc.) in the opening paragraph." };
  }
  const dateMatches = [...caption.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  if (!dateMatches.length) return { id: "stale-language", severity: "review", message: "Uses immediacy language ('today'/'currently') but no year found in the caption to check freshness against." };
  const newestYearMentioned = Math.max(...dateMatches);
  const currentYear = new Date(stampDate || Date.now()).getFullYear();
  if (currentYear - newestYearMentioned >= 2) {
    return { id: "stale-language", severity: "review", message: `Uses immediacy language ('today'/'currently') but the most recent year mentioned is ${newestYearMentioned}, ${currentYear - newestYearMentioned} years old -- consider softening to "as of ${newestYearMentioned}" instead.` };
  }
  return { id: "stale-language", severity: "pass", message: "Immediacy language used with reasonably current data." };
}

// ── Roll-up ────────────────────────────────────────────────────────────
export function validatePost({ txt, csv, html, stampDate }) {
  const checks = [];
  checks.push(checkCaptionMarker(txt));
  const captionOk = hasMarker(txt) && extractCaptionRaw(txt).trim();
  if (captionOk) {
    const caption = prepareFacebookCaption(txt); // final caption, footer included
    const csvRows = csv ? parseCSV(csv) : { header: [], rows: [] };
    checks.push(checkHeadlineMatchesTopRow(caption, csvRows));
    checks.push(checkHookNumbersInCsv(caption, csvRows));
    checks.push(checkSourceDomain(caption));
    checks.push(checkSourceNotSelfContradicting(caption));
    checks.push(checkCausalLanguage(caption));
    checks.push(checkMagnitudeSanity(caption));
    checks.push(checkStaleLanguage(caption, stampDate));
  }
  checks.push(checkNoUndefinedInHtml(html));

  const fails = checks.filter((c) => c.severity === "fail");
  const reviews = checks.filter((c) => c.severity === "review");
  const verdict = fails.length ? "fail" : reviews.length ? "review" : "pass";
  return { verdict, checks, fails, reviews };
}
