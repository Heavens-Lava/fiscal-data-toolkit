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
const PERIODIC_FORMS = new Set(["10-K", "10-Q", "20-F", "6-K"]);

// Raw filing data points -> [{ end, month, val, dur }]. dur=null for
// balance-sheet (instant) items; ~365 = full year; ~90 = a single quarter.
// ns = "us-gaap" for domestic filers, "ifrs-full" for foreign private issuers.
async function raw(cik, tag, ns = "us-gaap") {
  let d;
  try {
    d = await getJSON(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${ns}/${tag}.json`);
  } catch {
    return [];
  }
  const out = [];
  for (const u of d.units?.USD || []) {
    if (!PERIODIC_FORMS.has(u.form) || !u.end) continue;
    out.push({ end: u.end, month: u.end.slice(5, 7), val: u.val, dur: u.start ? days(u.start, u.end) : null });
  }
  return out;
}

// Merge all candidate tags' rows (companies switch XBRL tags over the years).
async function combine(cik, tags, ns = "us-gaap") {
  const all = await Promise.all(tags.map((t) => raw(cik, t, ns)));
  return all.flat();
}

// Try US GAAP tags first; if empty, fall back to IFRS equivalents.
// Handles foreign private issuers (20-F filers like TSM, ASML, etc.).
async function gaapOrIfrs(cik, gaapTags, ifrsTags) {
  const rows = await combine(cik, gaapTags);
  return rows.length ? rows : combine(cik, ifrsTags, "ifrs-full");
}

// Fiscal year-end month, taken from the most recent full-year revenue period (for display only).
function annualMapMonth(rows) {
  const ann = rows.filter((r) => r.dur && r.dur >= 350 && r.dur <= 380).sort((a, b) => (a.end < b.end ? 1 : -1));
  return ann[0]?.month || "12";
}

// Full-year flows (income, R&D): keep ~365-day periods, key by end-year (last wins).
function annualMap(rows) {
  const m = {};
  for (const r of rows) if (r.dur && r.dur >= 350 && r.dur <= 380) m[+r.end.slice(0, 4)] = r.val;
  return m;
}
// Revenue can be reported under several tags; one may hold a stray partial value.
// Take the LARGEST per year (true total revenue >= any sub-component) to avoid that.
function annualMapMax(rows) {
  const m = {};
  for (const r of rows) {
    if (!(r.dur && r.dur >= 350 && r.dur <= 380)) continue;
    const y = +r.end.slice(0, 4);
    if (m[y] == null || r.val > m[y]) m[y] = r.val;
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

// Current shares outstanding — tries several concepts (companies tag this
// differently). Sums distinct share-class counts at the latest date (multi-class
// like GOOGL/RBLX); weighted-average falls back to a single figure.
async function sharesOutstanding(cik) {
  const tryConcept = async (path, multiclass) => {
    let d;
    try { d = await getJSON(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${path}.json`); }
    catch { return null; }
    const units = d.units?.shares || [];
    if (!units.length) return null;
    const maxEnd = units.reduce((a, u) => (u.end > a ? u.end : a), "");
    const distinct = [...new Set(units.filter((u) => u.end === maxEnd).map((u) => u.val))];
    return (multiclass ? distinct.reduce((s, v) => s + v, 0) : Math.max(...distinct)) || null;
  };
  return (
    (await tryConcept("dei/EntityCommonStockSharesOutstanding", true)) ||
    (await tryConcept("us-gaap/CommonStockSharesOutstanding", true)) ||
    (await tryConcept("us-gaap/WeightedAverageNumberOfDilutedSharesOutstanding", false)) ||
    null
  );
}

// Check EDGAR submissions for annual filings (10-K or 20-F) newer than latestDataYear.
// Returns the most recent filing date + form if one exists, else null.
async function newerAnnualFiling(cik, latestDataYear) {
  try {
    const d = await getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const f = d.filings?.recent;
    if (!f) return null;
    let best = null;
    for (let i = 0; i < f.form.length; i++) {
      if (f.form[i] !== "10-K" && f.form[i] !== "20-F") continue;
      const fy = +f.filingDate[i].slice(0, 4);
      if (fy > latestDataYear && (!best || f.filingDate[i] > best.date))
        best = { form: f.form[i], date: f.filingDate[i], doc: f.primaryDocument[i] };
    }
    return best;
  } catch { return null; }
}

const B = (n) => (n == null ? "-" : `$${(n / 1e9).toFixed(1)}B`);
const P = (n) => (n == null ? "-" : `${(n * 100).toFixed(1)}%`);

(async () => {
  try {
    const { cik, name } = await cikFor(TICKER);
    const [revR, gpR, niR, rndR, ocfR, cashR, dbtCR, dbtNCR, eqR] = await Promise.all([
      gaapOrIfrs(cik, ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"], ["Revenue", "RevenueFromContractsWithCustomers"]),
      gaapOrIfrs(cik, ["GrossProfit"], ["GrossProfit"]),
      gaapOrIfrs(cik, ["NetIncomeLoss"], ["ProfitLoss", "ProfitLossAttributableToOwnersOfParent"]),
      gaapOrIfrs(cik, ["ResearchAndDevelopmentExpense"], ["ResearchAndDevelopmentExpense"]),
      gaapOrIfrs(cik, ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], ["CashFlowsFromUsedInOperatingActivities"]),
      gaapOrIfrs(cik, ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], ["CashAndCashEquivalents"]),
      gaapOrIfrs(cik, ["LongTermDebtCurrent"], ["CurrentPortionOfLongtermBorrowings"]),
      gaapOrIfrs(cik, ["LongTermDebtNoncurrent", "LongTermDebt"], ["NoncurrentPortionOfLongtermBorrowings", "LongtermBorrowings"]),
      gaapOrIfrs(cik, ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], ["Equity", "EquityAttributableToOwnersOfParent"]),
    ]);

    const fyMonth = annualMapMonth(revR);
    const rev = annualMapMax(revR), gp = annualMap(gpR), ni = annualMap(niR);
    const rnd = annualMap(rndR), ocf = annualMap(ocfR);

    const [px, lagCheck] = await Promise.all([
      prices(TICKER),
      (async () => {
        const years = [...new Set([...Object.keys(rev), ...Object.keys(ni)])].map(Number).sort();
        const latestDataYear = years[years.length - 1] ?? 0;
        return newerAnnualFiling(cik, latestDataYear);
      })(),
    ]);
    const ends = annualEnds(revR);            // fiscal-year-end dates, for price lookup

    const years = [...new Set([...Object.keys(rev), ...Object.keys(ni)])].map(Number).sort().slice(-4);

    const D = (n) => (n == null ? "-" : `$${n.toFixed(0)}`);
    console.log(`\n  ${name}  (${TICKER}, CIK ${cik}) — fiscal year ends month ${fyMonth}`);
    console.log("  source: SEC EDGAR (financials) + Yahoo Finance (prices)\n");
    console.log("  Year  Revenue    RevGrowth  GrossMgn  NetIncome   NetMgn   R&D       OpCashFlow   StockPx*  PxYoY");
    console.log("  ────  ─────────  ─────────  ────────  ──────────  ──────   ───────   ──────────   ────────  ──────");
    // Seed from the year BEFORE the table starts so the first row also shows growth.
    const y0 = years[0] - 1;
    let prev = rev[y0] ?? null;
    let prevPx = ends[y0] ? priceAt(px, ends[y0]) : null;
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

    if (lagCheck) {
      console.log(`\n  ⚠  ${lagCheck.form} for a newer fiscal year was filed ${lagCheck.date} but EDGAR hasn't`);
      console.log(`     indexed its XBRL yet — financials above stop at ${Math.max(...years)}. Check back in a few weeks.`);
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

    // Valuation — how expensive the stock is vs the business ("is it priced in?").
    const lastY = Math.max(...years);
    const nowPx = px.length ? px[px.length - 1].c : null;
    const shares = await sharesOutstanding(cik);
    const mktCap = shares && nowPx ? shares * nowPx : null;
    const sales = tRev?.val ?? rev[lastY];
    const profit = tNi?.val ?? ni[lastY];
    const cashFlow = tOcf?.val ?? ocf[lastY];
    const X = (cap, base) => (cap && base > 0 ? `${(cap / base).toFixed(1)}x` : null);
    const shB = (n) => (n == null ? "-" : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : `${(n / 1e6).toFixed(0)}M`);
    console.log(`\n  Valuation (at current price ${D(nowPx)}):`);
    console.log(`    Shares outstanding .. ${shB(shares)}`);
    console.log(`    Market cap .......... ${B(mktCap)}`);
    console.log(`    Price / Sales ....... ${X(mktCap, sales) || "-"}      (>10x = priced for big growth)`);
    console.log(`    Price / Earnings .... ${X(mktCap, profit) || "n/a (unprofitable)"}      (market avg ~20x)`);
    console.log(`    Price / Cash Flow ... ${X(mktCap, cashFlow) || "-"}      (best gauge when there's no profit)`);

    console.log("\n  Read it like this:");
    console.log("    Rising revenue + rising margins + real operating cash = healthy grower.");
    console.log("    Revenue up but margins/cash down = value trap (UNH-style).  More cash than debt = safety.");
    console.log("    HIGH valuation (P/S, P/E, P/CF) = good news already priced in; even great results");
    console.log("    can disappoint (PLTR). LOW valuation = less expectation to live up to.\n");
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();
