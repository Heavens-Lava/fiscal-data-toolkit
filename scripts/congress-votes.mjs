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
//   node scripts/congress-votes.mjs timeline --start 2016 --end 2025
//
// A free Congress.gov API key is recommended for `year` mode (the shared
// DEMO_KEY works but is tightly rate-limited): sign up at
// https://api.congress.gov/sign-up/ and set CONGRESS_API_KEY in .env.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { C, cardHTML, engagementCTA, esc, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = path.join(ROOT, "social");
const CACHE = path.join(ROOT, ".cache", "congress-votes");

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

function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] || "th"}`;
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

  const parties = [...partyTally.entries()]
    .map(([code, t]) => ({ code, name: partyName(code), yea: t.yea, nay: t.nay }))
    .sort((a, b) => (b.yea + b.nay) - (a.yea + a.nay));
  const partyBreakdown = parties.map((p) => `${p.name} ${p.yea}-${p.nay}`).join(", ");

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
    parties,
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
  {
    theme: "Nuclear Arms Treaties", title: "Nuclear Non-Proliferation Treaty (1968)", congress: 91,
    entries: [{ chamber: "Senate", rollnumber: 16, label: "Resolution of ratification agreed to" }],
  },
  {
    theme: "Nuclear Arms Treaties", title: "ABM Treaty & SALT I Interim Agreement — with the Soviet Union (1972)", congress: 92,
    entries: [{ chamber: "Senate", rollnumber: 742, label: "Resolution of ratification agreed to" }],
  },
  {
    theme: "Nuclear Arms Treaties", title: "INF Treaty — with the Soviet Union (1988)", congress: 100,
    entries: [{ chamber: "Senate", rollnumber: 586, label: "Resolution of ratification agreed to" }],
  },
  {
    theme: "Nuclear Arms Treaties", title: "START I — with the Soviet Union (1992)", congress: 102,
    entries: [{ chamber: "Senate", rollnumber: 533, label: "Resolution of ratification agreed to" }],
  },
  {
    theme: "Nuclear Arms Treaties", title: "START II — with Russia (1996; signed 1993, never entered into force after Russia later withdrew)", congress: 104,
    entries: [{ chamber: "Senate", rollnumber: 619, label: "Resolution of ratification agreed to" }],
  },
  {
    theme: "Nuclear Arms Treaties", title: "Moscow Treaty (SORT) — with Russia (2003)", congress: 108,
    entries: [{ chamber: "Senate", rollnumber: 43, label: "Resolution of ratification agreed to" }],
  },
  {
    theme: "Nuclear Arms Treaties", title: "New START — with Russia (2010)", congress: 111,
    entries: [{ chamber: "Senate", rollnumber: 695, label: "Resolution of ratification agreed to" }],
  },
];

const BILL_SLUGS = {
  "13th Amendment — abolishing slavery": "13th-amendment",
  "Civil Rights Act of 1866 — first federal civil rights law": "civil-rights-act-1866",
  "14th Amendment — citizenship & equal protection": "14th-amendment",
  "15th Amendment — voting rights regardless of race": "15th-amendment",
  "19th Amendment — women's suffrage": "19th-amendment",
  "Civil Rights Act of 1964": "civil-rights-act-1964",
  "Voting Rights Act of 1965": "voting-rights-act-1965",
  "Fair Housing Act of 1968 (Civil Rights Act of 1968)": "fair-housing-act-1968",
  "Equal Rights Amendment (passed Congress 1972; ratification deadline later expired)": "era-1972",
  "Nuclear Non-Proliferation Treaty (1968)": "npt-1968",
  "ABM Treaty & SALT I Interim Agreement — with the Soviet Union (1972)": "abm-salt-1-1972",
  "INF Treaty — with the Soviet Union (1988)": "inf-treaty-1988",
  "START I — with the Soviet Union (1992)": "start-1-1992",
  "START II — with Russia (1996; signed 1993, never entered into force after Russia later withdrew)": "start-2-1996",
  "Moscow Treaty (SORT) — with Russia (2003)": "moscow-treaty-2003",
  "New START — with Russia (2010)": "new-start-2010",
};

const BILL_NOUN = {
  "13th Amendment — abolishing slavery": "the 13th Amendment",
  "Civil Rights Act of 1866 — first federal civil rights law": "the Civil Rights Act of 1866",
  "14th Amendment — citizenship & equal protection": "the 14th Amendment",
  "15th Amendment — voting rights regardless of race": "the 15th Amendment",
  "19th Amendment — women's suffrage": "the 19th Amendment",
  "Civil Rights Act of 1964": "the Civil Rights Act of 1964",
  "Voting Rights Act of 1965": "the Voting Rights Act of 1965",
  "Fair Housing Act of 1968 (Civil Rights Act of 1968)": "the Fair Housing Act of 1968",
  "Equal Rights Amendment (passed Congress 1972; ratification deadline later expired)": "the Equal Rights Amendment",
  "Nuclear Non-Proliferation Treaty (1968)": "the Nuclear Non-Proliferation Treaty",
  "ABM Treaty & SALT I Interim Agreement — with the Soviet Union (1972)": "the ABM Treaty and SALT I Interim Agreement",
  "INF Treaty — with the Soviet Union (1988)": "the INF Treaty",
  "START I — with the Soviet Union (1992)": "the START I Treaty",
  "START II — with Russia (1996; signed 1993, never entered into force after Russia later withdrew)": "the START II Treaty",
  "Moscow Treaty (SORT) — with Russia (2003)": "the Moscow Treaty",
  "New START — with Russia (2010)": "New START",
};

const TOPIC_ALIASES = {
  slavery: "Slavery",
  "civil-rights": "Civil Rights",
  "voting-rights": "Voting Rights",
  "womens-rights": "Women's Rights",
  treaties: "Nuclear Arms Treaties",
};

const SHORT_TITLE = {
  "13th Amendment — abolishing slavery": "13th Amendment",
  "Civil Rights Act of 1866 — first federal civil rights law": "Civil Rights Act of 1866",
  "14th Amendment — citizenship & equal protection": "14th Amendment",
  "15th Amendment — voting rights regardless of race": "15th Amendment",
  "19th Amendment — women's suffrage": "19th Amendment",
  "Civil Rights Act of 1964": "Civil Rights Act of 1964",
  "Voting Rights Act of 1965": "Voting Rights Act of 1965",
  "Fair Housing Act of 1968 (Civil Rights Act of 1968)": "Fair Housing Act",
  "Equal Rights Amendment (passed Congress 1972; ratification deadline later expired)": "ERA",
  "Nuclear Non-Proliferation Treaty (1968)": "Non-Proliferation Treaty",
  "ABM Treaty & SALT I Interim Agreement — with the Soviet Union (1972)": "ABM Treaty / SALT I",
  "INF Treaty — with the Soviet Union (1988)": "INF Treaty",
  "START I — with the Soviet Union (1992)": "START I",
  "START II — with Russia (1996; signed 1993, never entered into force after Russia later withdrew)": "START II",
  "Moscow Treaty (SORT) — with Russia (2003)": "Moscow Treaty",
  "New START — with Russia (2010)": "New START",
};

// One sentence of plain-English context per bill — why it mattered, kept
// separate from the vote data itself so the chart stays about the numbers.
const WHY_IT_MATTERED = {
  "13th Amendment — abolishing slavery": "Abolished slavery and involuntary servitude nationwide, except as criminal punishment.",
  "Civil Rights Act of 1866 — first federal civil rights law": "First federal law declaring formerly enslaved people full U.S. citizens with equal rights under law.",
  "14th Amendment — citizenship & equal protection": "Guaranteed citizenship and equal protection under the law to all persons born in the U.S.",
  "15th Amendment — voting rights regardless of race": "Barred states from denying the vote based on race, color, or previous servitude.",
  "19th Amendment — women's suffrage": "Guaranteed women the constitutional right to vote nationwide.",
  "Civil Rights Act of 1964": "Outlawed discrimination based on race, color, religion, sex, or national origin in public life and employment.",
  "Voting Rights Act of 1965": "Banned literacy tests and other discriminatory voting barriers; authorized federal oversight of elections in areas with a history of discrimination.",
  "Fair Housing Act of 1968 (Civil Rights Act of 1968)": "Prohibited discrimination in the sale, rental, and financing of housing.",
  "Equal Rights Amendment (passed Congress 1972; ratification deadline later expired)": "Would have guaranteed equal legal rights regardless of sex; passed Congress but fell short of ratification by enough states before its deadline.",
  "Nuclear Non-Proliferation Treaty (1968)": "The cornerstone global treaty against the spread of nuclear weapons — nuclear-armed states agreed to pursue disarmament, non-nuclear states agreed not to acquire them.",
  "ABM Treaty & SALT I Interim Agreement — with the Soviet Union (1972)": "First U.S.-Soviet nuclear arms control agreement — capped anti-ballistic missile systems and froze the number of strategic missile launchers. (The follow-up SALT II treaty, signed 1979, was never brought to a Senate vote at all after the Soviet invasion of Afghanistan — the Senate shelved it rather than voting it down.)",
  "INF Treaty — with the Soviet Union (1988)": "Eliminated an entire class of weapons — all U.S. and Soviet land-based missiles with ranges of 500–5,500 km. The U.S. withdrew from it in 2019, citing Russian violations.",
  "START I — with the Soviet Union (1992)": "First treaty to require actual reductions (not just caps) in U.S. and Soviet/Russian long-range nuclear arsenals; ratified as the USSR was dissolving.",
  "START II — with Russia (1996; signed 1993, never entered into force after Russia later withdrew)": "Would have banned multiple-warhead land-based missiles; the Senate ratified it, but Russia withdrew in 2002 after the U.S. left the ABM Treaty, so it never took effect.",
  "Moscow Treaty (SORT) — with Russia (2003)": "A brief, simple treaty committing both sides to cut deployed strategic warheads to 1,700–2,200 each within 10 years, with no verification mechanism of its own.",
  "New START — with Russia (2010)": "Capped deployed U.S. and Russian strategic warheads and launchers; extended in 2021 for a final five years, expiring February 2026 — check current reporting for what (if anything) has replaced it.",
};

const SINGLE_POST_HOOK = {
  "Civil Rights Act of 1866 — first federal civil rights law": "Congress enacted the Civil Rights Act of 1866 over a presidential veto. The decisive House override vote was 122–41.",
  "14th Amendment — citizenship & equal protection": "The amendment that guarantees citizenship and equal protection passed the House 137–37 in 1866.",
  "Civil Rights Act of 1964": "The Civil Rights Act of 1964 passed the House 289–126, with majorities of both represented parties voting yes.",
  "Fair Housing Act of 1968 (Civil Rights Act of 1968)": "Congress passed the Fair Housing Act 250–172, only days after Dr. Martin Luther King Jr. was assassinated.",
};

const COALITION_NOTE = "Party coalitions have shifted substantially since these dates — today's Democratic and Republican parties are not the same coalitions as in 1865, 1919, or 1968. This is a historical voting record, not a comparison to today's parties.";

async function billResultsFor(bills) {
  const out = [];
  for (const bill of bills) {
    const entries = [];
    for (const e of bill.entries) {
      const d = await landmarkVoteDetail({ congress: bill.congress, chamber: e.chamber, rollnumber: e.rollnumber });
      entries.push({ ...e, ...d });
    }
    out.push({ ...bill, entries });
  }
  return out;
}

function writeLandmarkText(bills, topicFilter) {
  const lines = [`Landmark congressional roll-call votes${topicFilter ? ` — ${topicFilter}` : ""}`, ""];
  const csvRows = [];
  for (const bill of bills) {
    lines.push(`${bill.title}  [${bill.theme}]`);
    for (const e of bill.entries) {
      const margin = e.yea - e.nay;
      lines.push(`  ${e.date} — ${e.chamber} — ${e.label}`);
      lines.push(`    Yea ${e.yea} – Nay ${e.nay}  (margin ${margin >= 0 ? "+" : ""}${margin})`);
      if (e.partyBreakdown) {
        const note = e.partyBreakdownTotal !== e.yea + e.nay ? " (member-level recount differs slightly — paired/announced votes)" : "";
        lines.push(`    By party: ${e.partyBreakdown}${note}`);
      }
      lines.push(`    ${e.url}`);
      csvRows.push([bill.theme, bill.title, e.chamber, e.date, e.label, e.yea, e.nay, e.partyBreakdown, e.url]);
    }
    lines.push("");
  }
  lines.push("Source: Voteview (UCLA/Stanford, ICPSR-digitized congressional roll calls, 1789–present) — https://voteview.com");
  return { lines, csvRows };
}

function billYearLabel(bill) {
  const decisive = bill.entries[bill.entries.length - 1];
  const year = new Date(decisive.date).getUTCFullYear();
  const base = SHORT_TITLE[bill.title] || bill.title;
  return base.includes(String(year)) ? base : `${base} (${year})`;
}

function buildLandmarkSocial(bills, topicFilter) {
  // Two bars per bill — the Democrat and Republican "yea" share on the
  // decisive/enacted vote — instead of one collapsed overall-yea bar. Party
  // is the story on every one of these votes (e.g. 1866/1964/1965/1968 split
  // very differently along party lines than the 1919/1920s amendments did),
  // and a single blended percentage erases that.
  const PARTY_COLOR = { Democrat: "#2E6DB4", Republican: "#C43B3B" }; // muted D/R blue-red
  const decisiveOnly = bills.map((bill) => bill.entries[bill.entries.length - 1]);
  const points = bills.flatMap((bill, i) => {
    const e = decisiveOnly[i];
    const label = billYearLabel(bill);
    return ["Democrat", "Republican"]
      .map((name) => ({ name, p: e.parties.find((x) => x.name === name) }))
      .filter((x) => x.p && x.p.yea + x.p.nay > 0)
      .map(({ name, p }) => ({
        label: bills.length > 1 ? `${label} — ${name[0]} (${p.yea}-${p.nay})` : `${name} (${p.yea}-${p.nay})`,
        v: (p.yea / (p.yea + p.nay)) * 100,
        color: PARTY_COLOR[name],
        bill, entry: e, party: name, partyDetail: p,
      }));
  });
  const demPts = points.filter((p) => p.party === "Democrat");
  const repPts = points.filter((p) => p.party === "Republican");
  const avgDem = demPts.length ? demPts.reduce((s, p) => s + p.v, 0) / demPts.length : null;
  const avgRep = repPts.length ? repPts.reduce((s, p) => s + p.v, 0) / repPts.length : null;

  const chartSVG = horizontalBarChart(
    points.map((p) => ({ label: p.label, v: p.v, color: p.color })),
    { fmtTick: (v) => `${v.toFixed(0)}%`, fmtVal: (v) => `${v.toFixed(0)}% yea` }
  );

  const congressRange = bills[0].congress === bills[bills.length - 1].congress
    ? `${ordinal(bills[0].congress)} Congress`
    : `${ordinal(bills[0].congress)}–${ordinal(bills[bills.length - 1].congress)} Congress`;
  const html = cardHTML({
    kicker: "Congressional Record series",
    title: `${topicFilter} votes in Congress`,
    hero: `D ${avgDem.toFixed(0)}% · R ${avgRep.toFixed(0)}%`,
    heroLabel: "average \"yes\" vote, by party (decisive vote on each bill)",
    legendHTML: `<div class="legend"><span style="display:flex;align-items:center;gap:8px;font-size:16px;color:${C.ink2}"><span style="width:12px;height:12px;border-radius:50%;background:${PARTY_COLOR.Democrat};display:inline-block"></span>Democrat</span><span style="display:flex;align-items:center;gap:8px;font-size:16px;color:${C.ink2}"><span style="width:12px;height:12px;border-radius:50%;background:${PARTY_COLOR.Republican};display:inline-block"></span>Republican</span></div><div style="font-size:12px;color:${C.muted};margin-top:6px;max-width:900px">${esc(COALITION_NOTE)}</div>`,
    chartSVG,
    source: "Voteview (UCLA/Stanford)",
    vintage: congressRange,
  });

  // Lead with the widest party gap in the set, if there is one — a bigger
  // hook than a generic "how did Congress vote" opener, and it's a real
  // number pulled from the data, not an editorial claim.
  const gaps = bills.map((bill) => {
    const decisive = bill.entries[bill.entries.length - 1];
    const d = decisive.parties.find((x) => x.name === "Democrat");
    const r = decisive.parties.find((x) => x.name === "Republican");
    if (!d || !r || d.yea + d.nay === 0 || r.yea + r.nay === 0) return null;
    const dPct = (d.yea / (d.yea + d.nay)) * 100, rPct = (r.yea / (r.yea + r.nay)) * 100;
    return { bill, dPct, rPct, gap: Math.abs(dPct - rPct) };
  }).filter(Boolean);
  const widestGap = gaps.length ? gaps.reduce((a, b) => (b.gap > a.gap ? b : a)) : null;

  const facebookLines = widestGap && widestGap.gap >= 25
    ? [`The starkest party split among these ${topicFilter.toLowerCase()} votes: on ${BILL_NOUN[widestGap.bill.title] || widestGap.bill.title}, Democrats voted ${widestGap.dPct.toFixed(0)}% yes and Republicans voted ${widestGap.rPct.toFixed(0)}% yes — a ${widestGap.gap.toFixed(0)}-point gap. Here's every vote in this series, real roll calls, member by member:`, ""]
    : [`How did Congress actually vote on ${topicFilter.toLowerCase()}? Real roll calls, member by member — not a paraphrase:`, ""];
  facebookLines.push("Each member of the House and Senate casts their own individual yea/nay vote on the floor — there's no state-level aggregate and no Electoral College involved (that's only for presidential elections). A House member's vote represents their own district; a Senator's represents their own vote, not a bloc for their whole state.");
  facebookLines.push("");
  for (const bill of bills) {
    const decisive = bill.entries[bill.entries.length - 1];
    facebookLines.push(`${bill.title} — ${decisive.date} (${decisive.chamber}, ${decisive.label.toLowerCase()}): Yea ${decisive.yea} – Nay ${decisive.nay}${decisive.partyBreakdown ? ` (${decisive.partyBreakdown})` : ""}.`);
    if (WHY_IT_MATTERED[bill.title]) facebookLines.push(`Why it mattered: ${WHY_IT_MATTERED[bill.title]}`);
  }
  facebookLines.push("");
  facebookLines.push(COALITION_NOTE);
  facebookLines.push("");
  facebookLines.push("Full member-by-member breakdown, every vote, every session:");
  facebookLines.push("https://voteview.com");
  facebookLines.push("");
  facebookLines.push(engagementCTA("generic", topicFilter));
  facebookLines.push("");
  facebookLines.push("Source website: https://voteview.com");
  facebookLines.push("Information retrieved programmatically via API.");
  facebookLines.push("Graphs made by Jeffrey Macy.");

  return { html, facebook: facebookLines.join("\n") };
}

const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${LONG_MONTHS[m - 1]} ${d}, ${y}`;
}

// Single-bill "stat block" card — one landmark vote as a complete, standalone
// story: the vote itself as the hero (not a blended percentage), party
// breakdown as its own row (bar + % + raw count together), and a one-line
// "why it mattered" box. Custom template rather than the shared cardHTML/
// horizontalBarChart primitives — this layout (PASSED banner, stat rows) is
// structurally different from every other chart in the toolkit.
function buildBillSocial(bill) {
  const decisive = bill.entries[bill.entries.length - 1];
  const PARTY_COLOR = { Democrat: "#2E6DB4", Republican: "#C43B3B" };
  const parties = ["Democrat", "Republican"]
    .map((name) => decisive.parties.find((p) => p.name === name))
    .filter(Boolean)
    .filter((p) => p.yea + p.nay > 0);

  const partyRows = parties.map((p) => {
    const pct = (p.yea / (p.yea + p.nay)) * 100;
    const color = PARTY_COLOR[p.name] || C.muted;
    return `<div class="party-row">
      <div class="party-name">${esc(p.name)}</div>
      <div class="party-bar-track"><div class="party-bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
      <div class="party-pct">${pct.toFixed(0)}%</div>
      <div class="party-count">${p.yea}-${p.nay}</div>
    </div>`;
  }).join("");

  const noun = BILL_NOUN[bill.title] || bill.title;
  const why = WHY_IT_MATTERED[bill.title] || "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1200px; height:675px; background:${C.surface}; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .accent { height:8px; display:flex; }
  .accent i { flex:1; }
  .card { width:100%; height:calc(100% - 8px); padding:40px 48px 30px; display:flex; flex-direction:column; }
  .kicker { font-size:15px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:${C.muted}; }
  h1 { font-size:34px; font-weight:650; color:${C.ink}; margin-top:8px; max-width:1000px; line-height:1.15; }
  .subtitle { font-size:17px; color:${C.ink2}; margin-top:6px; }
  .banner { display:flex; align-items:center; gap:24px; margin-top:16px; }
  .pill { background:#1baf7a; color:#fff; font-weight:700; font-size:15px; letter-spacing:0.05em; padding:8px 18px; border-radius:999px; }
  .vote-big { font-size:52px; font-weight:750; color:${C.ink}; line-height:1; }
  .vote-sub { font-size:15px; color:${C.ink2}; margin-top:3px; }
  .statbox { margin-top:16px; background:#fff; border:3px solid ${C.ink}; box-shadow:10px 10px 0 ${C.s1}; padding:18px 22px; display:flex; flex-direction:column; gap:12px; }
  .parties { display:flex; flex-direction:column; gap:12px; }
  .party-row { display:flex; align-items:center; gap:16px; }
  .party-name { width:140px; font-size:16px; font-weight:600; color:${C.ink2}; }
  .party-bar-track { flex:1; height:18px; background:${C.grid}; border-radius:6px; overflow:hidden; }
  .party-bar-fill { height:100%; border-radius:6px; }
  .party-pct { width:52px; text-align:right; font-size:16px; font-weight:700; color:${C.ink}; }
  .party-count { width:86px; text-align:right; font-size:14px; color:${C.muted}; }
  .why { background:#f2f1ea; border-left:4px solid ${C.s1}; padding:12px 16px; border-radius:4px; }
  .why-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:${C.muted}; }
  .why-text { font-size:14px; color:${C.ink2}; margin-top:3px; line-height:1.35; }
  .context { font-size:12px; color:${C.muted}; margin-top:10px; max-width:1080px; line-height:1.4; }
  .foot { margin-top:auto; padding-top:12px; display:flex; justify-content:space-between; font-size:14px; color:${C.muted}; }
  </style></head><body>
  <div class="accent"><i style="background:${C.s1}"></i><i style="background:${C.neg}"></i><i style="background:${C.s2}"></i></div>
  <div class="card">
    <div class="kicker">Congressional Record Series</div>
    <h1>How Congress voted on ${esc(noun)}</h1>
    <div class="subtitle">${esc(decisive.chamber)} · ${esc(longDate(decisive.date))} · ${esc(decisive.label)}</div>
    <div class="banner">
      <div class="pill">PASSED</div>
      <div><div class="vote-big">${decisive.yea}–${decisive.nay}</div><div class="vote-sub">${decisive.yea} YEAS · ${decisive.nay} NAYS</div></div>
    </div>
    <div class="statbox">
      <div class="parties">${partyRows}</div>
      ${why ? `<div class="why"><div class="why-label">Why it mattered</div><div class="why-text">${esc(why)}</div></div>` : ""}
    </div>
    <div class="context">${esc(COALITION_NOTE)}</div>
    <div class="foot"><span>Source: Voteview (UCLA/Stanford) · Chart: Jeff Macy</span><span>${ordinal(bill.congress)} Congress</span></div>
  </div></body></html>`;

  const dParty = decisive.parties.find((x) => x.name === "Democrat");
  const rParty = decisive.parties.find((x) => x.name === "Republican");
  const partyGap = dParty && rParty && dParty.yea + dParty.nay > 0 && rParty.yea + rParty.nay > 0
    ? Math.abs((dParty.yea / (dParty.yea + dParty.nay)) - (rParty.yea / (rParty.yea + rParty.nay))) * 100
    : null;
  const openHook = SINGLE_POST_HOOK[bill.title] || (partyGap !== null && partyGap >= 25
    ? `Congress passed ${noun} ${decisive.yea}–${decisive.nay} — but that number hides a ${partyGap.toFixed(0)}-point party split. The actual roll call, member by member:`
    : `Congress passed ${noun} ${decisive.yea}–${decisive.nay}. The actual roll call, member by member — not a paraphrase:`);
  const facebookLines = [openHook, ""];
  facebookLines.push(`${decisive.chamber} · ${longDate(decisive.date)} · ${decisive.label}`);
  facebookLines.push(`Result: PASSED, ${decisive.yea}–${decisive.nay}${decisive.partyBreakdown ? ` (${decisive.partyBreakdown})` : ""}.`);
  const initial = bill.entries[0];
  if (initial !== decisive) {
    facebookLines.push(`Earlier — ${initial.chamber}, ${longDate(initial.date)} (${initial.label}): Yea ${initial.yea} – Nay ${initial.nay}.`);
  }
  facebookLines.push("");
  facebookLines.push("These are individual member votes, not state totals. The Electoral College has no role in congressional voting.");
  if (why) { facebookLines.push(""); facebookLines.push(`Why it mattered: ${why}`); }
  facebookLines.push("");
  facebookLines.push(COALITION_NOTE);
  facebookLines.push("");
  facebookLines.push("Full member-by-member breakdown:");
  facebookLines.push(decisive.url);
  facebookLines.push("");
  facebookLines.push(engagementCTA("generic", bill.title));
  facebookLines.push("");
  facebookLines.push("Source website: https://voteview.com");
  facebookLines.push("Information retrieved programmatically via API.");
  facebookLines.push("Graphs made by Jeffrey Macy.");

  return { html, facebook: facebookLines.join("\n") };
}

// A one-off card type for treaties/bills that never got a floor vote at all —
// the stat-block template above assumes a real PASSED/yea-nay tally, which
// doesn't exist here. Timeline sourced from the Congress.gov treaty actions
// endpoint (v3/treaty/96/25/actions), verified before use.
const NO_VOTE_TREATIES = {
  "salt-ii-1979": {
    title: "SALT II — signed 1979, never ratified",
    noun: "SALT II — the U.S.-Soviet arms treaty the Senate never voted on",
    congress: 96,
    country: "U.S.S.R. (Soviet Union)",
    signedDate: "1979-06-18",
    heroStat: "21 years",
    heroLabel: "between signing and formal withdrawal from Senate consideration — with no floor vote ever taken",
    timeline: [
      { date: "1979-06-18", text: "Signed by Carter and Brezhnev in Vienna." },
      { date: "1979-06-22", text: "Transmitted to the Senate for ratification." },
      { date: "1979-11-19", text: "Senate Foreign Relations Committee reports it favorably." },
      { date: "1979-12-24", text: "Soviet Union invades Afghanistan." },
      { date: "January 1980", text: "Carter asks the Senate to postpone further consideration." },
      { date: "1980-12-10", text: "96th Congress ends with no floor vote taken; treaty automatically re-referred to committee." },
      { date: "1986-07-15", text: "A resolution to force consideration is blocked; the treaty goes nowhere." },
      { date: "2000-10-13", text: "Formally returned to the President, 21 years after signing — officially withdrawn from Senate consideration." },
    ],
    why: "Both the U.S. and USSR informally observed SALT II's weapons limits for years despite it never taking legal effect — until the Reagan administration announced in 1986 that the U.S. would no longer be bound by it. A rare case where a major treaty shaped behavior without ever being ratified.",
  },
};

function buildNoVoteTreatyCard(key) {
  const t = NO_VOTE_TREATIES[key];
  if (!t) throw new Error(`Unknown no-vote treaty "${key}". Use one of: ${Object.keys(NO_VOTE_TREATIES).join(", ")}`);

  const timelineRows = t.timeline.map((item) => {
    const label = /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? longDate(item.date) : item.date;
    return `<div class="tl-row">
      <div class="tl-date">${esc(label)}</div>
      <div class="tl-dot"></div>
      <div class="tl-text">${esc(item.text)}</div>
    </div>`;
  }).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1200px; height:675px; background:${C.surface}; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  .accent { height:8px; display:flex; }
  .accent i { flex:1; }
  .card { width:100%; height:calc(100% - 8px); padding:36px 48px 26px; display:flex; flex-direction:column; }
  .kicker { font-size:15px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:${C.muted}; }
  h1 { font-size:30px; font-weight:650; color:${C.ink}; margin-top:8px; max-width:1000px; line-height:1.15; }
  .subtitle { font-size:16px; color:${C.ink2}; margin-top:6px; }
  .banner { display:flex; align-items:center; gap:20px; margin-top:14px; }
  .pill { background:#8a8a84; color:#fff; font-weight:700; font-size:14px; letter-spacing:0.05em; padding:7px 16px; border-radius:999px; }
  .hero-stat { font-size:40px; font-weight:750; color:${C.ink}; line-height:1; }
  .hero-sub { font-size:14px; color:${C.ink2}; margin-top:3px; max-width:640px; }
  .timelinebox { flex:1; margin-top:14px; background:#fff; border:3px solid ${C.ink}; box-shadow:10px 10px 0 ${C.s1}; padding:14px 20px; overflow:hidden; }
  .timeline { display:flex; flex-direction:column; }
  .tl-row { display:flex; align-items:flex-start; gap:14px; padding:4px 0; }
  .tl-date { width:110px; flex-shrink:0; font-size:13px; font-weight:600; color:${C.muted}; padding-top:1px; }
  .tl-dot { width:8px; height:8px; border-radius:50%; background:${C.s1}; margin-top:5px; flex-shrink:0; }
  .tl-text { font-size:14px; color:${C.ink2}; line-height:1.35; }
  .why { margin-top:12px; background:#f2f1ea; border-left:4px solid ${C.s1}; padding:12px 16px; border-radius:4px; }
  .why-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:${C.muted}; }
  .why-text { font-size:14px; color:${C.ink2}; margin-top:3px; line-height:1.35; }
  .foot { margin-top:auto; padding-top:10px; display:flex; justify-content:space-between; font-size:13px; color:${C.muted}; }
  </style></head><body>
  <div class="accent"><i style="background:${C.s1}"></i><i style="background:${C.neg}"></i><i style="background:${C.s2}"></i></div>
  <div class="card">
    <div class="kicker">Congressional Record Series</div>
    <h1>The treaty the Senate never voted on</h1>
    <div class="subtitle">${esc(t.country)} · Signed ${esc(longDate(t.signedDate))}</div>
    <div class="banner">
      <div class="pill">NEVER RATIFIED</div>
      <div><div class="hero-stat">${esc(t.heroStat)}</div><div class="hero-sub">${esc(t.heroLabel)}</div></div>
    </div>
    <div class="timelinebox"><div class="timeline">${timelineRows}</div></div>
    <div class="why"><div class="why-label">Why it mattered</div><div class="why-text">${esc(t.why)}</div></div>
    <div class="foot"><span>Source: Congress.gov Treaty actions (v3/treaty/96/25) · Chart: Jeff Macy</span><span>${ordinal(t.congress)} Congress</span></div>
  </div></body></html>`;

  const facebookLines = [`Not every major treaty gets ratified. ${t.title}:`, ""];
  for (const item of t.timeline) {
    const label = /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? longDate(item.date) : item.date;
    facebookLines.push(`${label} — ${item.text}`);
  }
  facebookLines.push("");
  facebookLines.push(`Why it mattered: ${t.why}`);
  facebookLines.push("");
  facebookLines.push("Source: Congress.gov treaty action records (treaty 96-25).");
  facebookLines.push("");
  facebookLines.push(engagementCTA("generic", key));
  facebookLines.push("");
  facebookLines.push("Source website: https://www.congress.gov/treaty-document/96th-congress/25");
  facebookLines.push("Information retrieved programmatically via API.");
  facebookLines.push("Graphs made by Jeffrey Macy.");

  return { html, facebook: facebookLines.join("\n") };
}

async function runLandmark() {
  const topicArg = argValue("--topic", null);
  const billArg = argValue("--bill", null);
  const topicFilter = topicArg ? TOPIC_ALIASES[topicArg] : null;
  if (topicArg && !topicFilter) throw new Error(`Unknown --topic "${topicArg}". Use one of: ${Object.keys(TOPIC_ALIASES).join(", ")}`);
  const social = process.argv.includes("--social");
  const noImage = process.argv.includes("--no-image");
  if (social && !topicArg && !billArg) throw new Error("--social requires --topic or --bill.");

  if (billArg && NO_VOTE_TREATIES[billArg]) {
    if (!social) throw new Error(`--bill ${billArg} only supports --social (it has no roll-call vote to list in text mode).`);
    const { html, facebook } = buildNoVoteTreatyCard(billArg);
    mkdirSync(SOCIAL, { recursive: true });
      const outBase = path.join(SOCIAL, `congress-votes-${billArg}-${localDateStamp()}`);
    writeFileSync(`${outBase}.txt`, `Facebook post\n-------------\n${facebook}`);
    writeFileSync(`${outBase}.csv`, toCSV(["note"], [["No roll-call vote — see .txt for the timeline."]]));
    writeFileSync(`${outBase}.html`, html);
    if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);
    console.log(facebook);
    const files = [rel(`${outBase}.txt`), rel(`${outBase}.csv`), rel(`${outBase}.html`)];
    if (!noImage) files.push(rel(`${outBase}.png`));
    console.log(`\nFiles: ${files.join(" / ")}`);
    return;
  }

  let bills0;
  if (billArg) {
    const billMeta = LANDMARK_VOTES.find((b) => BILL_SLUGS[b.title] === billArg);
    if (!billMeta) throw new Error(`Unknown --bill "${billArg}". Use one of: ${Object.values(BILL_SLUGS).join(", ")}`);
    bills0 = [billMeta];
  } else {
    bills0 = LANDMARK_VOTES.filter((b) => !topicFilter || b.theme.includes(topicFilter) || b.theme === topicFilter);
  }
  if (!bills0.length) throw new Error(`No landmark votes match --topic ${topicArg}`);

  const bills = await billResultsFor(bills0);
  const { lines, csvRows } = writeLandmarkText(bills, topicFilter || bills[0].theme);
  console.log(lines.join("\n"));

  mkdirSync(SOCIAL, { recursive: true });
  const stamp = localDateStamp();
  const topicSlug = billArg ? `congress-votes-${billArg}` : topicArg ? `congress-votes-${topicArg}` : "congress-votes-landmark";
  const outBase = path.join(SOCIAL, `${topicSlug}-${stamp}`);

  let txt = lines.join("\n");
  if (social) {
    const { html, facebook } = billArg ? buildBillSocial(bills[0]) : buildLandmarkSocial(bills, topicFilter);
    txt += `\n\nFacebook post\n-------------\n${facebook}`;
    writeFileSync(`${outBase}.html`, html);
    if (!noImage) screenshot(`${outBase}.html`, `${outBase}.png`);
  }
  writeFileSync(`${outBase}.txt`, txt);
  writeFileSync(`${outBase}.csv`, toCSV(
    ["theme", "bill", "chamber", "date", "vote_label", "yea", "nay", "party_breakdown", "source_url"],
    csvRows
  ));
  const files = [rel(`${outBase}.txt`), rel(`${outBase}.csv`)];
  if (social) { files.push(rel(`${outBase}.html`)); if (!noImage) files.push(rel(`${outBase}.png`)); }
  console.log(`\nFiles: ${files.join(" / ")}`);
}

// ── year mode: Congress.gov (enacted laws) + Senate.gov XML (Senate tallies) ──
function congressForYear(year) {
  return Math.floor((year - 1789) / 2) + 1;
}

async function congressAPI(key, pathq) {
  const sep = pathq.includes("?") ? "&" : "?";
  const res = await fetch(`https://api.congress.gov/v3${pathq}${sep}api_key=${key}&format=json`, {
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Congress.gov API HTTP ${res.status}: ${text.slice(0, 300)}` +
      (key === "DEMO_KEY" ? "\n(Using the shared DEMO_KEY — get a free key at https://api.congress.gov/sign-up/ and set CONGRESS_API_KEY in .env.)" : ""));
  }
  return JSON.parse(text);
}

async function senateVoteTally(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
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

async function houseClerkVoteTally(year, rollNumber) {
  const roll = String(rollNumber).padStart(3, "0");
  const res = await fetch(`https://clerk.house.gov/evs/${year}/roll${roll}.xml`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const xml = await res.text();
  const totals = [...xml.matchAll(/<vote>(Yea|Aye|Nay|No)<\/vote>\s*<count>(\d+)<\/count>/gi)];
  let yea = 0, nay = 0;
  for (const match of totals) {
    if (/^(yea|aye)$/i.test(match[1])) yea += Number(match[2]);
    else nay += Number(match[2]);
  }
  return yea + nay ? { yea, nay } : null;
}

async function recordedVoteTally(key, vote) {
  const actionTally = vote.actionText?.match(/(\d+)\s*-\s*(\d+)/);
  if (actionTally) return { yea: Number(actionTally[1]), nay: Number(actionTally[2]) };
  if (vote.chamber === "Senate" && vote.url) return senateVoteTally(vote.url);
  if (vote.chamber !== "House") return null;

  const year = Number(vote.date?.slice(0, 4));
  if (year >= 2023) {
    try {
      const tally = await houseVoteTally(key, vote.congress, vote.sessionNumber, vote.rollNumber);
      if (tally.yea + tally.nay) return tally;
    } catch { /* Official Clerk XML covers gaps in the beta API endpoint. */ }
  }
  return Number.isFinite(year) ? houseClerkVoteTally(year, vote.rollNumber) : null;
}

async function runYear() {
  const year = Number(argValue("--year"));
  if (!year || year < 1973) throw new Error("--year is required and must be 1973 or later (Congress.gov API coverage starts in 1973).");
  const top = Number(argValue("--top", "5"));
  const limit = Number(argValue("--limit", "150"));
  const key = getCongressKey();
  const congress = congressForYear(year);

  console.log(`Fetching enacted public laws for ${year} (${ordinal(congress)} Congress)...`);
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
    `Enacted public laws, ${year} (${ordinal(congress)} Congress) — ranked by closest recorded floor vote`,
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

function shortBillTitle(title, max = 44) {
  const clean = String(title).replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}...`;
}

async function officialDisplayTitle(key, congress, row) {
  const [type, number] = row.billId.split(/\s+/);
  try {
    const json = await congressAPI(key, `/bill/${congress}/${type.toLowerCase()}/${number}/titles?limit=250`);
    const titles = json.titles || [];
    const popular = titles.find((item) => item.titleType === "Popular Titles");
    const enactedShort = titles.find((item) => /^Short Title(?:\(s\)|s)? as Enacted$/i.test(item.titleType));
    const enrolledShort = titles.find((item) => /^Short Title(?:\(s\)|s)? from ENR .* bill text$/i.test(item.titleType));
    return enactedShort?.title || popular?.title || enrolledShort?.title || row.title;
  } catch {
    return row.title;
  }
}

async function closestEnactedLawForYear(year, key, limit) {
  mkdirSync(CACHE, { recursive: true });
  const cacheFile = path.join(CACHE, `timeline-final-passage-v2-${year}-limit-${limit}.json`);
  let state = { complete: false, results: {} };
  if (existsSync(cacheFile)) {
    try { state = JSON.parse(readFileSync(cacheFile, "utf8")); } catch { /* Rebuild malformed cache. */ }
  }
  if (state.complete && !Object.values(state.results || {}).some((row) => row === null)) {
    if (state.closest && state.titleVersion !== 3) {
      state.closest.displayTitle = await officialDisplayTitle(key, congressForYear(year), state.closest);
      state.titleVersion = 3;
      writeFileSync(cacheFile, JSON.stringify(state, null, 2));
    }
    return state.closest;
  }
  state.complete = false;

  const congress = congressForYear(year);
  let laws = [], offset = 0;
  for (;;) {
    const page = await congressAPI(key, `/law/${congress}?limit=250&offset=${offset}`);
    const batch = page.bills || [];
    laws.push(...batch);
    offset += 250;
    if (offset >= (page.pagination?.count ?? laws.length) || batch.length < 250) break;
  }
  laws = laws.filter((bill) => bill.latestAction?.actionDate?.startsWith(String(year)));
  if (laws.length > limit) {
    throw new Error(`${year} has ${laws.length} enacted laws, above --limit ${limit}. Raise --limit so the annual ranking is complete.`);
  }

  for (let index = 0; index < laws.length; index++) {
    const bill = laws[index];
    const id = `${bill.type}-${bill.number}`;
    if (Object.hasOwn(state.results, id) && state.results[id] !== null) continue;
    try {
      const actions = await congressAPI(key, `/bill/${congress}/${bill.type.toLowerCase()}/${bill.number}/actions?limit=250`);
      const passageActions = (actions.actions || []).filter((action) => {
        const text = action.text || "";
        const finalPassage = /(passed (house|senate)|on passage passed|conference report.*agreed|on agreeing to the conference report|house agreed to|senate agreed to)/i.test(text);
        const procedural = /(motion to (proceed|recommit)|committee.*discharged|cloture)/i.test(text);
        return finalPassage && !procedural;
      });
      const seenVotes = new Set();
      const votes = passageActions.flatMap((action) =>
        (action.recordedVotes || []).map((vote) => ({ ...vote, actionText: action.text || "" }))
      ).filter((vote) => {
        const id = `${vote.chamber}-${vote.date}-${vote.rollNumber}`;
        if (seenVotes.has(id)) return false;
        seenVotes.add(id);
        return true;
      });
      let best = null;
      for (const vote of votes) {
        const tally = await recordedVoteTally(key, vote);
        if (!tally || tally.yea + tally.nay === 0) continue;
        const voteCountMargin = Math.abs(tally.yea - tally.nay);
        const margin = voteCountMargin / (tally.yea + tally.nay);
        const candidate = {
          chamber: vote.chamber,
          date: vote.date?.slice(0, 10),
          rollNumber: vote.rollNumber,
          ...tally,
          voteCountMargin,
          margin,
        };
        if (!best || candidate.voteCountMargin < best.voteCountMargin ||
            (candidate.voteCountMargin === best.voteCountMargin && candidate.margin < best.margin)) best = candidate;
      }
      state.results[id] = {
        title: bill.title,
        billId: `${bill.type} ${bill.number}`,
        law: bill.laws?.[0]?.number || "",
        enactedDate: bill.latestAction?.actionDate,
        vote: best,
      };
    } catch (error) {
      console.error(`  (skipped ${bill.type} ${bill.number}: ${error.message.split("\n")[0]})`);
      state.results[id] = null;
    }
    if ((index + 1) % 10 === 0) {
      writeFileSync(cacheFile, JSON.stringify(state, null, 2));
      console.log(`  ${year}: examined ${index + 1}/${laws.length} laws`);
    }
  }

  const closest = Object.values(state.results)
    .filter((row) => row?.vote)
    .sort((a, b) => a.vote.voteCountMargin - b.vote.voteCountMargin || a.vote.margin - b.vote.margin)[0] || null;
  if (closest) closest.displayTitle = await officialDisplayTitle(key, congress, closest);
  const complete = !Object.values(state.results).some((row) => row === null);
  writeFileSync(cacheFile, JSON.stringify({ complete, titleVersion: 3, closest, results: state.results }, null, 2));
  return closest;
}

async function runTimeline() {
  const end = Number(argValue("--end", String(new Date().getFullYear() - 1)));
  const start = Number(argValue("--start", String(end - 9)));
  const limit = Number(argValue("--limit", "500"));
  const noImage = process.argv.includes("--no-image");
  if (!start || !end || start < 1973 || end < start) throw new Error("Use --start and --end with years from 1973 onward.");

  const key = getCongressKey();
  const annual = [];
  for (let year = start; year <= end; year++) {
    console.log(`Fetching enacted laws and votes for ${year}...`);
    const closest = await closestEnactedLawForYear(year, key, limit);
    if (closest) annual.push({ year, ...closest });
  }
  if (!annual.length) throw new Error("No enacted laws with recorded votes were found in this window.");

  const stamp = localDateStamp();
  const outBase = path.join(SOCIAL, `congress-closest-laws-${start}-${end}-${stamp}`);
  mkdirSync(SOCIAL, { recursive: true });
  const closest = [...annual].sort((a, b) => a.vote.voteCountMargin - b.vote.voteCountMargin || a.vote.margin - b.vote.margin)[0];
  const tiedYears = annual.filter((row) => row.vote.voteCountMargin === closest.vote.voteCountMargin).length;
  const chartSVG = horizontalBarChart(
    annual.map((row) => ({
      label: `${row.year}  ${shortBillTitle(row.displayTitle || row.title, 28)}`,
      v: row.vote.voteCountMargin,
      color: row.vote.voteCountMargin === closest.vote.voteCountMargin ? C.s2 : C.s1,
    })),
    {
      fmtTick: (value) => String(Math.round(value)),
      fmtVal: (value) => `${value} vote${value === 1 ? "" : "s"}`,
    }
  );
  const html = cardHTML({
    kicker: "Congress vote check",
    title: closest.vote.voteCountMargin <= 1 && tiedYears > 1
      ? `${tiedYears} laws passed Congress by a single vote since ${start}`
      : `The closest law Congress passed each year, ${start}-${end}`,
    hero: `${closest.vote.voteCountMargin} vote${closest.vote.voteCountMargin === 1 ? "" : "s"}`,
    heroLabel: `${tiedYears} years tied for the narrowest margin`,
    chartSVG,
    source: "Congress.gov + U.S. House Clerk + Senate.gov",
    vintage: end,
  });

  const facebook = [
    closest.vote.voteCountMargin <= 1 && tiedYears > 1
      ? `${tiedYears} major laws since ${start} passed Congress by literally one vote. Here's the closest recorded vote behind the enacted law in every year from ${start} through ${end}:`
      : `How close was the closest law Congress passed each year from ${start} through ${end}?`,
    "",
    "These are enacted public laws, ranked by the smallest recorded House or Senate passage-vote margin attached to each law.",
    "",
    ...annual.flatMap((row) => [
      `${row.year} | ${row.displayTitle || row.title}`,
      `${row.vote.chamber}: ${row.vote.yea}-${row.vote.nay} (${row.vote.voteCountMargin}-vote margin)`,
      "",
    ]),
    "A close vote does not prove that a law was the most publicly controversial. It measures only how narrowly members of Congress divided on a recorded passage vote.",
    "",
    "Which year's law should I break down member by member next? Comment below.",
    "",
    "Sources: Congress.gov, U.S. House Clerk, and U.S. Senate roll-call records.",
    "Source website: https://www.congress.gov/",
    "Information retrieved programmatically via API.",
    "Graph made by Jeffrey Macy.",
  ].join("\n");
  const lines = [
    `Closest enacted congressional laws by year (${stamp})`,
    "",
    "Year | Law | Closest recorded vote",
    "---:|---|---:",
    ...annual.map((row) => `${row.year} | ${row.displayTitle || row.title} | ${row.vote.chamber} ${row.vote.yea}-${row.vote.nay}`),
    "",
    "Facebook post",
    "-------------",
    facebook,
  ];

  writeFileSync(`${outBase}.txt`, lines.join("\n"));
  writeFileSync(`${outBase}.csv`, toCSV(
    ["year", "bill_id", "law_number", "title", "chamber", "vote_date", "yea", "nay", "vote_margin", "margin_pct"],
    annual.map((row) => [row.year, row.billId, row.law, row.displayTitle || row.title, row.vote.chamber, row.vote.date, row.vote.yea, row.vote.nay, row.vote.voteCountMargin, (row.vote.margin * 100).toFixed(2)])
  ));
  writeFileSync(`${outBase}.html`, html);
  const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);

  console.log(lines.join("\n"));
  const files = ["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`));
  console.log(`\nFiles: ${files.join(" / ")}`);
}

const mode = process.argv[2];
if (mode === "landmark") await runLandmark();
else if (mode === "year") await runYear();
else if (mode === "timeline") await runTimeline();
else {
  console.error("Usage:\n  node scripts/congress-votes.mjs landmark [--topic slavery|civil-rights|voting-rights|womens-rights] [--social] [--no-image]\n  node scripts/congress-votes.mjs year --year 2023 [--top 5] [--limit 150]\n  node scripts/congress-votes.mjs timeline [--start 2016] [--end 2025] [--limit 500] [--no-image]");
  process.exit(1);
}
