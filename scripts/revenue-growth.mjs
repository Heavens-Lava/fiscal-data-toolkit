#!/usr/bin/env node
// revenue-growth.mjs — screen a watchlist of stocks for revenue growth AND margin
// trend, straight from SEC EDGAR 10-K filings. Ranks by revenue growth and flags
// the combination that actually predicts big stock moves: fast growth + EXPANDING
// margins (not revenue growth alone).
//
// Run:  node scripts/revenue-growth.mjs                 (uses a default watchlist)
//       node scripts/revenue-growth.mjs AMD MU NVDA INTC DELL
// Data: data.sec.gov (EDGAR). No key, but SEC requires a User-Agent header.
//
// NOTE: SEC gives fundamentals, NOT stock prices. As our analysis showed, stock
// returns are driven far more by margin/profit inflection + expectations than by
// revenue growth — so a 🚀 here means "fundamentally inflecting," not "will go up."

const args = process.argv.slice(2).map((t) => t.toUpperCase());
const WATCHLIST = args.length
  ? args
  : ["AMD", "NVDA", "MU", "STX", "SNDK", "INTC", "DELL", "AVGO", "PLTR", "SMCI", "LMT", "UNH", "JPM", "META"];

const UA = { "User-Agent": "fiscal-data-toolkit (contact: you@example.com)" };
const GROWTH_THRESHOLD = 0.20; // 20%

async function getJSON(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

// Annual (full-year) values for a concept -> { year: value }, trying multiple tags.
async function annual(cik, tags) {
  const m = {};
  for (const tag of tags) {
    let d;
    try { d = await getJSON(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`); }
    catch { continue; }
    for (const u of d.units?.USD || []) {
      if (u.form !== "10-K" || !u.start) continue;
      const dur = days(u.start, u.end);
      if (dur >= 350 && dur <= 380) m[+u.end.slice(0, 4)] = u.val;
    }
  }
  return m;
}

const REV_TAGS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"];

async function analyze(tickerMap, ticker) {
  const hit = Object.values(tickerMap).find((c) => c.ticker === ticker);
  if (!hit) return { ticker, error: "not found" };
  const cik = String(hit.cik_str).padStart(10, "0");
  const [rev, gp, ni] = await Promise.all([
    annual(cik, REV_TAGS),
    annual(cik, ["GrossProfit"]),
    annual(cik, ["NetIncomeLoss"]),
  ]);
  const yrs = Object.keys(rev).map(Number).sort();
  if (yrs.length < 2) return { ticker, error: "insufficient data" };
  const [y0, y1] = [yrs[yrs.length - 2], yrs[yrs.length - 1]];
  const revGrowth = rev[y1] / rev[y0] - 1;
  const gm0 = gp[y0] && rev[y0] ? gp[y0] / rev[y0] : null;
  const gm1 = gp[y1] && rev[y1] ? gp[y1] / rev[y1] : null;
  const marginChg = gm0 != null && gm1 != null ? gm1 - gm0 : null;
  const netMargin = ni[y1] != null && rev[y1] ? ni[y1] / rev[y1] : null;
  return { ticker, year: y1, rev: rev[y1], revGrowth, gm1, marginChg, netMargin };
}

// Limit concurrency to stay friendly to SEC's rate limit.
async function pool(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) {
    out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  }
  return out;
}

const P = (x, d = 1) => (x == null ? "  -  " : `${(x * 100).toFixed(d)}%`);
const sign = (x) => (x == null ? "  -  " : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}pp`);

(async () => {
  try {
    const tickerMap = await getJSON("https://www.sec.gov/files/company_tickers.json");
    const rows = (await pool(WATCHLIST, 4, (t) => analyze(tickerMap, t)))
      .filter((r) => !r.error)
      .sort((a, b) => b.revGrowth - a.revGrowth);

    console.log("\n  REVENUE-GROWTH SCREEN  (source: SEC EDGAR 10-K filings)");
    console.log("  🚀 = revenue growth ≥20% AND gross margin expanding (the combo that matters)\n");
    console.log("  Ticker  FY    RevGrowth   GrossMgn   MgnChange   NetMgn    Flag");
    console.log("  ──────  ────  ─────────   ────────   ─────────   ──────    ────");
    for (const r of rows) {
      const hot = r.revGrowth >= GROWTH_THRESHOLD && r.marginChg != null && r.marginChg > 0;
      const warm = r.revGrowth >= GROWTH_THRESHOLD;
      const flag = hot ? "🚀" : warm ? "📈" : "";
      console.log(
        `  ${r.ticker.padEnd(6)}  ${r.year}  ${P(r.revGrowth).padStart(8)}   ${P(r.gm1).padStart(7)}   ${sign(r.marginChg).padStart(8)}   ${P(r.netMargin).padStart(6)}    ${flag}`
      );
    }
    const missing = WATCHLIST.filter((t) => !rows.find((r) => r.ticker === t));
    if (missing.length) console.log(`\n  (no/insufficient data: ${missing.join(", ")})`);
    console.log("\n  📈 = 20%+ revenue growth.  🚀 = 20%+ growth WITH expanding margins.");
    console.log("  Reminder: fundamentals only — SEC has no prices. Stock returns track");
    console.log("  margin/profit inflection + expectations, not the revenue rate alone.\n");
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();
