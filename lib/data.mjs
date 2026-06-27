// data.mjs — shared data layer for the toolkit. Pulls live figures from official
// government APIs (Treasury, FDIC, FRED/BEA, SEC EDGAR, Yahoo) with no API keys.
// Used by both the CLI dashboard (dashboard.mjs) and the web server (server.mjs).

const UA = { "User-Agent": "fiscal-data-toolkit (contact: you@example.com)" };

async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}
async function fred(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!res.ok) throw new Error(`${res.status} for ${id}`);
  return (await res.text()).trim().split("\n").slice(1)
    .map((l) => { const [d, v] = l.split(","); return { d, v: Number(v) }; })
    .filter((x) => Number.isFinite(x.v));
}
const last = (a) => a[a.length - 1];
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const histVals = async (id, n = 24) => (await fred(id)).slice(-n).map((x) => x.v);
const TR = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";

// ── Government finances (Treasury Fiscal Data) ───────────────────────────────
export async function fiscal() {
  const debt = (await getJSON(`${TR}/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1`)).data[0];
  const latest = (await getJSON(`${TR}/v1/accounting/mts/mts_table_1?sort=-record_date&page[size]=1`)).data[0].record_date;
  const rows = (await getJSON(`${TR}/v1/accounting/mts/mts_table_1?filter=record_date:eq:${latest}&page[size]=50`))
    .data.filter((r) => r.classification_desc === "Year-to-Date");
  const fy = Math.max(...rows.map((r) => +r.record_fiscal_year));
  const cur = rows.find((r) => +r.record_fiscal_year === fy);
  const intRows = (await getJSON(`${TR}/v2/accounting/od/interest_expense?sort=-record_date&page[size]=1`)).data[0].record_date;
  const interest = (await getJSON(`${TR}/v2/accounting/od/interest_expense?filter=record_date:eq:${intRows}&page[size]=100`))
    .data.reduce((s, r) => s + Number(r.fytd_expense_amt || 0), 0);
  return {
    debt: Number(debt.tot_pub_debt_out_amt), debtDate: debt.record_date,
    fy, asOf: latest,
    receipts: Number(cur.current_month_gross_rcpt_amt),
    outlays: Number(cur.current_month_gross_outly_amt),
    deficit: Number(cur.current_month_dfct_sur_amt),
    interestFytd: interest,
    debtHistory: await histVals("GFDEBTN"), // total public debt, quarterly (for sparkline)
  };
}

// ── Trade & external position (FRED / BEA) ───────────────────────────────────
export async function trade() {
  const [ca, tb, niip, gdp] = await Promise.all([fred("IEABC"), fred("BOPGSTB"), fred("IIPUSNETIQ"), fred("GDP")]);
  const caL = last(ca);
  return {
    currentAccount: caL.v * 1e6, caDate: caL.d, caAnnual: caL.v * 4 * 1e6,
    caPctGdp: (caL.v * 4) / (last(gdp).v * 1000) * 100,
    tradeBalance: last(tb).v * 1e6, tradeDate: last(tb).d,
    niip: last(niip).v * 1e6, niipDate: last(niip).d,
    niipHistory: niip.slice(-24).map((x) => x.v),
  };
}

// ── Money supply (FRED) ──────────────────────────────────────────────────────
export async function money() {
  const [m2, cash] = await Promise.all([fred("M2SL"), fred("CURRCIR")]);
  const base = m2.find((x) => x.d.startsWith("2020-02"))?.v;
  const end = m2.find((x) => x.d.startsWith("2021-12"))?.v;
  return {
    m2: last(m2).v * 1e9, m2Date: last(m2).d,
    cash: last(cash).v * 1e9, cashDate: last(cash).d,
    printed2020_21: (end - base) * 1e9, printedPct: (end - base) / base * 100,
    m2History: m2.slice(-24).map((x) => x.v),
  };
}

// ── Banking sector (FDIC) ────────────────────────────────────────────────────
export async function banking() {
  const F = "https://api.fdic.gov/banks/financials";
  const latest = (await getJSON(`${F}?fields=REPDTE&sort_by=REPDTE&sort_order=DESC&limit=1&format=json`)).data[0].data.REPDTE;
  const rows = (await getJSON(`${F}?filters=REPDTE:${latest}&fields=ASSET,DEP,SC,EQ,NETINC&limit=10000&format=json`)).data;
  const sum = (k) => rows.reduce((s, r) => s + (Number(r.data[k]) || 0), 0) * 1000;
  return {
    quarter: `${latest.slice(0, 4)}-Q${Math.ceil(+latest.slice(4, 6) / 3)}`,
    banks: rows.length, assets: sum("ASSET"), deposits: sum("DEP"),
    securities: sum("SC"), equity: sum("EQ"), netIncome: sum("NETINC"),
    assetsHistory: await histVals("TLAACBW027SBOG", 26).catch(() => []), // commercial bank assets, weekly
  };
}

// ── One company (SEC EDGAR + Yahoo) ──────────────────────────────────────────
async function edgar(cik, tag) {
  let d; try { d = await getJSON(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`, UA); } catch { return []; }
  return (d.units?.USD || [])
    .filter((u) => (u.form === "10-K" || u.form === "10-Q") && u.end)
    .map((u) => ({ end: u.end, val: u.val, dur: u.start ? days(u.start, u.end) : null }));
}
const annualMax = (rows) => { const m = {}; for (const r of rows) if (r.dur >= 350 && r.dur <= 380) { const y = +r.end.slice(0, 4); if (m[y] == null || r.val > m[y]) m[y] = r.val; } return m; };
const annual = (rows) => { const m = {}; for (const r of rows) if (r.dur >= 350 && r.dur <= 380) m[+r.end.slice(0, 4)] = r.val; return m; };
function ttmSum(rows) { const q = {}; for (const r of rows) if (r.dur >= 80 && r.dur <= 100 && q[r.end] == null) q[r.end] = r.val; const e = Object.entries(q).sort((a, b) => a[0] < b[0] ? -1 : 1); return e.length >= 4 ? e.slice(-4).reduce((s, [, v]) => s + v, 0) : null; }
const latestInstant = (rows) => { let b = null; for (const r of rows) if (r.dur === null && (!b || r.end > b.end)) b = r; return b?.val ?? null; };

export async function stock(ticker) {
  ticker = ticker.toUpperCase();
  const map = await getJSON("https://www.sec.gov/files/company_tickers.json", UA);
  const hit = Object.values(map).find((c) => c.ticker === ticker);
  if (!hit) throw new Error(`Ticker ${ticker} not found`);
  const cik = String(hit.cik_str).padStart(10, "0");
  const [revR, gpR, niR, ocfR, capexR, eqR] = await Promise.all([
    Promise.all(["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"].map((t) => edgar(cik, t))).then((a) => a.flat()),
    edgar(cik, "GrossProfit"), edgar(cik, "NetIncomeLoss"),
    Promise.all(["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"].map((t) => edgar(cik, t))).then((a) => a.flat()),
    Promise.all(["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"].map((t) => edgar(cik, t))).then((a) => a.flat()),
    Promise.all(["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"].map((t) => edgar(cik, t))).then((a) => a.flat()),
  ]);
  const rev = annualMax(revR), gp = annual(gpR), ni = annual(niR), ocf = annual(ocfR), capex = annual(capexR);
  const yrs = [...new Set([...Object.keys(rev), ...Object.keys(ni)])].map(Number).sort().slice(-4);
  const fcfOf = (y) => (ocf[y] != null && capex[y] != null ? ocf[y] - capex[y] : null); // capex reported as positive outflow
  const series = yrs.map((y, i) => ({
    year: y, revenue: rev[y] ?? null, netIncome: ni[y] ?? null,
    grossMargin: rev[y] && gp[y] != null ? gp[y] / rev[y] : null,
    netMargin: rev[y] && ni[y] != null ? ni[y] / rev[y] : null,
    revGrowth: i > 0 && rev[yrs[i - 1]] ? rev[y] / rev[yrs[i - 1]] - 1 : null,
    ocf: ocf[y] ?? null, capex: capex[y] ?? null, fcf: fcfOf(y),
  }));
  const tRev = ttmSum(revR), tNi = ttmSum(niR), tOcf = ttmSum(ocfR), tCapex = ttmSum(capexR);
  const tFcf = tOcf != null && tCapex != null ? tOcf - tCapex : null;
  const px = await prices(ticker);
  const price = px.length ? last(px).c : null;
  const shares = await sharesOut(cik);
  const mcap = shares && price ? shares * price : null;
  const sales = tRev ?? rev[yrs[yrs.length - 1]];
  return {
    ticker, name: hit.title, series,
    ttm: { revenue: tRev, netIncome: tNi, ocf: tOcf, capex: tCapex, fcf: tFcf, netMargin: tRev && tNi != null ? tNi / tRev : null },
    price, priceHistory: px.map((p) => p.c), marketCap: mcap, equity: latestInstant(eqR),
    ps: mcap && sales > 0 ? mcap / sales : null,
    pe: mcap && tNi > 0 ? mcap / tNi : null,
    pcf: mcap && tOcf > 0 ? mcap / tOcf : null,
    pfcf: mcap && tFcf > 0 ? mcap / tFcf : null,
  };
}
async function prices(ticker) {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1mo`, { headers: { "User-Agent": "Mozilla/5.0" } });
    const r = (await res.json())?.chart?.result?.[0];
    const ts = r?.timestamp || [], cl = r?.indicators?.quote?.[0]?.close || [];
    return ts.map((t, i) => ({ t, c: cl[i] })).filter((x) => x.c != null);
  } catch { return []; }
}
async function sharesOut(cik) {
  const tryC = async (path, multi) => {
    let d; try { d = await getJSON(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${path}.json`, UA); } catch { return null; }
    const u = d.units?.shares || []; if (!u.length) return null;
    const maxEnd = u.reduce((a, x) => (x.end > a ? x.end : a), "");
    const vals = [...new Set(u.filter((x) => x.end === maxEnd).map((x) => x.val))];
    return (multi ? vals.reduce((s, v) => s + v, 0) : Math.max(...vals)) || null;
  };
  return (await tryC("dei/EntityCommonStockSharesOutstanding", true)) || (await tryC("us-gaap/CommonStockSharesOutstanding", true)) || (await tryC("us-gaap/WeightedAverageNumberOfDilutedSharesOutstanding", false)) || null;
}

// ── Markets (FRED) ───────────────────────────────────────────────────────────
export async function markets() {
  const [sp, ten, mort] = await Promise.all([fred("SP500"), fred("DGS10"), fred("MORTGAGE30US")]);
  return {
    sp500: last(sp).v, sp500Date: last(sp).d, sp500History: sp.slice(-30).map((x) => x.v),
    tenYear: last(ten).v, tenYearHistory: ten.slice(-30).map((x) => x.v),
    mortgage30: last(mort).v, mortgageDate: last(mort).d,
  };
}

// ── Watchlist screener (SEC + Yahoo) ─────────────────────────────────────────
const REV_TAGS = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"];
const OCF_TAGS = ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"];

export async function screen(tickers) {
  const map = await getJSON("https://www.sec.gov/files/company_tickers.json", UA);
  const one = async (tk) => {
    tk = tk.toUpperCase();
    const hit = Object.values(map).find((c) => c.ticker === tk);
    if (!hit) return { ticker: tk, error: "not found" };
    const cik = String(hit.cik_str).padStart(10, "0");
    const [revR, gpR, niR, ocfR] = await Promise.all([
      Promise.all(REV_TAGS.map((t) => edgar(cik, t))).then((a) => a.flat()),
      edgar(cik, "GrossProfit"), edgar(cik, "NetIncomeLoss"),
      Promise.all(OCF_TAGS.map((t) => edgar(cik, t))).then((a) => a.flat()),
    ]);
    const rev = annualMax(revR), gp = annual(gpR), ni = annual(niR), ocf = annual(ocfR);
    const yrs = Object.keys(rev).map(Number).sort();
    if (yrs.length < 2) return { ticker: tk, error: "insufficient" };
    const y0 = yrs[yrs.length - 2], y1 = yrs[yrs.length - 1];
    const gm0 = gp[y0] && rev[y0] ? gp[y0] / rev[y0] : null, gm1 = gp[y1] && rev[y1] ? gp[y1] / rev[y1] : null;
    const price = (await prices(tk)).at(-1)?.c ?? null;
    const shares = await sharesOut(cik);
    const mcap = shares && price ? shares * price : null;
    return {
      ticker: tk, year: y1,
      revGrowth: rev[y1] / rev[y0] - 1,
      grossMargin: gm1, marginChg: gm0 != null && gm1 != null ? gm1 - gm0 : null,
      netMargin: ni[y1] != null && rev[y1] ? ni[y1] / rev[y1] : null,
      ps: mcap && rev[y1] > 0 ? mcap / rev[y1] : null,
      pcf: mcap && ocf[y1] > 0 ? mcap / ocf[y1] : null,
    };
  };
  const out = [];
  for (let i = 0; i < tickers.length; i += 4) out.push(...(await Promise.all(tickers.slice(i, i + 4).map(one))));
  return out.filter((r) => !r.error).sort((a, b) => b.revGrowth - a.revGrowth);
}
