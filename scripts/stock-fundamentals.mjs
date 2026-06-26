#!/usr/bin/env node
// stock-fundamentals.mjs — pull a public company's real financials straight from
// its SEC filings (10-K), via the official SEC EDGAR API.
//
// Run:  node scripts/stock-fundamentals.mjs AMD
//       node scripts/stock-fundamentals.mjs MU
// Data source: data.sec.gov  (EDGAR). No API key, but SEC requires a User-Agent.
// Read the same filings as a human: https://www.sec.gov/edgar/search/
//
// Per fiscal year: revenue, revenue growth, gross margin, net income, net margin,
// R&D, operating cash flow — plus a latest balance-sheet snapshot (cash/debt/equity).
// Handles any fiscal-year-end (Micron=Aug, Seagate=Jun, Dell=Jan, etc.), not just December.

const TICKER = (process.argv[2] || "AMD").toUpperCase();
const UA = { "User-Agent": "fiscal-data-toolkit (contact: you@example.com)" };

async function getJSON(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function cikFor(ticker) {
  const map = await getJSON("https://www.sec.gov/files/company_tickers.json");
  const hit = Object.values(map).find((c) => c.ticker === ticker);
  if (!hit) throw new Error(`Ticker ${ticker} not found in SEC company list`);
  return { cik: String(hit.cik_str).padStart(10, "0"), name: hit.title };
}

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

// Raw 10-K data points for a concept -> [{ end, month, val, dur }]. dur=null for
// balance-sheet (instant) items; ~365 for full-year (duration) items.
async function raw(cik, tag) {
  let d;
  try {
    d = await getJSON(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`);
  } catch {
    return [];
  }
  const out = [];
  for (const u of d.units?.USD || []) {
    if (u.form !== "10-K" || !u.end) continue;
    out.push({ end: u.end, month: u.end.slice(5, 7), val: u.val, dur: u.start ? days(u.start, u.end) : null });
  }
  return out;
}

// Merge all candidate tags' rows (companies switch XBRL tags over the years).
async function combine(cik, tags) {
  const all = await Promise.all(tags.map((t) => raw(cik, t)));
  return all.flat();
}

// Fiscal year-end month, taken from the most recent full-year revenue period (for display only).
function annualMapMonth(rows) {
  const ann = rows.filter((r) => r.dur && r.dur >= 350 && r.dur <= 380).sort((a, b) => (a.end < b.end ? 1 : -1));
  return ann[0]?.month || "12";
}

// Full-year flows (revenue, income): keep ~365-day periods, key by end-year.
function annualMap(rows) {
  const m = {};
  for (const r of rows) if (r.dur && r.dur >= 350 && r.dur <= 380) m[+r.end.slice(0, 4)] = r.val;
  return m;
}
// Balance-sheet snapshots (10-K instants are all fiscal year-ends): key by end-year,
// keeping the latest date per year — robust across any fiscal calendar / 52-53wk drift.
function instantMap(rows) {
  const m = {}, seen = {};
  for (const r of rows) {
    if (r.dur !== null) continue;
    const y = +r.end.slice(0, 4);
    if (!seen[y] || r.end > seen[y]) { seen[y] = r.end; m[y] = r.val; }
  }
  return m;
}

const B = (n) => (n == null ? "-" : `$${(n / 1e9).toFixed(1)}B`);
const P = (n) => (n == null ? "-" : `${(n * 100).toFixed(1)}%`);

(async () => {
  try {
    const { cik, name } = await cikFor(TICKER);
    const [revR, gpR, niR, rndR, ocfR, cashR, dbtCR, dbtNCR, eqR] = await Promise.all([
      combine(cik, ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"]),
      raw(cik, "GrossProfit"),
      raw(cik, "NetIncomeLoss"),
      raw(cik, "ResearchAndDevelopmentExpense"),
      combine(cik, ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]),
      combine(cik, ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]),
      raw(cik, "LongTermDebtCurrent"),
      combine(cik, ["LongTermDebtNoncurrent", "LongTermDebt"]),
      combine(cik, ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]),
    ]);

    const fyMonth = annualMapMonth(revR);
    const rev = annualMap(revR), gp = annualMap(gpR), ni = annualMap(niR);
    const rnd = annualMap(rndR), ocf = annualMap(ocfR);
    const cash = instantMap(cashR), dbtC = instantMap(dbtCR);
    const dbtNC = instantMap(dbtNCR), eq = instantMap(eqR);

    const years = [...new Set([...Object.keys(rev), ...Object.keys(ni)])].map(Number).sort().slice(-4);

    console.log(`\n  ${name}  (${TICKER}, CIK ${cik}) — fiscal year ends month ${fyMonth}`);
    console.log("  source: SEC EDGAR 10-K filings\n");
    console.log("  Year  Revenue    RevGrowth  GrossMgn  NetIncome   NetMgn   R&D       OpCashFlow");
    console.log("  ────  ─────────  ─────────  ────────  ──────────  ──────   ───────   ──────────");
    let prev = null;
    for (const y of years) {
      const r = rev[y], n = ni[y];
      const gm = r && gp[y] != null ? P(gp[y] / r) : "-";
      const nm = r && n != null ? P(n / r) : "-";
      const g = r && prev ? P(r / prev - 1) : "-";
      console.log(
        `  ${y}  ${B(r).padEnd(9)}  ${g.padStart(8)}   ${gm.padStart(7)}  ${B(n).padEnd(10)}  ${nm.padStart(6)}   ${B(rnd[y]).padEnd(7)}   ${B(ocf[y])}`
      );
      if (r) prev = r;
    }

    const ly = Math.max(...years);
    const totalDebt = (dbtC[ly] || 0) + (dbtNC[ly] || 0) || null;
    console.log("\n  Balance sheet (latest fiscal year):");
    console.log(`    Cash & equivalents .. ${B(cash[ly])}`);
    console.log(`    Total debt .......... ${B(totalDebt)}`);
    console.log(`    Shareholder equity .. ${B(eq[ly])}`);
    console.log("\n  Read it like this:");
    console.log("    Rising revenue + rising margins + real operating cash = healthy grower (high multiple).");
    console.log("    Revenue up but margins/cash down = value trap (UNH-style).  More cash than debt = safety.\n");
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();
