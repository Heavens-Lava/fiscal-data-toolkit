#!/usr/bin/env node
// occupation-wages.mjs — Top paying jobs, fastest growing, and tech job boards.
// Wages: BLS Occupational Employment and Wage Statistics (OES), May 2023 release.
// Growth: BLS Employment Projections 2022-2032.
// Job boards: direct ATS/careers URLs for top tech companies.
//
// node scripts/occupation-wages.mjs                  — Top pay + fastest growing
// node scripts/occupation-wages.mjs --top-pay        — Top 30 by median annual wage
// node scripts/occupation-wages.mjs --growth         — Fastest growing 2022-2032
// node scripts/occupation-wages.mjs --tech           — Tech sector deep-dive
// node scripts/occupation-wages.mjs --jobs           — Job board URLs (tech + gov)
// node scripts/occupation-wages.mjs --search "nurse" — Match occupations by keyword

// ── BLS OES May 2023 + Employment Projections 2022-2032 ──────────────────────
// Source: bls.gov/oes  and  bls.gov/emp
// All wages = median annual salary ($/yr), nationally across all industries.
// Growth = 10-year projected change in employment (2022-2032).
// Openings = projected annual job openings (new + replacement, thousands).
const OCCUPATIONS = [
  // ── Technology ──────────────────────────────────────────────────────────────
  { code:"15-1252", title:"Software Developers",                     sector:"Tech",         median:132270, p10: 77530, p90:208620, growth:25, openings:162900, edu:"Bachelor's" },
  { code:"15-2051", title:"Data Scientists",                         sector:"Tech",         median:108020, p10: 59930, p90:185370, growth:36, openings: 17700, edu:"Bachelor's" },
  { code:"15-1212", title:"Information Security Analysts",           sector:"Tech",         median:120360, p10: 69210, p90:185310, growth:32, openings: 16800, edu:"Bachelor's" },
  { code:"15-1221", title:"Computer & Info Research Scientists",     sector:"Tech",         median:145080, p10: 88730, p90:208000, growth:26, openings:  3200, edu:"Master's" },
  { code:"15-1241", title:"Computer Network Architects",             sector:"Tech",         median:126900, p10: 74870, p90:186200, growth: 4, openings:  9100, edu:"Bachelor's" },
  { code:"15-1243", title:"Database Architects",                     sector:"Tech",         median:130500, p10: 76560, p90:194880, growth: 9, openings:  9000, edu:"Bachelor's" },
  { code:"15-1242", title:"Database Administrators",                 sector:"Tech",         median:104400, p10: 59160, p90:161080, growth: 8, openings:  9000, edu:"Bachelor's" },
  { code:"15-1211", title:"Computer Systems Analysts",               sector:"Tech",         median:103800, p10: 62960, p90:163430, growth:10, openings: 38200, edu:"Bachelor's" },
  { code:"15-2031", title:"Operations Research Analysts",            sector:"Tech",         median: 83640, p10: 49110, p90:155230, growth:23, openings: 10900, edu:"Bachelor's" },
  { code:"15-2041", title:"Statisticians",                           sector:"Tech",         median:104110, p10: 63730, p90:174520, growth:31, openings:  6400, edu:"Master's" },
  { code:"17-2061", title:"Computer Hardware Engineers",             sector:"Tech",         median:132360, p10: 74840, p90:208620, growth: 5, openings:  5900, edu:"Bachelor's" },
  { code:"15-1251", title:"Computer Programmers",                    sector:"Tech",         median: 97800, p10: 56560, p90:166280, growth:-11, openings:  9800, edu:"Bachelor's" },
  { code:"15-1253", title:"Software QA Analysts & Testers",         sector:"Tech",         median: 97240, p10: 55130, p90:165060, growth:21, openings: 26400, edu:"Bachelor's" },
  { code:"15-1254", title:"Web Developers",                          sector:"Tech",         median: 78580, p10: 41970, p90:147320, growth:16, openings: 23700, edu:"Associate's" },
  // ── Healthcare ───────────────────────────────────────────────────────────────
  { code:"29-1217", title:"Neurologists",                            sector:"Healthcare",   median:244180, p10:148000, p90:null,   growth:  3, openings:  5500, edu:"Doctorate" },
  { code:"29-1218", title:"Obstetricians & Gynecologists",           sector:"Healthcare",   median:239120, p10:148000, p90:null,   growth:  3, openings:  5500, edu:"Doctorate" },
  { code:"29-1211", title:"Anesthesiologists",                       sector:"Healthcare",   median:239200, p10:146000, p90:null,   growth:  3, openings:  5500, edu:"Doctorate" },
  { code:"29-1022", title:"Oral & Maxillofacial Surgeons",           sector:"Healthcare",   median:234990, p10:148000, p90:null,   growth:  6, openings:   800, edu:"Doctorate" },
  { code:"29-1023", title:"Orthodontists",                           sector:"Healthcare",   median:237990, p10:148000, p90:null,   growth:  4, openings:   600, edu:"Doctorate" },
  { code:"29-1215", title:"Family Medicine Physicians",              sector:"Healthcare",   median:220890, p10:130000, p90:null,   growth:  3, openings: 23400, edu:"Doctorate" },
  { code:"29-1216", title:"Internal Medicine Physicians",            sector:"Healthcare",   median:222450, p10:130000, p90:null,   growth:  3, openings: 23400, edu:"Doctorate" },
  { code:"29-1221", title:"Dentists, General",                       sector:"Healthcare",   median:162690, p10: 88000, p90:208000, growth:  4, openings:  5900, edu:"Doctorate" },
  { code:"29-1131", title:"Veterinarians",                           sector:"Healthcare",   median:125240, p10: 72810, p90:181460, growth:19, openings:  4800, edu:"Doctorate" },
  { code:"29-1171", title:"Nurse Practitioners",                     sector:"Healthcare",   median:124680, p10: 91040, p90:164620, growth:45, openings: 29200, edu:"Master's" },
  { code:"29-1071", title:"Physician Assistants",                    sector:"Healthcare",   median:126010, p10: 89220, p90:157450, growth:28, openings: 13300, edu:"Master's" },
  { code:"29-1141", title:"Registered Nurses",                       sector:"Healthcare",   median: 81220, p10: 59450, p90:120560, growth: 6, openings:193100, edu:"Associate's" },
  { code:"29-1131", title:"Physical Therapists",                     sector:"Healthcare",   median: 97720, p10: 67180, p90:131640, growth:15, openings: 29800, edu:"Doctorate" },
  { code:"29-2052", title:"Pharmacy Technicians",                    sector:"Healthcare",   median: 39090, p10: 30220, p90: 56420, growth: 5, openings: 51000, edu:"HS diploma" },
  // ── Finance ──────────────────────────────────────────────────────────────────
  { code:"11-3031", title:"Financial Managers",                      sector:"Finance",      median:156100, p10: 82000, p90:208000, growth:16, openings: 72200, edu:"Bachelor's" },
  { code:"13-2051", title:"Financial & Investment Analysts",         sector:"Finance",      median: 96220, p10: 56240, p90:192910, growth: 8, openings: 31900, edu:"Bachelor's" },
  { code:"13-2052", title:"Personal Financial Advisors",             sector:"Finance",      median: 95390, p10: 47570, p90:208000, growth:13, openings: 24800, edu:"Bachelor's" },
  { code:"13-2011", title:"Accountants & Auditors",                  sector:"Finance",      median: 77250, p10: 47780, p90:128970, growth: 4, openings:126500, edu:"Bachelor's" },
  { code:"13-2061", title:"Financial Examiners",                     sector:"Finance",      median: 82210, p10: 45570, p90:165040, growth:20, openings:  5500, edu:"Bachelor's" },
  // ── Engineering ──────────────────────────────────────────────────────────────
  { code:"17-2071", title:"Electrical Engineers",                    sector:"Engineering",  median:107900, p10: 66490, p90:165120, growth: 9, openings: 20100, edu:"Bachelor's" },
  { code:"17-2141", title:"Mechanical Engineers",                    sector:"Engineering",  median:100640, p10: 63040, p90:158020, growth:10, openings: 20200, edu:"Bachelor's" },
  { code:"17-2051", title:"Civil Engineers",                         sector:"Engineering",  median: 95890, p10: 60030, p90:152530, growth: 5, openings: 24200, edu:"Bachelor's" },
  { code:"17-2112", title:"Industrial Engineers",                    sector:"Engineering",  median: 99380, p10: 63310, p90:151200, growth:12, openings: 25000, edu:"Bachelor's" },
  { code:"17-2131", title:"Materials Engineers",                     sector:"Engineering",  median: 99490, p10: 62550, p90:157160, growth: 8, openings:  3500, edu:"Bachelor's" },
  { code:"17-2199", title:"Aerospace Engineers",                     sector:"Engineering",  median:122270, p10: 77360, p90:184720, growth: 6, openings: 15600, edu:"Bachelor's" },
  { code:"17-1011", title:"Architects",                              sector:"Engineering",  median: 93310, p10: 55540, p90:151290, growth: 3, openings: 11200, edu:"Bachelor's" },
  // ── Legal ─────────────────────────────────────────────────────────────────────
  { code:"23-1011", title:"Lawyers",                                 sector:"Legal",        median:145760, p10: 61400, p90:208000, growth:10, openings: 46000, edu:"Doctorate" },
  { code:"23-1012", title:"Judicial Law Clerks",                     sector:"Legal",        median: 63630, p10: 37300, p90:121100, growth: 1, openings:  7400, edu:"Bachelor's" },
  { code:"23-2011", title:"Paralegals & Legal Assistants",           sector:"Legal",        median: 59200, p10: 37270, p90: 93000, growth:14, openings: 43000, edu:"Associate's" },
  // ── Skilled Trades ────────────────────────────────────────────────────────────
  { code:"47-2111", title:"Electricians",                            sector:"Trades",       median: 61590, p10: 38700, p90:103310, growth: 6, openings: 79900, edu:"Apprenticeship" },
  { code:"47-2152", title:"Plumbers & Pipefitters",                  sector:"Trades",       median: 61550, p10: 38880, p90: 99920, growth: 2, openings: 50700, edu:"Apprenticeship" },
  { code:"47-2031", title:"Carpenters",                              sector:"Trades",       median: 56350, p10: 35100, p90: 91390, growth: 1, openings: 81000, edu:"HS diploma" },
  { code:"49-9071", title:"Maintenance & Repair Workers",            sector:"Trades",       median: 46040, p10: 29790, p90: 70490, growth: 4, openings:157900, edu:"HS diploma" },
  { code:"53-3032", title:"Heavy & Tractor-Trailer Drivers",         sector:"Trades",       median: 49920, p10: 33700, p90: 74790, growth: 4, openings:259000, edu:"HS diploma" },
  // ── Education / Public Service ────────────────────────────────────────────────
  { code:"25-1011", title:"Postsecondary Teachers",                  sector:"Education",    median: 80840, p10: 42810, p90:172630, growth: 8, openings:151000, edu:"Doctorate" },
  { code:"25-2021", title:"Elementary School Teachers",              sector:"Education",    median: 61480, p10: 41580, p90: 92600, growth: -4, openings: 92700, edu:"Bachelor's" },
  { code:"21-1011", title:"Substance Abuse Counselors",              sector:"Social",       median: 49710, p10: 32040, p90: 78290, growth:18, openings: 38100, edu:"Bachelor's" },
];

const argv    = process.argv.slice(2);
const TOP_PAY = argv.includes("--top-pay");
const GROWTH  = argv.includes("--growth");
const TECH    = argv.includes("--tech");
const JOBS    = argv.includes("--jobs");
const SRCH    = argv.indexOf("--search");
const KEYWORD = SRCH >= 0 ? argv[SRCH + 1]?.toLowerCase() : null;

const money = n => n ? `$${Math.round(n/1000)}k`.padStart(7) : "     —";
const rpad  = (s, n) => String(s || "").slice(0, n).padEnd(n);
const lpad  = (s, n) => String(s || "").padStart(n);

// ── Top paying ────────────────────────────────────────────────────────────────
function showTopPay(limit = 30) {
  const rows = [...OCCUPATIONS]
    .filter(r => r.median)
    .sort((a, b) => b.median - a.median)
    .slice(0, limit);

  console.log(`\n  ── TOP ${limit} OCCUPATIONS BY MEDIAN ANNUAL WAGE (BLS OES May 2023) ──────\n`);
  console.log(`  ${"#".padStart(3)}  ${"Occupation".padEnd(44)}  ${"Sector".padEnd(12)}  Median    10th    90th  Education`);
  console.log(`  ${"─".repeat(3)}  ${"─".repeat(44)}  ${"─".repeat(12)}  ${"─".repeat(6)}  ${"─".repeat(6)}  ${"─".repeat(6)}  ${"─".repeat(16)}`);
  for (const [i, r] of rows.entries()) {
    const star = r.growth >= 20 ? " ★" : "  ";
    console.log(
      `  ${String(i+1).padStart(3)}  ${rpad(r.title + star, 44)}  ${rpad(r.sector, 12)}` +
      `  ${money(r.median)}  ${money(r.p10)}  ${r.p90 ? money(r.p90) : "  100k+"}  ${r.edu}`
    );
  }
  console.log(`\n  ★ = projected growth ≥20% over 2022-2032 (BLS Employment Projections)`);
  console.log(`  90th %ile "100k+" = BLS top-codes wages at $208,000 for highest earners`);
}

// ── Fastest growing ───────────────────────────────────────────────────────────
function showGrowth(limit = 30) {
  const rows = [...OCCUPATIONS]
    .filter(r => r.growth !== undefined)
    .sort((a, b) => b.growth - a.growth)
    .slice(0, limit);

  console.log(`\n  ── FASTEST GROWING OCCUPATIONS (BLS 2022-2032 projections) ─────────────\n`);
  console.log(`  ${"#".padStart(3)}  ${"Occupation".padEnd(44)}  ${"Sector".padEnd(12)}  Growth  Annual Opens   Median  Education`);
  console.log(`  ${"─".repeat(3)}  ${"─".repeat(44)}  ${"─".repeat(12)}  ${"─".repeat(7)}  ${"─".repeat(12)}  ${"─".repeat(6)}  ${"─".repeat(14)}`);
  for (const [i, r] of rows.entries()) {
    const grw   = (`${r.growth > 0 ? "+" : ""}${r.growth}%`).padStart(6);
    const opens = r.openings ? r.openings.toLocaleString().padStart(12) : "            —";
    console.log(
      `  ${String(i+1).padStart(3)}  ${rpad(r.title, 44)}  ${rpad(r.sector, 12)}` +
      `  ${grw}   ${opens}  ${money(r.median)}  ${r.edu}`
    );
  }
  console.log(`\n  Annual opens = new jobs created + replacement openings each year`);
  console.log(`  Large openings in Trades/Healthcare = replacement demand (retirements)`);
}

// ── Tech deep-dive ────────────────────────────────────────────────────────────
function showTech() {
  const rows = OCCUPATIONS.filter(r => r.sector === "Tech")
    .sort((a, b) => b.median - a.median);

  console.log(`\n  ── TECH SECTOR — All Occupations Ranked by Pay ─────────────────────────\n`);
  console.log(`  ${"#".padStart(3)}  ${"Title".padEnd(44)}  Median    Growth  Annual Opens  Education`);
  console.log(`  ${"─".repeat(3)}  ${"─".repeat(44)}  ${"─".repeat(6)}  ${"─".repeat(7)}  ${"─".repeat(12)}  ${"─".repeat(12)}`);
  for (const [i, r] of rows.entries()) {
    const star = r.growth >= 20 ? " ★" : "  ";
    const grw  = (r.growth !== undefined ? `${r.growth > 0 ? "+" : ""}${r.growth}%` : "  —").padStart(6);
    const opens = r.openings ? r.openings.toLocaleString().padStart(12) : "           —";
    console.log(
      `  ${String(i+1).padStart(3)}  ${rpad(r.title + star, 44)}  ${money(r.median)}` +
      `  ${grw}   ${opens}  ${r.edu}`
    );
  }

  console.log(`
  ★ = Bright Outlook / ≥20% growth projected

  KEY TECH TRENDS  (2024-2032)
  ────────────────────────────────────────────────────────────────────────
  AI/ML Engineers: Not yet a separate BLS category — counted under Software
    Developers and Operations Research Analysts. Demand is growing sharply.
    Median AI/ML roles at big tech: $180k–$220k+ (LinkedIn salary surveys).

  Cybersecurity (+32%): Every sector — healthcare, finance, defense, govt —
    is hiring security analysts. Major gap between supply and demand.

  Data Scientists (+36%): Highest growth rate in tech. Companies need people
    who can build models AND communicate findings to non-technical leadership.

  Computer Programmers (-11%): Traditional waterfall coders being displaced
    by AI-assisted development tools. Shift toward software engineer (full-stack,
    systems design) vs. pure programmer roles.

  Federal tech jobs: -8.8% YoY as of June 2026 (BLS CES, see bls-jobs.mjs).
    DOGE cuts hit contractors (Booz Allen, SAIC, Leidos) and fed employees.
    Private sector tech NOT cutting at same rate — this is a gov-sector story.

  What's actually hot right now (beyond BLS categories):
    • AI/ML/LLM engineering     • Embedded systems (robotics, EVs, drones)
    • Cloud security (CNAPP)    • Compiler / GPU kernel engineering
    • Site reliability (SRE)    • Technical program management at AI labs
`);
}

// ── Sector summary ────────────────────────────────────────────────────────────
function showSectors() {
  const map = {};
  for (const r of OCCUPATIONS) {
    if (!map[r.sector]) map[r.sector] = [];
    map[r.sector].push(r);
  }
  console.log(`\n  ── MEDIAN WAGE BY SECTOR ────────────────────────────────────────────────\n`);
  console.log(`  ${"Sector".padEnd(14)}  ${"Occ".padStart(4)}  Avg Median  Fastest Grower`);
  console.log(`  ${"─".repeat(14)}  ${"─".repeat(4)}  ${"─".repeat(10)}  ${"─".repeat(40)}`);
  const sorted = Object.entries(map).sort((a, b) => {
    const avgA = a[1].reduce((s,r)=>s+(r.median||0),0)/a[1].length;
    const avgB = b[1].reduce((s,r)=>s+(r.median||0),0)/b[1].length;
    return avgB - avgA;
  });
  for (const [sec, list] of sorted) {
    const avg = list.reduce((s,r)=>s+(r.median||0),0)/list.length;
    const fastest = [...list].sort((a,b)=>b.growth-a.growth)[0];
    console.log(
      `  ${rpad(sec, 14)}  ${lpad(list.length,4)}  ${money(avg)}  ${fastest.title} (+${fastest.growth}%)`
    );
  }
}

// ── Keyword search ────────────────────────────────────────────────────────────
function searchOccupations(kw) {
  const matches = OCCUPATIONS.filter(r =>
    r.title.toLowerCase().includes(kw) ||
    r.sector.toLowerCase().includes(kw)
  ).sort((a, b) => b.median - a.median);

  console.log(`\n  Search: "${kw}" — ${matches.length} match(es)\n`);
  if (!matches.length) {
    console.log(`  No matches. Try: nurse, developer, engineer, finance, legal, trades`);
    return;
  }
  console.log(`  ${"#".padStart(3)}  ${"Title".padEnd(44)}  ${"Sector".padEnd(12)}  Median  Growth  Education`);
  console.log(`  ${"─".repeat(3)}  ${"─".repeat(44)}  ${"─".repeat(12)}  ${"─".repeat(6)}  ${"─".repeat(6)}  ${"─".repeat(14)}`);
  for (const [i, r] of matches.entries()) {
    const grw = (r.growth !== undefined ? `${r.growth > 0 ? "+" : ""}${r.growth}%` : "  —").padStart(6);
    console.log(
      `  ${String(i+1).padStart(3)}  ${rpad(r.title, 44)}  ${rpad(r.sector, 12)}` +
      `  ${money(r.median)}  ${grw}   ${r.edu}`
    );
  }
}

// ── Tech company job boards ───────────────────────────────────────────────────
function showJobBoards() {
  console.log(`\n  ── TECH COMPANY JOB BOARDS ─────────────────────────────────────────────\n`);
  const boards = [
    { co:"Anthropic",     jobs:"458+", note:"AI safety, research, eng, policy — 21 departments",   url:"https://www.anthropic.com/careers/jobs" },
    { co:"xAI (Elon)",    jobs:"213",  note:"Data center, AI infra; Memphis TN & Southaven MS",     url:"https://job-boards.greenhouse.io/xai" },
    { co:"OpenAI",        jobs:"—",    note:"Research, engineering, policy, safety",                url:"https://openai.com/careers" },
    { co:"Nvidia",        jobs:"1000+",note:"CUDA, GPU arch, AI frameworks, robotics, automotive",  url:"https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite" },
    { co:"Google",        jobs:"—",    note:"Search DeepMind, YouTube, Cloud, Waymo",               url:"https://careers.google.com" },
    { co:"Meta",          jobs:"—",    note:"Reality Labs, WhatsApp, Instagram, Messenger",         url:"https://www.metacareers.com" },
    { co:"Microsoft",     jobs:"—",    note:"Azure, GitHub, Xbox, Copilot, LinkedIn",               url:"https://careers.microsoft.com" },
    { co:"Apple",         jobs:"—",    note:"Hardware, Siri, chip design (M/A series), iOS",        url:"https://jobs.apple.com" },
    { co:"Amazon / AWS",  jobs:"—",    note:"AWS, Alexa, Prime Video, logistics, robotics",         url:"https://www.amazon.jobs" },
    { co:"Tesla",         jobs:"—",    note:"Austin TX HQ; FSD/AI, manufacturing, energy",          url:"https://www.tesla.com/careers" },
    { co:"SpaceX",        jobs:"—",    note:"Hawthorne CA; Starship, Starlink; requires US citizen",url:"https://www.spacex.com/careers" },
    { co:"Palantir",      jobs:"—",    note:"NYC/Denver; defense analytics + enterprise AI (AIP)",  url:"https://www.palantir.com/careers" },
    { co:"Scale AI",      jobs:"—",    note:"AI training data + RLHF + gov contracts (DoD, intel)", url:"https://scale.com/careers" },
    { co:"Stripe",        jobs:"—",    note:"Fintech; SF/Dublin/NY; payments infrastructure",        url:"https://stripe.com/jobs" },
    { co:"Databricks",    jobs:"—",    note:"Data + AI platform; $10B raise 2024; hypergrowth",     url:"https://www.databricks.com/company/careers" },
    { co:"Figma",         jobs:"—",    note:"Design tooling; Adobe acquisition blocked by EU",       url:"https://www.figma.com/careers" },
  ];

  for (const b of boards) {
    console.log(`  ${rpad(b.co, 14)}  ${lpad(b.jobs, 5)} jobs  ${b.url}`);
    console.log(`  ${" ".repeat(22)}  ${b.note}`);
  }

  console.log(`\n  ── FEDERAL / GOVERNMENT TECH ───────────────────────────────────────────\n`);
  console.log(`  Note: Federal hiring is DOWN -8.8% YoY (DOGE cuts). Private sector is`);
  console.log(`  better right now. But cleared positions pay well + high job security.\n`);
  const gov = [
    { ag:"USAJobs (all)",   url:"https://www.usajobs.gov",                       note:"Official portal for all federal jobs" },
    { ag:"NSA",             url:"https://www.intelligencecareers.gov/nsa",       note:"TS/SCI required; signals intel, cyber" },
    { ag:"CIA",             url:"https://www.cia.gov/careers",                   note:"Tech, analyst, operations" },
    { ag:"CISA",            url:"https://www.cisa.gov/careers",                  note:"Cybersecurity focused" },
    { ag:"18F / TTS (GSA)", url:"https://join.tts.gsa.gov",                      note:"Non-trad tech culture in govt" },
    { ag:"DoD DDS",         url:"https://dds.mil/careers",                       note:"Defense Digital Service" },
  ];
  for (const g of gov) {
    console.log(`  ${rpad(g.ag, 15)}  ${rpad(g.url, 45)}  ${g.note}`);
  }

  console.log(`
  ── HOW TO SEARCH JOBS VIA APIs (no auth required) ──────────────────────

  USAJobs.gov — free REST API, no key needed:
    GET https://data.usajobs.gov/api/search?Keyword=data+scientist&ResultsPerPage=20
    Returns: title, salary range, agency, location, closing date

  Greenhouse ATS (many startups use this):
    GET https://boards-api.greenhouse.io/v1/boards/{company}/jobs
    Works for: xAI, Anthropic, Stripe, Notion, Figma, Linear, many others

  Lever ATS (another common ATS):
    GET https://api.lever.co/v0/postings/{company}?mode=json
    Works for: Scale AI, Palantir, various VC-backed startups

  LinkedIn / Indeed: Public APIs removed (~2021). Require logged-in session.
  MCP tools: No MCP for job search exists yet. Closest: browsertools MCP
             (controls a browser, can navigate LinkedIn manually).
`);
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
(() => {
  console.log(`\n  OCCUPATION WAGES & CAREER OUTLOOK`);
  console.log(`  Source: BLS OES May 2023 wages · BLS Employment Projections 2022-2032\n`);

  if (KEYWORD)      searchOccupations(KEYWORD);
  else if (TECH)    { showTech(); showSectors(); }
  else if (JOBS)    showJobBoards();
  else if (GROWTH)  { showGrowth(30); showSectors(); }
  else if (TOP_PAY) { showTopPay(30); showSectors(); }
  else {
    showTopPay(20);
    showGrowth(20);
    showSectors();
  }

  console.log(`\n  ── Usage ───────────────────────────────────────────────────────────────`);
  console.log(`  node scripts/occupation-wages.mjs                  Both tables`);
  console.log(`  node scripts/occupation-wages.mjs --top-pay        Top 30 by median wage`);
  console.log(`  node scripts/occupation-wages.mjs --growth         Top 30 by growth rate`);
  console.log(`  node scripts/occupation-wages.mjs --tech           Tech sector deep-dive`);
  console.log(`  node scripts/occupation-wages.mjs --jobs           Job board URLs`);
  console.log(`  node scripts/occupation-wages.mjs --search "nurse" Filter by keyword\n`);
})();
