#!/usr/bin/env node
// congress-votes.mjs — real congressional bill & roll-call vote data.
//
// Two modes:
//   landmark   Curated set of verified historic roll calls (slavery, civil
//              rights, voting rights, women's rights), 1864-1972, with full
//              yea/nay + party-line breakdown. Source: Voteview (UCLA/Stanford,
//              built from ICPSR-digitized congressional roll calls back to
//              1789 — the standard academic archive; keyless).
//   year       Enacted public laws for a given year (1973+, when Congress.gov's
//              API coverage starts) ranked by how close/contested their floor
//              vote was — the closest vote is the best available audited proxy
//              for "controversial" since Congress.gov does not publish view
//              counts or any "most viewed" metric. Source: Congress.gov API
//              (official, Library of Congress) + Senate.gov roll-call XML for
//              Senate vote tallies (Congress.gov's API only carries House
//              roll calls directly).
//
// Run:
//   node scripts/congress-votes.mjs landmark
//   node scripts/congress-votes.mjs landmark --topic slavery|civil-rights|voting-rights|womens-rights
//   node scripts/congress-votes.mjs year --year 2023
//   node scripts/congress-votes.mjs year --year 2023 --top 5 --limit 150
//
// A free Congress.gov API key is recommended for `year` mode (the shared
// DEMO_KEY works but is tightly rate-limited): sign up at
// https://api.congress.gov/sign-up/ and set CONGRESS_API_KEY in .env.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function getCongressKey() {
  if (process.env.CONGRESS_API_KEY) return process.env.CONGRESS_API_KEY;
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^CONGRESS_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return "DEMO_KEY"; // shared demo key: works, but low/shared rate limit
}

function localDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

// ── tiny quote-aware CSV parser (Voteview fields contain embedded commas) ──
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") {
      if (text[i - 1] !== "\r" || field !== "" || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
      row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const voteviewCache = new Map();
async function voteviewCSV(kind, congress) {
  const key = `${kind}:${congress}`;
  if (voteviewCache.has(key)) return voteviewCache.get(key);
  const cc = String(congress).padStart(3, "0");
  const url = `https://voteview.com/static/data/out/${kind}/HS${cc}_${kind}.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Voteview ${res.status} for ${url}`);
  const parsed = parseCSV(await res.text());
  voteviewCache.set(key, parsed);
  return parsed;
}

const PARTY_NAMES = {
  100: "Democrat", 200: "Republican", 108: "Anti-Lecompton Dem.", 117: "Unionist",
  203: "Unconditional Unionist", 206: "Unionist", 208: "Liberal Republican",
  213: "Progressive Republican", 328: "Independent", 329: "Independent Dem.",
  331: "Independent Rep.", 340: "Populist", 347: "Prohibitionist", 380: "American Labor",
};
const partyName = (code) => PARTY_NAMES[Number(code)] || `Party ${code}`;
const isYea = (castCode) => [1, 2, 3].includes(Number(castCode));
const isNay = (castCode) => [4, 5, 6].includes(Number(castCode));

async function landmarkVoteDetail({ congress, chamber, rollnumber }) {
  const [rollcalls, votes, members] = await Promise.all([
    voteviewCSV("rollcalls", congress),
    voteviewCSV("votes", congress),
    voteviewCSV("members", congress),
  ]);
  const rc = rollcalls.find((r) => r.chamber === chamber && Number(r.rollnumber) === rollnumber);
  if (!rc) throw new Error(`Roll call not found: congress ${congress} ${chamber} #${rollnumber}`);

  const memberByIcpsr = new Map(members.filter((m) => m.chamber === chamber).map((m) => [m.icpsr, m]));
  const partyTally = new Map(); // party code -> {yea, nay}
  let yea = 0, nay = 0;
  for (const v of votes) {
    if (v.chamber !== chamber || Number(v.rollnumber) !== rollnumber) continue;
    const m = memberByIcpsr.get(v.icpsr);
    const party = m ? m.party_code : "?";
    if (!partyTally.has(party)) partyTally.set(party, { yea: 0, nay: 0 });
    const t = partyTally.get(party);
    if (isYea(v.cast_code)) { yea++; t.yea++; }
    else if (isNay(v.cast_code)) { nay++; t.nay++; }
  }

  const partyBreakdown = [...partyTally.entries()]
    .sort((a, b) => (b[1].yea + b[1].nay) - (a[1].yea + a[1].nay))
    .map(([code, t]) => `${partyName(code)} ${t.yea}-${t.nay}`)
    .join(", ");

  const url = `https://voteview.com/rollcall/${chamber[0]}${congress}${rollnumber}`;
  // rc.yea_count/nay_count are the official published tallies (what histories
  // cite); the member-level recount above can differ slightly on paired or
  // announced votes, so it's used only for the party breakdown, not the headline.
  return {
    date: rc.date,
    desc: rc.dtl_desc || rc.vote_desc,
    billNumber: rc.bill_number,
    yea: Number(rc.yea_count),
    nay: Number(rc.nay_count),
    partyBreakdown,
    partyBreakdownTotal: yea + nay,
    url,
  };
}

const LANDMARK_VOTES = [
  {
    theme: "Slavery", title: "13th Amendment — abolishing slavery", congress: 38,
    entries: [
      { chamber: "Senate", rollnumber: 134, label: "Initial Senate passage" },
      { chamber: "House", rollnumber: 480, label: "Final House passage (sent to states)" },
    ],
  },
  {
    theme: "Reconstruction / Civil Rights", title: "Civil Rights Act of 1866 — first federal civil rights law", congress: 39,
    entries: [
      { chamber: "Senate", rollnumber: 31, label: "Initial Senate passage" },
      { chamber: "House", rollnumber: 120, label: "Initial House passage" },
      { chamber: "Senate", rollnumber: 94, label: "Senate overrides Andrew Johnson's veto" },
      { chamber: "House", rollnumber: 154, label: "House overrides veto (enacted into law)" },
    ],
  },
  {
    theme: "Reconstruction / Civil Rights", title: "14th Amendment — citizenship & equal protection", congress: 39,
    entries: [
      { chamber: "Senate", rollnumber: 153, label: "Senate passage" },
      { chamber: "House", rollnumber: 259, label: "House concurs in Senate amendments (final passage)" },
    ],
  },
  {
    theme: "Voting Rights", title: "15th Amendment — voting rights regardless of race", congress: 40,
    entries: [
      { chamber: "House", rollnumber: 666, label: "House agrees to conference report (final passage)" },
      { chamber: "Senate", rollnumber: 688, label: "Senate agrees to conference report (final passage)" },
    ],
  },
  {
    theme: "Women's Rights", title: "19th Amendment — women's suffrage", congress: 66,
    entries: [
      { chamber: "House", rollnumber: 2, label: "House passage" },
      { chamber: "Senate", rollnumber: 13, label: "Senate passage" },
    ],
  },
  {
    theme: "Civil Rights", title: "Civil Rights Act of 1964", congress: 88,
    entries: [
      { chamber: "House", rollnumber: 128, label: "Initial House passage" },
      { chamber: "Senate", rollnumber: 409, label: "Senate passage (after cloture ending the filibuster)" },
      { chamber: "House", rollnumber: 182, label: "Final House adoption of Senate-amended bill (enacted)" },
    ],
  },
  {
    theme: "Voting Rights", title: "Voting Rights Act of 1965", congress: 89,
    entries: [
      { chamber: "Senate", rollnumber: 78, label: "Initial Senate passage" },
      { chamber: "House", rollnumber: 87, label: "Initial House passage" },
      { chamber: "House", rollnumber: 107, label: "House agrees to conference report" },
      { chamber: "Senate", rollnumber: 178, label: "Senate agrees to conference report (enacted)" },
    ],
  },
  {
    theme: "Civil Rights", title: "Fair Housing Act of 1968 (Civil Rights Act of 1968)", congress: 90,
    entries: [
      { chamber: "House", rollnumber: 113, label: "Initial House passage (pre-fair-housing version)" },
      { chamber: "Senate", rollnumber: 346, label: "Senate passage with fair-housing title added" },
      { chamber: "House", rollnumber: 295, label: "Final House adoption of Senate-amended bill (enacted, days after Dr. King's assassination)" },
    ],
  },
  {
    theme: "Women's Rights", title: "Equal Rights Amendment (passed Congress 1972; ratification deadline later expired)", congress: 92,
    entries: [
      { chamber: "House", rollnumber: 197, label: "House passage" },
      { chamber: "Senate", rollnumber: 533, label: "Senate passage (sent to states)" },
    ],
  },
];

const TOPIC_ALIASES = {
  slavery: "Slavery",
  "civil-rights": "Civil Rights",
  "voting-rights": "Voting Rights",
  "womens-rights": "Women's Rights",
};

async function runLandmark() {
  const topicArg = argValue("--topic", null);
  const topicFilter = topicArg ? TOPIC_ALIASES[topicArg] : null;
  if (topicArg && !topicFilter) throw new Error(`Unknown --topic "${topicArg}". Use one of: ${Object.keys(TOPIC_ALIASES).join(", ")}`);

  const bills = LANDMARK_VOTES.filter((b) => !topicFilter || b.theme.includes(topicFilter) || b.theme === topicFilter);
  if (!bills.length) throw new Error(`No landmark votes match --topic ${topicArg}`);

  const lines = [`Landmark congressional roll-call votes${topicFilter ? ` — ${topicFilter}` : ""}`, ""];
  const csvRows = [];

  for (const bill of bills) {
    lines.push(`${bill.title}  [${bill.theme}]`);
    for (const e of bill.entries) {
      const d = await landmarkVoteDetail({ congress: bill.congress, chamber: e.chamber, rollnumber: e.rollnumber });
      const margin = d.yea - d.nay;
      lines.push(`  ${d.date} — ${e.chamber} — ${e.label}`);
      lines.push(`    Yea ${d.yea} – Nay ${d.nay}  (margin ${margin >= 0 ? "+" : ""}${margin})`);
      if (d.partyBreakdown) {
        const note = d.partyBreakdownTotal !== d.yea + d.nay ? " (member-level recount differs slightly — paired/announced votes)" : "";
        lines.push(`    By party: ${d.partyBreakdown}${note}`);
      }
      lines.push(`    ${d.url}`);
      csvRows.push([bill.theme, bill.title, e.chamber, d.date, e.label, d.yea, d.nay, d.partyBreakdown, d.url]);
    }
    lines.push("");
  }
  lines.push("Source: Voteview (UCLA/Stanford, ICPSR-digitized congressional roll calls, 1789–present) — https://voteview.com");

  console.log(lines.join("\n"));

  mkdirSync(SOCIAL, { recursive: true });
  const stamp = localDateStamp();
  const outBase = path.join(SOCIAL, `congress-votes-landmark-${stamp}`);
  writeFileSync(`${outBase}.txt`, lines.join("\n"));
  writeFileSync(`${outBase}.csv`, toCSV(
    ["theme", "bill", "chamber", "date", "vote_label", "yea", "nay", "party_breakdown", "source_url"],
    csvRows
  ));
  console.log(`\nFiles: ${rel(`${outBase}.txt`)} / ${rel(`${outBase}.csv`)}`);
}

// ── year mode: Congress.gov (enacted laws) + Senate.gov XML (Senate tallies) ──
function congressForYear(year) {
  return Math.floor((year - 1789) / 2) + 1;
}

async function congressAPI(key, pathq) {
  const sep = pathq.includes("?") ? "&" : "?";
  const res = await fetch(`https://api.congress.gov/v3${pathq}${sep}api_key=${key}&format=json`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Congress.gov API HTTP ${res.status}: ${text.slice(0, 300)}` +
      (key === "DEMO_KEY" ? "\n(Using the shared DEMO_KEY — get a free key at https://api.congress.gov/sign-up/ and set CONGRESS_API_KEY in .env.)" : ""));
  }
  return JSON.parse(text);
}

async function senateVoteTally(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const xml = await res.text();
  const yeas = Number(xml.match(/<yeas>(\d+)<\/yeas>/)?.[1]);
  const nays = Number(xml.match(/<nays>(\d+)<\/nays>/)?.[1]);
  if (!Number.isFinite(yeas) || !Number.isFinite(nays)) return null;
  return { yea: yeas, nay: nays };
}

async function houseVoteTally(key, congress, session, rollNumber) {
  const json = await congressAPI(key, `/house-vote/${congress}/${session}/${rollNumber}`);
  const totals = json.houseRollCallVote?.votePartyTotal || [];
  const yea = totals.reduce((s, t) => s + (t.yeaTotal || 0), 0);
  const nay = totals.reduce((s, t) => s + (t.nayTotal || 0), 0);
  return { yea, nay };
}

async function runYear() {
  const year = Number(argValue("--year"));
  if (!year || year < 1973) throw new Error("--year is required and must be 1973 or later (Congress.gov API coverage starts in 1973).");
  const top = Number(argValue("--top", "5"));
  const limit = Number(argValue("--limit", "150"));
  const key = getCongressKey();
  const congress = congressForYear(year);

  console.log(`Fetching enacted public laws for ${year} (${congress}th Congress)...`);
  // The /law list isn't sorted chronologically, so we must page through the
  // *entire* congress (cheap — one call per 250 laws) before filtering by
  // year; only the per-bill vote lookups below are expensive enough to cap.
  let laws = [], offset = 0;
  for (;;) {
    const page = await congressAPI(key, `/law/${congress}?limit=250&offset=${offset}`);
    const batch = page.bills || [];
    laws.push(...batch);
    offset += 250;
    if (offset >= (page.pagination?.count ?? laws.length) || batch.length < 250) break;
  }
  laws = laws.filter((b) => b.latestAction?.actionDate?.startsWith(String(year)));
  const truncated = laws.length > limit;
  laws = laws.slice(0, limit);
  if (truncated) {
    console.log(`Note: ${year} had more than ${limit} enacted laws — examining the first ${limit} (--limit to raise this).`);
  }

  const results = [];
  for (const b of laws) {
    try {
      const actions = await congressAPI(key, `/bill/${congress}/${b.type.toLowerCase()}/${b.number}/actions?limit=250`);
      const votes = (actions.actions || []).flatMap((a) => a.recordedVotes || []);
      let best = null;
      for (const v of votes) {
        let tally = null;
        if (v.chamber === "House") tally = await houseVoteTally(key, v.congress, v.sessionNumber, v.rollNumber);
        else if (v.chamber === "Senate" && v.url) tally = await senateVoteTally(v.url);
        if (!tally || tally.yea + tally.nay === 0) continue;
        const total = tally.yea + tally.nay;
        const margin = Math.abs(tally.yea - tally.nay) / total;
        const entry = { chamber: v.chamber, date: v.date?.slice(0, 10), rollNumber: v.rollNumber, ...tally, margin };
        if (!best || margin < best.margin) best = entry;
      }
      results.push({
        title: b.title,
        billId: `${b.type} ${b.number}`,
        law: b.laws?.[0]?.number || "",
        enactedDate: b.latestAction?.actionDate,
        vote: best,
      });
    } catch (e) {
      console.error(`  (skipped ${b.type} ${b.number}: ${e.message.split("\n")[0]})`);
    }
  }

  const withVotes = results.filter((r) => r.vote);
  withVotes.sort((a, b) => a.vote.margin - b.vote.margin);
  const topContested = withVotes.slice(0, top);

  const lines = [
    `Enacted public laws, ${year} (${congress}th Congress) — ranked by closest recorded floor vote`,
    "",
    `${results.length} enacted laws examined, ${withVotes.length} had a recorded roll-call vote on file.`,
    "\"Most viewed\" isn't public data Congress.gov or any audited source publishes — closeness of the vote (smallest yea/nay margin) is used here as the objective stand-in for \"contested/controversial.\"",
    "",
  ];
  topContested.forEach((r, i) => {
    const v = r.vote;
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${r.billId}${r.law ? ` — ${r.law}` : ""} — enacted ${r.enactedDate}`);
    lines.push(`   Closest vote: ${v.chamber} ${v.date} — Yea ${v.yea} – Nay ${v.nay} (${(v.margin * 100).toFixed(1)}% margin)`);
    lines.push("");
  });
  lines.push("Sources: Congress.gov API (bill status, House roll calls) + Senate.gov roll-call XML (Senate tallies).");

  console.log(lines.join("\n"));

  mkdirSync(SOCIAL, { recursive: true });
  const outBase = path.join(SOCIAL, `congress-votes-${year}-${localDateStamp()}`);
  writeFileSync(`${outBase}.txt`, lines.join("\n"));
  writeFileSync(`${outBase}.csv`, toCSV(
    ["rank", "bill_id", "title", "law_number", "enacted_date", "vote_chamber", "vote_date", "yea", "nay", "margin_pct"],
    topContested.map((r, i) => [i + 1, r.billId, r.title, r.law, r.enactedDate, r.vote.chamber, r.vote.date, r.vote.yea, r.vote.nay, (r.vote.margin * 100).toFixed(1)])
  ));
  console.log(`\nFiles: ${rel(`${outBase}.txt`)} / ${rel(`${outBase}.csv`)}`);
}

const mode = process.argv[2];
if (mode === "landmark") await runLandmark();
else if (mode === "year") await runYear();
else {
  console.error("Usage:\n  node scripts/congress-votes.mjs landmark [--topic slavery|civil-rights|voting-rights|womens-rights]\n  node scripts/congress-votes.mjs year --year 2023 [--top 5] [--limit 150]");
  process.exit(1);
}
