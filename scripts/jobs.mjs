#!/usr/bin/env node
// jobs.mjs — Search tech company job boards via public ATS APIs.
// Sources: Greenhouse (no auth), Lever (no auth), USAJobs.gov (free key optional).
//
// node scripts/jobs.mjs                             — count open roles at all companies
// node scripts/jobs.mjs --search "machine learning" — keyword filter across all companies
// node scripts/jobs.mjs --company anthropic          — one company only
// node scripts/jobs.mjs --remote                    — remote-only roles
// node scripts/jobs.mjs --search "engineer" --company stripe --remote

const argv     = process.argv.slice(2);
const SRCH_I   = argv.indexOf("--search");
const KEYWORD  = SRCH_I >= 0 ? argv[SRCH_I + 1]?.toLowerCase() : null;
const CO_I     = argv.indexOf("--company");
const CO_FILT  = CO_I >= 0 ? argv[CO_I + 1]?.toLowerCase() : null;
const REMOTE   = argv.includes("--remote");

const UA = { "User-Agent": "fiscal-data-toolkit/1.0", "Accept": "application/json" };

async function get(url, headers = {}) {
  const r = await fetch(url, { headers: { ...UA, ...headers } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const rpad = (s, n) => String(s || "").slice(0, n).padEnd(n);
const lpad = (s, n) => String(s || "").padStart(n);

// ── Company registry ──────────────────────────────────────────────────────────
const COMPANIES = [
  // Greenhouse (boards-api.greenhouse.io/v1/boards/{slug}/jobs)
  { name: "Anthropic",   ats: "greenhouse", slug: "anthropic",   sector: "AI Lab"      },
  { name: "xAI",         ats: "greenhouse", slug: "xai",          sector: "AI Lab"      },
  { name: "OpenAI",      ats: "greenhouse", slug: "openai",       sector: "AI Lab"      },
  { name: "Databricks",  ats: "greenhouse", slug: "databricks",   sector: "Data/AI"     },
  { name: "Stripe",      ats: "greenhouse", slug: "stripe",       sector: "Fintech"     },
  { name: "Coinbase",    ats: "greenhouse", slug: "coinbase",     sector: "Crypto"      },
  { name: "Brex",        ats: "greenhouse", slug: "brex",         sector: "Fintech"     },
  { name: "Airbnb",      ats: "greenhouse", slug: "airbnb",       sector: "Travel"      },
  { name: "Lyft",        ats: "greenhouse", slug: "lyft",         sector: "Rideshare"   },
  { name: "Reddit",      ats: "greenhouse", slug: "reddit",       sector: "Social"      },
  { name: "Discord",     ats: "greenhouse", slug: "discord",      sector: "Social"      },
  { name: "Instacart",   ats: "greenhouse", slug: "instacart",    sector: "Delivery"    },
  { name: "Robinhood",   ats: "greenhouse", slug: "robinhood",    sector: "Fintech"     },
  { name: "Figma",       ats: "greenhouse", slug: "figma",        sector: "Design"      },
  { name: "Dropbox",     ats: "greenhouse", slug: "dropbox",      sector: "SaaS"        },
  // Lever (api.lever.co/v0/postings/{slug})
  { name: "Palantir",    ats: "lever",      slug: "palantir",     sector: "Defense/AI"  },
];

// ── Greenhouse fetcher ────────────────────────────────────────────────────────
async function fetchGreenhouse(slug) {
  const d = await get(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=false`);
  return (d.jobs || []).map(j => ({
    title:    j.title,
    location: j.location?.name || "",
    dept:     j.departments?.[0]?.name || "",
    url:      j.absolute_url || `https://boards.greenhouse.io/${slug}/jobs/${j.id}`,
    posted:   j.updated_at ? j.updated_at.slice(0, 10) : "",
  }));
}

// ── Lever fetcher ─────────────────────────────────────────────────────────────
async function fetchLever(slug) {
  const arr = await get(`https://api.lever.co/v0/postings/${slug}?mode=json&limit=500`);
  return (Array.isArray(arr) ? arr : []).map(j => ({
    title:    j.text,
    location: j.categories?.location || j.country || "",
    dept:     j.categories?.team || j.categories?.department || "",
    url:      j.hostedUrl || j.applyUrl || "",
    posted:   j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : "",
  }));
}

// ── Fetch one company ─────────────────────────────────────────────────────────
async function fetchCompany(co) {
  try {
    const jobs = co.ats === "greenhouse"
      ? await fetchGreenhouse(co.slug)
      : await fetchLever(co.slug);
    return { ...co, jobs };
  } catch (err) {
    return { ...co, jobs: [], error: err.message };
  }
}

// ── Filter jobs ───────────────────────────────────────────────────────────────
function filterJobs(jobs) {
  let out = jobs;
  if (KEYWORD) {
    const kw = KEYWORD;
    out = out.filter(j =>
      j.title.toLowerCase().includes(kw) ||
      j.dept.toLowerCase().includes(kw) ||
      j.location.toLowerCase().includes(kw)
    );
  }
  if (REMOTE) {
    out = out.filter(j =>
      j.location.toLowerCase().includes("remote") ||
      j.location === "" ||
      j.location.toLowerCase().includes("anywhere")
    );
  }
  return out;
}

// ── Display ───────────────────────────────────────────────────────────────────
function printJobs(co, jobs) {
  if (!jobs.length) return;
  console.log(`\n  ── ${co.name}  [${co.sector}]  ${jobs.length} matching ──`);
  console.log(`  ${"Title".padEnd(52)}  ${"Location".padEnd(35)}  ${"Dept".padEnd(28)}  Posted`);
  console.log(`  ${"─".repeat(52)}  ${"─".repeat(35)}  ${"─".repeat(28)}  ${"─".repeat(10)}`);
  for (const j of jobs.slice(0, 30)) {
    console.log(`  ${rpad(j.title, 52)}  ${rpad(j.location, 35)}  ${rpad(j.dept, 28)}  ${j.posted}`);
  }
  if (jobs.length > 30) console.log(`  … and ${jobs.length - 30} more`);
}

function printSummary(results) {
  const kw   = KEYWORD ? ` matching "${KEYWORD}"` : "";
  const rem  = REMOTE ? " (remote only)" : "";
  const total = results.reduce((s, r) => s + r.filtered, 0);

  console.log(`\n  ── JOB BOARD SUMMARY${kw}${rem} ──────────────────────────────────────────\n`);
  console.log(`  ${"Company".padEnd(14)}  ${"Sector".padEnd(12)}  ${"Open".padStart(6)}  ${"Matched".padStart(8)}  ATS`);
  console.log(`  ${"─".repeat(14)}  ${"─".repeat(12)}  ${"─".repeat(6)}  ${"─".repeat(8)}  ${"─".repeat(12)}`);

  for (const r of results.sort((a, b) => b.filtered - a.filtered)) {
    const err = r.error ? " ✗" : "";
    console.log(
      `  ${rpad(r.name + err, 14)}  ${rpad(r.sector, 12)}  ${lpad(r.total, 6)}  ${lpad(r.filtered, 8)}  ${r.ats}`
    );
  }
  console.log(`  ${"─".repeat(14)}  ${"─".repeat(12)}  ${"─".repeat(6)}  ${"─".repeat(8)}`);
  console.log(`  ${"Total".padEnd(14)}  ${"".padEnd(12)}  ${lpad(results.reduce((s,r)=>s+r.total,0),6)}  ${lpad(total,8)}`);
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  const companies = CO_FILT
    ? COMPANIES.filter(c => c.name.toLowerCase().includes(CO_FILT) || c.slug.includes(CO_FILT))
    : COMPANIES;

  if (!companies.length) {
    console.error(`\n  No company matched "${CO_FILT}". Try: anthropic, stripe, databricks, airbnb, etc.`);
    process.exit(1);
  }

  const label = KEYWORD ? `"${KEYWORD}"` : "all roles";
  const scope = CO_FILT ? companies[0].name : `${companies.length} companies`;
  process.stdout.write(`\n  Fetching ${label} from ${scope}…`);

  const raw = await Promise.all(companies.map(c => fetchCompany(c)));
  process.stdout.write(` done\n`);

  const results = raw.map(r => ({
    ...r,
    total:    r.jobs.length,
    filtered: filterJobs(r.jobs).length,
  }));

  // If searching or filtering, show the actual job listings
  if (KEYWORD || REMOTE || CO_FILT) {
    for (const r of results) {
      const matched = filterJobs(r.jobs);
      printJobs(r, matched);
    }
  }

  printSummary(results);

  console.log(`\n  ── Usage ──────────────────────────────────────────────────────────────`);
  console.log(`  node scripts/jobs.mjs                              Job counts at all companies`);
  console.log(`  node scripts/jobs.mjs --search "machine learning"  Filter by keyword`);
  console.log(`  node scripts/jobs.mjs --company anthropic           One company only`);
  console.log(`  node scripts/jobs.mjs --remote                     Remote roles only`);
  console.log(`  node scripts/jobs.mjs --search "engineer" --remote Remote engineering roles\n`);

  if (!KEYWORD && !REMOTE && !CO_FILT) {
    console.log(`  Add --search or --company to see individual job listings.`);
    console.log(`  Add --remote to filter to remote-friendly roles only.\n`);
  }
})();
