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

// Raw 10-K + 10-Q data points -> [{ end, month, val, dur }]. dur=null for
// balance-sheet (instant) items; ~365 = full year; ~90 = a single quarter.
async function raw(cik, tag) {
  let d;
  try {
    d = await getJSON(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`);
  } catch {
    return [];
  }
  const out = [];
  for (const u of d.units?.USD || []) {
    if ((u.form !== "10-K" && u.form !== "10-Q") || !u.end) continue;
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

// Distinct single quarters (~90-day periods), deduped by end date, ascending.
function quarters(rows) {
  const m = {};
  for (const r of rows) if (r.dur && r.dur >= 80 && r.dur <= 100 && m[r.end] == null) m[r.end] = r.val;
  return Object.entries(m).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
// Trailing-twelve-months: sum of the last 4 quarters -> { val, through, prevVal }.
function ttm(rows) {
  const q = quarters(rows);
  if (q.length < 4) return null;
  const sum = (arr) => arr.reduce((s, [, v]) => s + v, 0);
  return {
    val: sum(q.slice(-4)),
    through: q[q.length - 1][0],
    prevVal: q.length >= 8 ? sum(q.slice(-8, -4)) : null, // same 4 quarters a year earlier
  };
}
// Most recent balance-sheet snapshot across all filings (current quarter).
function latestInstant(rows) {
  let best = null;
  for (const r of rows) if (r.dur === null && (!best || r.end > best.end)) best = r;
  return best;
}

// Fiscal year -> end date (e.g. {2025: "2025-06-30"}), from full-year revenue periods.
function annualEnds(rows) {
  const m = {};
  for (const r of rows) if (r.dur && r.dur >= 350 && r.dur <= 380) m[+r.end.slice(0, 4)] = r.end;
  return m;
}

// Monthly closing prices from Yahoo Finance (free, keyless) -> [{ d: "YYYY-MM-DD", c }].
async function prices(ticker) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=10y&interval=1mo`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const r = (await res.json())?.chart?.result?.[0];
    const ts = r?.timestamp || [], cl = r?.indicators?.quote?.[0]?.close || [];
    return ts.map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), c: cl[i] })).filter((x) => x.c != null);
  } catch {
    return [];
  }
}

// Closing price nearest a target date (within ~45 days), else null.
function priceAt(px, date) {
  let best = null, bestGap = Infinity;
  for (const p of px) {
    const gap = Math.abs(Date.parse(p.d) - Date.parse(date));
    if (gap < bestGap) { bestGap = gap; best = p.c; }
  }
  return bestGap <= 45 * 86_400_000 ? best : null;
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

    const px = await prices(TICKER);          // Yahoo monthly closes (free, keyless)
    const ends = annualEnds(revR);            // fiscal-year-end dates, for price lookup

    const years = [...new Set([...Object.keys(rev), ...Object.keys(ni)])].map(Number).sort().slice(-4);

    const D = (n) => (n == null ? "-" : `$${n.toFixed(0)}`);
    console.log(`\n  ${name}  (${TICKER}, CIK ${cik}) — fiscal year ends month ${fyMonth}`);
    console.log("  source: SEC EDGAR (financials) + Yahoo Finance (prices)\n");
    console.log("  Year  Revenue    RevGrowth  GrossMgn  NetIncome   NetMgn   R&D       OpCashFlow   StockPx*  PxYoY");
    console.log("  ────  ─────────  ─────────  ────────  ──────────  ──────   ───────   ──────────   ────────  ──────");
    let prev = null, prevPx = null;
    for (const y of years) {
      const r = rev[y], n = ni[y];
      const gm = r && gp[y] != null ? P(gp[y] / r) : "-";
      const nm = r && n != null ? P(n / r) : "-";
      const g = r && prev ? P(r / prev - 1) : "-";
      const pxY = ends[y] ? priceAt(px, ends[y]) : null;
      const pxChg = pxY && prevPx ? P(pxY / prevPx - 1) : "-";
      console.log(
        `  ${y}  ${B(r).padEnd(9)}  ${g.padStart(8)}   ${gm.padStart(7)}  ${B(n).padEnd(10)}  ${nm.padStart(6)}   ${B(rnd[y]).padEnd(7)}   ${B(ocf[y]).padEnd(10)}   ${D(pxY).padStart(7)}  ${pxChg.padStart(6)}`
      );
      if (r) prev = r;
      if (pxY) prevPx = pxY;
    }

    // Trailing-twelve-months row — current run-rate even though the fiscal year isn't over.
    const tRev = ttm(revR), tGp = ttm(gpR), tNi = ttm(niR), tRnd = ttm(rndR), tOcf = ttm(ocfR);
    if (tRev) {
      const gm = tGp ? P(tGp.val / tRev.val) : "-";
      const nm = tNi ? P(tNi.val / tRev.val) : "-";
      const g = tRev.prevVal ? P(tRev.val / tRev.prevVal - 1) : "-";
      const nowPx = px.length ? px[px.length - 1].c : null;
      console.log("  ····  ·········  ·········  ········  ··········  ······   ·······   ··········   ········  ──────");
      console.log(
        `  TTM*  ${B(tRev.val).padEnd(9)}  ${g.padStart(8)}   ${gm.padStart(7)}  ${B(tNi?.val).padEnd(10)}  ${nm.padStart(6)}   ${B(tRnd?.val).padEnd(7)}   ${B(tOcf?.val).padEnd(10)}   ${D(nowPx).padStart(7)}  (now)`
      );
      console.log(`  * TTM = trailing 12 months through ${tRev.through} (10-Q filings; FY not yet closed). StockPx* = price near each fiscal year-end.`);
    }

    // Current balance sheet — latest available quarter, not just the last fiscal year-end.
    const cashL = latestInstant(cashR), eqL = latestInstant(eqR);
    const dbtCL = latestInstant(dbtCR), dbtNCL = latestInstant(dbtNCR);
    const totalDebt = (dbtCL?.val || 0) + (dbtNCL?.val || 0) || null;
    const asOf = [cashL?.end, eqL?.end, dbtNCL?.end].filter(Boolean).sort().pop();
    console.log(`\n  Balance sheet (as of ${asOf || "latest"}):`);
    console.log(`    Cash & equivalents .. ${B(cashL?.val)}`);
    console.log(`    Total debt .......... ${B(totalDebt)}`);
    console.log(`    Shareholder equity .. ${B(eqL?.val)}`);
    console.log("\n  Read it like this:");
    console.log("    Rising revenue + rising margins + real operating cash = healthy grower (high multiple).");
    console.log("    Revenue up but margins/cash down = value trap (UNH-style).  More cash than debt = safety.\n");
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();
