#!/usr/bin/env node
// federal-awards.mjs — Drill into individual federal awards by size, agency, or state.
// Source: USASpending.gov   No API key required.
//
// node scripts/federal-awards.mjs                          — Top 30 biggest awards this FY
// node scripts/federal-awards.mjs --medicare               — Who receives Medicare/CMS money
// node scripts/federal-awards.mjs --state AZ               — Top recipients in Arizona
// node scripts/federal-awards.mjs --agency "Dept of Defense" — Awards from specific agency
// node scripts/federal-awards.mjs 2024                     — Different fiscal year

const BASE = "https://api.usaspending.gov/api/v2";
const HDR  = { "User-Agent": "fiscal-data-toolkit/1.0", "Content-Type": "application/json" };

const argv     = process.argv.slice(2);
const now      = new Date();
const FY       = parseInt(argv.find(a => /^\d{4}$/.test(a)) ?? (now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1));
const fyStart  = `${FY - 1}-10-01`;
const fyEnd    = `${FY}-09-30`;
const timeFilt = [{ start_date: fyStart, end_date: fyEnd }];

const MEDICARE = argv.includes("--medicare");
const stateIdx = argv.indexOf("--state");
const STATE    = stateIdx >= 0 ? argv[stateIdx + 1]?.toUpperCase() : null;
const agencyIdx= argv.indexOf("--agency");
const AGENCY   = agencyIdx >= 0 ? argv[agencyIdx + 1] : null;

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", headers: HDR, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

const money = n => {
  const v = Number(n); if (!v || !isFinite(v)) return "-";
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e12) return `${s}$${(a/1e12).toFixed(2)}T`;
  if (a >= 1e9)  return `${s}$${(a/1e9).toFixed(1)}B`;
  if (a >= 1e6)  return `${s}$${(a/1e6).toFixed(1)}M`;
  return `${s}$${Math.round(a).toLocaleString()}`;
};

const rpad = (s, n) => String(s || "").slice(0, n).padEnd(n);
const lpad = (s, n) => String(s || "").padStart(n);

// CGAC toptier agency codes → short name
const AGENCY_CODE = {
  "097":"Defense (DoD)",   "075":"HHS",            "091":"Veterans Affairs",
  "089":"Energy (DoE)",    "069":"Transportation",  "086":"Housing (HUD)",
  "024":"Agriculture",     "015":"Justice (DOJ)",   "070":"Homeland Sec.",
  "080":"NASA",            "096":"State Dept.",     "013":"Commerce",
  "047":"EPA",             "490":"Social Security", "036":"Education",
  "058":"FEMA",            "073":"GSA",             "028":"OPM",
  "047":"EPA",             "012":"Treasury",        "300":"NSF",
};

const STATE_NAMES = {
  AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California",
  CO:"Colorado", CT:"Connecticut", DE:"Delaware", FL:"Florida", GA:"Georgia",
  HI:"Hawaii", ID:"Idaho", IL:"Illinois", IN:"Indiana", IA:"Iowa",
  KS:"Kansas", KY:"Kentucky", LA:"Louisiana", ME:"Maine", MD:"Maryland",
  MA:"Massachusetts", MI:"Michigan", MN:"Minnesota", MS:"Mississippi", MO:"Missouri",
  MT:"Montana", NE:"Nebraska", NV:"Nevada", NH:"New Hampshire", NJ:"New Jersey",
  NM:"New Mexico", NY:"New York", NC:"North Carolina", ND:"North Dakota", OH:"Ohio",
  OK:"Oklahoma", OR:"Oregon", PA:"Pennsylvania", RI:"Rhode Island", SC:"South Carolina",
  SD:"South Dakota", TN:"Tennessee", TX:"Texas", UT:"Utah", VT:"Vermont",
  VA:"Virginia", WA:"Washington", WV:"West Virginia", WI:"Wisconsin", WY:"Wyoming",
  DC:"District of Columbia",
};

const CONTRACT_TYPES = ["A","B","C","D"];
const GRANT_TYPES    = ["02","03","04","05"];
const PAYMENT_TYPES  = ["06","10"];
const LOAN_TYPES     = ["07","08"];

// ── Individual awards table ─────────────────────────────────────────────────
async function showAwards({ filters = {}, awardTypes = CONTRACT_TYPES, limit = 30, title }) {
  const data = await post("/search/spending_by_award/", {
    filters: { time_period: timeFilt, award_type_codes: awardTypes, ...filters },
    fields: [
      "Award ID", "Recipient Name", "Award Amount", "Description",
      "Awarding Agency Name", "Awarding Agency Code", "Award Type",
      "Start Date", "End Date",
    ],
    sort: "Award Amount",
    order: "desc",
    limit,
    page: 1,
  });

  const rows  = data.results || [];
  const total = data.page_metadata?.count ?? rows.length;

  console.log(`\n  ── ${title} ──`);
  console.log(`  ${total.toLocaleString()} total matching awards · showing top ${rows.length} by amount\n`);
  console.log(`  ${"#".padStart(3)}  ${"Recipient".padEnd(38)}  ${"Amount".padStart(12)}  ${"Agency".padEnd(20)}  Description`);
  console.log(`  ${"─".repeat(3)}  ${"─".repeat(38)}  ${"─".repeat(12)}  ${"─".repeat(20)}  ${"─".repeat(42)}`);

  for (const [i, r] of rows.entries()) {
    const code   = r["Awarding Agency Code"] || "";
    const agency = r["Awarding Agency Name"] || AGENCY_CODE[code] || (code ? `Agency ${code}` : "");
    // Strip internal IGF/TAS boilerplate from descriptions
    const desc   = (r["Description"] || "")
      .replace(/IGF::[^:]+::\s*IGF\s*/gi, "")
      .replace(/TAS::\S+::\s*TAS\s*/gi, "")
      .trim().slice(0, 42);
    console.log(
      `  ${String(i+1).padStart(3)}  ${rpad(r["Recipient Name"], 38)}  ${lpad(money(r["Award Amount"]), 12)}  ${rpad(agency, 20)}  ${desc}`
    );
  }
}

// ── Category totals (by recipient, agency, etc.) ──────────────────────────
async function showCategory(endpoint, { filters = {}, limit = 30, title, noteText } = {}) {
  const data = await post(`/search/spending_by_category/${endpoint}/`, {
    filters: { time_period: timeFilt, ...filters },
    limit,
  });

  const rows  = data.results || [];
  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);

  console.log(`\n  ── ${title} ──`);
  console.log(`  ${"#".padStart(3)}  ${"Name".padEnd(55)}  ${"Amount".padStart(12)}   Share`);
  console.log(`  ${"─".repeat(3)}  ${"─".repeat(55)}  ${"─".repeat(12)}   ${"─".repeat(6)}`);

  for (const [i, r] of rows.entries()) {
    const name  = r.name || r.recipient_name || "?";
    const share = total ? `${(r.amount / total * 100).toFixed(1)}%` : "-";
    console.log(`  ${String(i+1).padStart(3)}  ${rpad(name, 55)}  ${lpad(money(r.amount), 12)}   ${lpad(share, 6)}`);
  }

  console.log(`  ${"─".repeat(3)}  ${"─".repeat(55)}  ${"─".repeat(12)}`);
  console.log(`  ${"".padStart(3)}  ${"Top " + rows.length + " shown".padEnd(55)}  ${lpad(money(total), 12)}`);

  if (noteText) console.log(`\n  ${noteText}`);
}

// ── DEFAULT: biggest awards overall ──────────────────────────────────────
async function defaultView() {
  await showAwards({
    awardTypes: CONTRACT_TYPES,
    limit: 30,
    title: `Biggest Federal Contracts — All Agencies — FY${FY}`,
  });

  await showAwards({
    awardTypes: GRANT_TYPES,
    limit: 20,
    title: `Biggest Federal Grants — All Agencies — FY${FY}`,
  });

  await showCategory("awarding_agency", {
    title: `Total Spending by Agency — FY${FY}`,
    limit: 20,
    noteText: "Includes contracts, grants, loans, and direct payments (Social Security, Medicare, Medicaid).",
  });
}

// ── MEDICARE: who receives CMS money ─────────────────────────────────────
async function medicareView() {
  const cmsFilt = {
    agencies: [{ type: "awarding", tier: "subtier", name: "Centers for Medicare and Medicaid Services" }],
  };

  // Top recipients of all CMS spending
  await showCategory("recipient", {
    filters: cmsFilt,
    title: `Who Receives CMS Money — FY${FY}`,
    limit: 30,
    noteText: [
      "States appear because the federal government sends Medicaid matching funds to",
      "  state governments who then pay hospitals/doctors. Medicare Advantage (Part C)",
      "  payments go to insurance companies — UnitedHealth, Humana, CVS/Aetna, Centene, etc.",
    ].join("\n  "),
  });

  // Biggest individual CMS contracts — reveals Medicare Advantage insurance companies
  await showAwards({
    filters: cmsFilt,
    awardTypes: CONTRACT_TYPES,
    limit: 25,
    title: `Biggest CMS Contracts (Medicare Advantage & managed care) — FY${FY}`,
  });

  // HHS breakdown by subagency
  await showCategory("awarding_subagency", {
    filters: {
      agencies: [{ type: "awarding", tier: "toptier", name: "Department of Health and Human Services" }],
    },
    title: `HHS Spending by Subagency — FY${FY}`,
    limit: 20,
  });
}

// ── STATE: everything going to a specific state ───────────────────────────
async function stateView(state) {
  const stateName = STATE_NAMES[state] || state;
  const locFilt   = { recipient_locations: [{ country: "USA", state }] };

  // Top recipient organizations in the state
  await showCategory("recipient", {
    filters: locFilt,
    title: `Top Federal Spending Recipients in ${stateName} — FY${FY}`,
    limit: 30,
  });

  // Which agencies send the most to this state
  await showCategory("awarding_agency", {
    filters: locFilt,
    title: `Federal Spending in ${stateName} by Agency — FY${FY}`,
    limit: 20,
    noteText: `Social Security Administration and CMS dominate because Medicare/Medicaid\n  flow directly to individuals and providers in the state.`,
  });

  // Which programs (CFDA) flow the most to this state
  await showCategory("cfda", {
    filters: locFilt,
    title: `Top Federal Programs Paying into ${stateName} — FY${FY}`,
    limit: 20,
    noteText: `CFDA = Catalog of Federal Domestic Assistance. Each entry is a specific program\n  (e.g., 93.778 = Medicaid, 20.205 = Highway funding, 84.063 = Pell Grants).`,
  });

  // Biggest individual contracts in the state
  await showAwards({
    filters: locFilt,
    awardTypes: CONTRACT_TYPES,
    limit: 20,
    title: `Biggest Individual Contracts — ${stateName} — FY${FY}`,
  });

  // Biggest grants in the state
  await showAwards({
    filters: locFilt,
    awardTypes: GRANT_TYPES,
    limit: 15,
    title: `Biggest Individual Grants — ${stateName} — FY${FY}`,
  });
}

// ── AGENCY: biggest awards from a specific agency ─────────────────────────
async function agencyView(agency) {
  const agFilt = { agencies: [{ type: "awarding", tier: "toptier", name: agency }] };

  await showAwards({
    filters: agFilt,
    awardTypes: CONTRACT_TYPES,
    limit: 25,
    title: `Biggest Contracts — ${agency} — FY${FY}`,
  });

  await showAwards({
    filters: agFilt,
    awardTypes: GRANT_TYPES,
    limit: 20,
    title: `Biggest Grants — ${agency} — FY${FY}`,
  });

  // Sub-agencies within this toptier agency
  await showCategory("awarding_subagency", {
    filters: agFilt,
    title: `${agency} — Spending by Sub-Agency — FY${FY}`,
    limit: 20,
  });

  // Top recipients from this agency
  await showCategory("recipient", {
    filters: agFilt,
    title: `${agency} — Top Recipients — FY${FY}`,
    limit: 20,
  });
}

// ── MAIN ──────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n  FEDERAL AWARDS EXPLORER — FY${FY}  (Oct ${FY-1} → Sep ${FY})`);
  console.log("  Source: USASpending.gov   No key required\n");

  try {
    if (MEDICARE)      await medicareView();
    else if (STATE)    await stateView(STATE);
    else if (AGENCY)   await agencyView(AGENCY);
    else               await defaultView();
  } catch (err) {
    console.error(`\n  Error: ${err.message}`);
    process.exit(1);
  }

  console.log(`\n  ── How to use this tool ──────────────────────────────────────────────────`);
  console.log(`  node scripts/federal-awards.mjs                   Top 30 biggest awards`);
  console.log(`  node scripts/federal-awards.mjs --medicare         Who gets Medicare/CMS money`);
  console.log(`  node scripts/federal-awards.mjs --state AZ         Everything going to Arizona`);
  console.log(`  node scripts/federal-awards.mjs --state CA         Everything going to California`);
  console.log(`  node scripts/federal-awards.mjs --agency "Department of Defense"`);
  console.log(`  node scripts/federal-awards.mjs --agency "National Institutes of Health"`);
  console.log(`  node scripts/federal-awards.mjs --agency "Social Security Administration"`);
  console.log(`  node scripts/federal-awards.mjs 2024              Use FY2024 instead\n`);
})();
