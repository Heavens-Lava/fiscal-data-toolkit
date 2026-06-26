#!/usr/bin/env node
// revenue-growth.mjs — screen a watchlist by revenue growth, margin trend, AND
// valuation, from SEC EDGAR (fundamentals) + Yahoo Finance (price). Flags the
// combination that actually matters: fast growth + expanding margins + a price
// you don't have to overpay for.
//
// Run:  node scripts/revenue-growth.mjs                 (default watchlist)
//       node scripts/revenue-growth.mjs AMD MU NVDA RBLX
// Data: data.sec.gov + Yahoo Finance. No API keys (SEC needs a User-Agent).
//
// Flags:  💎 = 20%+ growth + expanding margins + reasonable P/S (<10x)  [the sweet spot]
//         🚀 = 20%+ growth + expanding margins, but richly valued
//         📈 = 20%+ growth only

const args = process.argv.slice(2).map((t) => t.toUpperCase());
const WATCHLIST = args.length
  ? args
  : ["AMD", "NVDA", "MU", "STX", "SNDK", "INTC", "DELL", "AVGO", "PLTR", "SMCI", "RBLX", "UNH", "JPM", "META"];

const UA = { "User-Agent": "fiscal-data-toolkit (contact: you@example.com)" };
const GROWTH = 0.20;     // 20%
const CHEAP_PS = 10;     // P/S below this = "reasonably valued"

async function getJSON(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

// Annual (full-year) values for a concept -> { year: value }. `max` takes the
// largest per year across tags (revenue, to dodge stray partial-value tags).
async function annual(cik, tags, max = false) {
  const m = {};
  for (const tag of tags) {
    let d;
    try { d = await getJSON(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`); }
    catch { continue; }
    for (const u of d.units?.USD || []) {
      if (u.form !== "10-K" || !u.start) continue;
      const dur = days(u.start, u.end);
      if (dur < 350 || dur > 380) continue;
      const y = +u.end.slice(0, 4);
      if (!max) m[y] = u.val;
      else if (m[y] == null || u.val > m[y]) m[y] = u.val;
    }
  }
  return m;
}

async function sharesOutstanding(cik) {
  const tryC = async (path, multi) => {
    let d;
    try { d = await getJSON(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${path}.json`); }
    catch { return null; }
    const u = d.units?.shares || [];
    if (!u.length) return null;
    const maxEnd = u.reduce((a, x) => (x.end > a ? x.end : a), "");
    const vals = [...new Set(u.filter((x) => x.end === maxEnd).map((x) => x.val))];
    return (multi ? vals.reduce((s, v) => s + v, 0) : Math.max(...vals)) || null;
  };
  return (
    (await tryC("dei/EntityCommonStockSharesOutstanding", true)) ||
    (await tryC("us-gaap/CommonStockSharesOutstanding", true)) ||
    (await tryC("us-gaap/WeightedAverageNumberOfDilutedSharesOutstanding", false)) ||
    null
  );
}

async function currentPrice(ticker) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5d&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0" } });
    const cl = ((await res.json())?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
    return cl.length ? cl[cl.length - 1] : null;
  } catch { return null; }
}

const REV = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"];
const OCF = ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"];

async function analyze(tickerMap, ticker) {
  const hit = Object.values(tickerMap).find((c) => c.ticker === ticker);
  if (!hit) return { ticker, error: "not found" };
  const cik = String(hit.cik_str).padStart(10, "0");
  const [rev, gp, ni, ocf, shares, price] = await Promise.all([
    annual(cik, REV, true), annual(cik, ["GrossProfit"]), annual(cik, ["NetIncomeLoss"]),
    annual(cik, OCF), sharesOutstanding(cik), currentPrice(ticker),
  ]);
  const yrs = Object.keys(rev).map(Number).sort();
  if (yrs.length < 2) return { ticker, error: "insufficient data" };
  const [y0, y1] = [yrs[yrs.length - 2], yrs[yrs.length - 1]];
  const revGrowth = rev[y1] / rev[y0] - 1;
  const gm0 = gp[y0] && rev[y0] ? gp[y0] / rev[y0] : null;
  const gm1 = gp[y1] && rev[y1] ? gp[y1] / rev[y1] : null;
  const marginChg = gm0 != null && gm1 != null ? gm1 - gm0 : null;
  const netMargin = ni[y1] != null && rev[y1] ? ni[y1] / rev[y1] : null;
  const mcap = shares && price ? shares * price : null;
  const ps = mcap && rev[y1] > 0 ? mcap / rev[y1] : null;
  const pcf = mcap && ocf[y1] > 0 ? mcap / ocf[y1] : null;
  return { ticker, year: y1, revGrowth, gm1, marginChg, netMargin, ps, pcf };
}

async function pool(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  return out;
}

const P = (x) => (x == null ? "  -  " : `${(x * 100).toFixed(1)}%`);
const sign = (x) => (x == null ? "  -  " : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}pp`);
const X = (x) => (x == null ? "  -  " : `${x.toFixed(1)}x`);

(async () => {
  try {
    const tickerMap = await getJSON("https://www.sec.gov/files/company_tickers.json");
    const rows = (await pool(WATCHLIST, 4, (t) => analyze(tickerMap, t)))
      .filter((r) => !r.error)
      .sort((a, b) => b.revGrowth - a.revGrowth);

    console.log("\n  REVENUE-GROWTH + VALUATION SCREEN  (SEC EDGAR + Yahoo Finance)");
    console.log("  💎 growth≥20% + expanding margins + cheap (P/S<10)   🚀 growth+margins (pricey)   📈 growth only\n");
    console.log("  Ticker  FY    RevGrowth   GrossMgn  MgnChange   NetMgn    P/S    P/CF    Flag");
    console.log("  ──────  ────  ─────────   ────────  ─────────   ──────    ─────  ─────   ────");
    for (const r of rows) {
      const grow = r.revGrowth >= GROWTH, hot = grow && r.marginChg > 0;
      const cheap = r.ps != null && r.ps < CHEAP_PS;
      const flag = hot && cheap ? "💎" : hot ? "🚀" : grow ? "📈" : "";
      console.log(
        `  ${r.ticker.padEnd(6)}  ${r.year}  ${P(r.revGrowth).padStart(8)}   ${P(r.gm1).padStart(7)}  ${sign(r.marginChg).padStart(8)}   ${P(r.netMargin).padStart(6)}   ${X(r.ps).padStart(6)} ${X(r.pcf).padStart(6)}   ${flag}`
      );
    }
    const missing = WATCHLIST.filter((t) => !rows.find((r) => r.ticker === t));
    if (missing.length) console.log(`\n  (no/insufficient data: ${missing.join(", ")})`);
    console.log("\n  P/S = price-to-sales, P/CF = price-to-cash-flow (works when unprofitable).");
    console.log("  💎 is the sweet spot: growing fast, margins expanding, not yet bid up.");
    console.log("  Reminder: still no guarantee of upside — but it beats screening on growth alone.\n");
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();
