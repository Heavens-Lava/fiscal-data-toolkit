#!/usr/bin/env node
// weekly-digest.mjs — generate a ready-to-post social media data card (PNG +
// caption) from live government data. No API keys, no npm dependencies.
//
// Topics rotate week-to-week (5 in the rotation, so the cadence drifts across
// months rather than locking to a fixed week number):
//   jobs       — monthly payroll change + unemployment (jobs report lands 1st Friday)
//   inflation  — CPI year-over-year vs the 2% target (CPI lands mid-month)
//   debt       — national debt, Treasury "Debt to the Penny"
//   hires      — hires vs layoffs, JOLTS (lands end of month)
//   mortgage   — 30-yr fixed rate + what it does to the median-home payment, ~monthly
// Evergreen topics (any week, via --topic; included in --all):
//   tax-dollar               — federal spending by budget function, cents per $1 (USAspending.gov)
//   household-debt           — household + nonprofit debt vs. federal debt (Fed via FRED)
//   debt-holders             — who holds credit-card debt (Fed via FRED)
//   debt-holders-consumer    — who holds consumer (non-card) debt (Fed via FRED)
//   debt-holders-real-estate — who holds real-estate debt (Fed via FRED)
//   gas      — US average retail gasoline, weekly, last 5 years (EIA via FRED)
//   gas-az   — Phoenix metro average gas price, monthly, last 5 years (BLS via FRED)
//   banks    — US bank failures per year (FDIC failures database)
//   border   — CBP nationwide encounters per month (cbp.gov monthly CSV)
//   trade    — top US trading partners, goods balance (Census — needs CENSUS_API_KEY,
//              the one topic in this file that isn't fully keyless; see trade-balance.mjs
//              header for how to get a free key. Skips with instructions if unset.)
//
// Run:  node scripts/weekly-digest.mjs                 — this week's topic
//       node scripts/weekly-digest.mjs --topic gas     — a specific topic
//       node scripts/weekly-digest.mjs --all           — every topic
//       node scripts/weekly-digest.mjs --no-image      — skip PNG (HTML + caption only)
//       node scripts/weekly-digest.mjs --table         — also print a data table + write a .csv
//       node scripts/weekly-digest.mjs --topic gas --years 10   — override the chart's lookback
//                                                         window (default varies by topic).
//                                                         Applies to: jobs*, inflation, hires,
//                                                         debt, gas, gas-az, mortgage, banks,
//                                                         border. (*jobs ignores --years; its
//                                                         chart is always the trailing 12 months.)
//
// Output: social/<topic>-<date>.png (1200x675), .html, .csv, and the caption on stdout.
// PNG rendering uses headless Edge/Chrome already installed on the machine.
// Data: FRED keyless CSV (BLS series) + Treasury Fiscal Data API.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  fred, fiscal, MONTHS, mLabel, mShort, mYr, moneyT, money0, fmtM, signK, esc, last,
  monthlyResample, closest, oneYearBefore, monthlyPayment, parseUSDate, isoFromUSDate, niceTicks,
  C, PW, PH, GUT, PT, PB, plotW, plotH, frame, yAxisTitle, columnChart, lineChart,
  horizontalBarChart, legend, rpad, lpad, csvEscape, toCSV, printTable, cardHTML,
  findBrowser, screenshot,
} from "./lib/chart-kit.mjs";

const ROOT   = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTDIR = path.join(ROOT, "social");

function getCensusKey() {
  if (process.env.CENSUS_API_KEY) return process.env.CENSUS_API_KEY;
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^CENSUS_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

// Regional/bloc aggregates that ride along with real countries when CTY_CODE=*
// is queried (e.g. "European Union", "OPEC", "Total, All Countries") — filtered
// by name since Census's numeric code ranges for these aren't documented well
// enough to filter on reliably.
const AGGREGATE_NAME_RE =
  /\b(TOTAL|OPEC|EUROPEAN UNION|EURO AREA|ASEAN|CAFTA|NAFTA|USMCA|APEC|COUNTRY GROUPINGS?|UNIDENTIFIED|SPECIAL CATEGOR|N\.E\.S\.?|NOT SPECIFIED|OTHER (COUNTRIES|ASIA|AFRICA|EUROPE|AMERICA))\b/i;

function isAggregateCensusCode(code) {
  const s = String(code);
  return s === "-" || s.includes("X") || Number(s) < 1000;
}

async function censusCountryTotals(key, direction, time) {
  const valueField = direction === "exports" ? "ALL_VAL_MO" : "GEN_VAL_MO";
  const url = `https://api.census.gov/data/timeseries/intltrade/${direction}/hs` +
    `?get=CTY_NAME,CTY_CODE,${valueField}&time=${time}&CTY_CODE=*&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Census ${direction} HTTP ${res.status}`);
  const [header, ...data] = await res.json();
  const iName = header.indexOf("CTY_NAME"), iCode = header.indexOf("CTY_CODE"), iVal = header.indexOf(valueField);
  const out = new Map();
  for (const r of data) {
    if (isAggregateCensusCode(r[iCode]) || AGGREGATE_NAME_RE.test(r[iName])) continue;
    out.set(r[iCode], { name: r[iName], value: Number(r[iVal]) || 0 });
  }
  return out;
}

async function findLatestCensusMonth(key) {
  const d = new Date();
  for (let i = 0; i < 6; i++) {
    const time = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const url = `https://api.census.gov/data/timeseries/intltrade/exports/hs?get=CTY_NAME,ALL_VAL_MO&time=${time}&CTY_CODE=*&key=${key}`;
    const res = await fetch(url);
    if (res.ok) {
      const rows = await res.json().catch(() => null);
      if (Array.isArray(rows) && rows.length > 1) return time;
    }
    d.setMonth(d.getMonth() - 1);
  }
  throw new Error("Could not find a recent month with Census trade data");
}


async function censusTopExportCategory(key, time, code) {
  const url = `https://api.census.gov/data/timeseries/intltrade/exports/hs` +
    `?get=E_COMMODITY,E_COMMODITY_SDESC,ALL_VAL_MO&COMM_LVL=HS2&time=${time}&CTY_CODE=${code}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Census exports/commodity HTTP ${res.status}`);
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length <= 1) return null;
  const [header, ...data] = rows;
  const iCode = header.indexOf("E_COMMODITY"), iName = header.indexOf("E_COMMODITY_SDESC"), iVal = header.indexOf("ALL_VAL_MO");
  const top = data
    .map((r) => ({ code: r[iCode], name: cleanCommodityName(r[iCode], r[iName]), value: Number(r[iVal]) || 0 }))
    .sort((a, b) => b.value - a.value)[0];
  return top || null;
}


function shortCountryName(name) {
  const cleaned = String(name).replace(/,.*/, "");
  const aliases = {
    "UNITED KINGDOM": "UK",
    "KOREA, SOUTH": "S. KOREA",
    "NETHERLANDS": "NETHERLANDS",
    "SWITZERLAND": "SWITZERLAND",
  };
  return aliases[String(name)] || aliases[cleaned] || cleaned.slice(0, 12);
}
function cleanCommodityName(code, name) {
  const friendly = {
    "27": "Oil and refined fuels",
    "30": "Pharmaceuticals",
    "39": "Plastics",
    "71": "Precious metals and stones",
    "84": "Machinery and computers",
    "85": "Electronics and electrical equipment",
    "87": "Vehicles and parts",
    "88": "Aircraft and spacecraft",
    "90": "Medical and scientific instruments",
    "98": "Special classification goods",
  };
  if (friendly[String(code)]) return friendly[String(code)];
  return String(name)
    .replace(/;.*$/, "")
    .replace(/\bNESOI\b/g, "")
    .replace(/\bETC\.?\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
async function topTradingPartners(key, n = 8) {
  const time = await findLatestCensusMonth(key);
  const [exp, imp] = await Promise.all([
    censusCountryTotals(key, "exports", time),
    censusCountryTotals(key, "imports", time),
  ]);
  const codes = new Set([...exp.keys(), ...imp.keys()]);
  const rows = [...codes].map((code) => {
    const e = exp.get(code)?.value || 0, i = imp.get(code)?.value || 0;
    return { code, name: exp.get(code)?.name || imp.get(code)?.name, exports: e, imports: i, balance: e - i, total: e + i };
  });
  const sorted = rows.sort((a, b) => b.total - a.total);
  return { time, rows: sorted.slice(0, n), allRows: sorted };
}

const argv     = process.argv.slice(2);
const ALL      = argv.includes("--all");
const NO_IMAGE = argv.includes("--no-image");
const TABLE    = argv.includes("--table");
const T_IDX    = argv.indexOf("--topic");
const TOPIC    = T_IDX >= 0 ? argv[T_IDX + 1] : null;
const Y_IDX    = argv.indexOf("--years");
const YEARS    = Y_IDX >= 0 ? Math.max(1, Math.round(Number(argv[Y_IDX + 1]))) : null;
// Per-topic lookback window: explicit --years overrides, else each topic's own default.
const yrs = (fallback) => YEARS || fallback;


async function spendingByBudgetFunction(fy = "2025") {
  const res = await fetch("https://api.usaspending.gov/api/v2/spending/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "budget_function", filters: { fy: String(fy), quarter: "4" } }),
  });
  if (!res.ok) throw new Error(`USAspending ${res.status} for FY${fy}`);
  const rows = ((await res.json()).results || [])
    .map((r) => ({ name: r.name, amount: Number(r.amount) || 0 }))
    .filter((r) => r.name !== "Unreported Data" && r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  if (!rows.length) throw new Error(`no USAspending budget-function data for FY${fy}`);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return { fy, total, rows };
}
// ── topics ────────────────────────────────────────────────────────────────────

async function debtHolderTopic(mode) {
  const latestMeta = await (await fetch("https://api.fdic.gov/banks/financials?fields=REPDTE&sort_by=REPDTE&sort_order=DESC&limit=1&format=json")).json();
  const latest = latestMeta.data[0].data.REPDTE;
  const fields = ["NAME", "CERT", "REPDTE", "ASSET", "LNRE", "LNCON", "LNCRCD", "LNAUTO", "LNCONOTH"].join(",");
  const res = await fetch(`https://api.fdic.gov/banks/financials?filters=REPDTE:${latest}&fields=${fields}&limit=10000&format=json`);
  if (!res.ok) throw new Error(`FDIC financials HTTP ${res.status}`);
  const banks = (await res.json()).data.map((r) => r.data);
  const k = (r, field) => (Number(r[field]) || 0) * 1000;
  const sum = (field) => banks.reduce((s, r) => s + k(r, field), 0);
  const q = `${latest.slice(0, 4)}-Q${Math.ceil(Number(latest.slice(4, 6)) / 3)}`;
  const cleanBank = (name) => String(name)
    .replace(" NATIONAL ASSN", "")
    .replace(" BANK NA", "")
    .replace(" NATIONAL ASSOCIATION", "")
    .replace(" NATIONAL ASSN", "")
    .slice(0, 24);

  const totals = {
    creditCards: sum("LNCRCD"),
    auto: sum("LNAUTO"),
    other: sum("LNCONOTH"),
    consumer: sum("LNCON"),
    realEstate: sum("LNRE"),
  };
  const rows = banks.map((r) => ({
    name: r.NAME,
    creditCards: k(r, "LNCRCD"),
    auto: k(r, "LNAUTO"),
    other: k(r, "LNCONOTH"),
    consumer: k(r, "LNCON"),
    realEstate: k(r, "LNRE"),
  }));

  const configs = {
    "credit-card": {
      slug: "debt-holders",
      key: "creditCards",
      total: totals.creditCards,
      title: "Which banks hold the most credit-card debt?",
      heroLabel: (r) => `${cleanBank(r.name)} · ${q}`,
      captionNoun: "credit-card loans",
      tableColumns: ["Bank", "Credit Cards", "Auto Loans", "Other Consumer", "Share of Card Loans"],
      tableRow: (r) => [r.name, fmtM(r.creditCards), fmtM(r.auto), fmtM(r.other), `${(r.creditCards / totals.creditCards * 100).toFixed(1)}%`],
      caption: (leader, topFiveShare) => `Debt-holder check (${q}): FDIC-insured banks held ${fmtM(totals.creditCards)} in credit-card loans, ${fmtM(totals.auto)} in auto loans, and ${fmtM(totals.other)} in other consumer loans. The biggest credit-card holder was ${leader.name}, with ${fmtM(leader.creditCards)}. The top 5 banks held ${topFiveShare.toFixed(1)}% of all credit-card loans sitting on FDIC bank balance sheets.`,
    },
    consumer: {
      slug: "debt-holders-consumer",
      key: "consumer",
      total: totals.consumer,
      title: "Which banks hold the most consumer loans?",
      heroLabel: (r) => `${cleanBank(r.name)} · ${q}`,
      captionNoun: "consumer loans",
      tableColumns: ["Bank", "Consumer Loans", "Credit Cards", "Auto Loans", "Other Consumer"],
      tableRow: (r) => [r.name, fmtM(r.consumer), fmtM(r.creditCards), fmtM(r.auto), fmtM(r.other)],
      caption: (leader, topFiveShare) => `Consumer-loan holder check (${q}): FDIC-insured banks held ${fmtM(totals.consumer)} in consumer loans: ${fmtM(totals.creditCards)} credit cards, ${fmtM(totals.auto)} auto loans, and ${fmtM(totals.other)} other consumer loans. The biggest holder was ${leader.name}, with ${fmtM(leader.consumer)}. The top 5 banks held ${topFiveShare.toFixed(1)}% of consumer loans sitting on FDIC bank balance sheets.`,
    },
    "real-estate": {
      slug: "debt-holders-real-estate",
      key: "realEstate",
      total: totals.realEstate,
      title: "Which banks hold the most real-estate loans?",
      heroLabel: (r) => `${cleanBank(r.name)} · ${q}`,
      captionNoun: "real-estate loans",
      tableColumns: ["Bank", "Real-Estate Loans", "Consumer Loans", "Credit Cards", "Auto Loans"],
      tableRow: (r) => [r.name, fmtM(r.realEstate), fmtM(r.consumer), fmtM(r.creditCards), fmtM(r.auto)],
      caption: (leader, topFiveShare) => `Real-estate loan holder check (${q}): FDIC-insured banks held ${fmtM(totals.realEstate)} in real-estate loans. The biggest holder was ${leader.name}, with ${fmtM(leader.realEstate)}. The top 5 banks held ${topFiveShare.toFixed(1)}% of real-estate loans sitting on FDIC bank balance sheets. Important: this is not total US mortgage debt; many mortgages live in agency/MBS markets, credit unions, finance companies, and other nonbank holders.`,
    },
  };

  const cfg = configs[mode];
  const topRows = rows.filter((r) => r[cfg.key] > 0).sort((a, b) => b[cfg.key] - a[cfg.key]).slice(0, 10);
  const chartRows = topRows.slice(0, 8);
  const pts = chartRows.map((r, i) => ({ label: cleanBank(r.name), v: r[cfg.key] / 1e9, color: i < 5 ? C.s1 : C.s2 }));
  const leader = topRows[0];
  const topFiveShare = topRows.slice(0, 5).reduce((s, r) => s + r[cfg.key], 0) / cfg.total * 100;
  const caveat = "Important caveat: this is FDIC-insured banks only. It does not include credit unions, finance companies, securitized loan pools, GSE/MBS holders, or the federal student-loan portfolio. The bank that services or originated a loan may not be the bank/investor that owns it.";

  return {
    slug: cfg.slug, vintage: q, source: "FDIC BankFind financials",
    kicker: "Weekly data check · who holds the debt",
    title: cfg.title,
    hero: fmtM(leader[cfg.key]), heroLabel: cfg.heroLabel(leader),
    chartSVG: horizontalBarChart(pts, { fmtTick: (t) => `$${Math.round(t)}B`, fmtVal: (v) => `$${v.toFixed(0)}B` }),
    table: { columns: cfg.tableColumns, rows: topRows.map(cfg.tableRow) },
    caption:
`${cfg.caption(leader, topFiveShare)}

${caveat}

Real numbers, real source — FDIC BankFind financials, ${q}:
https://banks.data.fdic.gov/docs/`,
  };
}
const TOPICS = {
  async jobs() {
    const [payems, unrate] = await Promise.all([fred("PAYEMS"), fred("UNRATE")]);
    const tail = payems.slice(-13);
    const pts  = tail.slice(1).map((x, i) => ({ label: mShort(x.d), v: x.v - tail[i].v }));
    const latest = pts[pts.length - 1], vintage = mLabel(tail[tail.length - 1].d);
    const u = unrate[unrate.length - 1].v.toFixed(1);
    const gains = pts.filter((p) => p.v > 0).length;
    const avg   = Math.round(pts.reduce((s, p) => s + p.v, 0) / pts.length);
    return {
      slug: "jobs", vintage, source: "BLS payrolls via FRED",
      kicker: "Weekly data check · the jobs picture",
      title: "How many jobs did the US add or lose each month?",
      hero: signK(latest.v), heroLabel: `${vintage} · unemployment ${u}%`,
      chartSVG: columnChart(pts, { fmtTick: (t) => (t === 0 ? "0" : signK(t)), fmtVal: signK, yLabel: "Monthly Payroll Change" }),
      table: {
        columns: ["Month", "Payroll Change", "Total Nonfarm Payrolls (K)"],
        rows: tail.slice(1).map((x, i) => [
          mLabel(x.d), signK(x.v - tail[i].v), Math.round(x.v).toLocaleString("en-US"),
        ]),
      },
      caption:
`Jobs check (${vintage}): the US ${latest.v >= 0 ? "added" : "lost"} ${Math.abs(Math.round(latest.v))},000 jobs last month. Unemployment: ${u}%. Over the last 12 months: ${gains} months of gains, ${12 - gains} of losses, averaging ${signK(avg)}/month.

Real numbers, real source — BLS via FRED, data through ${vintage}:
https://fred.stlouisfed.org/series/PAYEMS`,
    };
  },

  async inflation() {
    const cpi = await fred("CPIAUCSL");
    // Pair each month with the same month a year earlier BY DATE, not by array
    // index — FRED can have gaps (e.g. the Oct 2025 shutdown skipped a CPI print).
    const prev12 = (iso) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4, 7)}`;
    const byMonth = new Map(cpi.map((x) => [x.d.slice(0, 7), x.v]));
    const yoy = cpi
      .filter((x) => byMonth.has(prev12(x.d.slice(0, 7))))
      .map((x) => ({ d: x.d, v: (x.v / byMonth.get(prev12(x.d.slice(0, 7))) - 1) * 100 }));
    const n = yrs(2) * 12;
    const tail = yoy.slice(-n);
    const pts  = tail.map((x) => ({ label: mShort(x.d), v: x.v }));
    const latest = tail[tail.length - 1], vintage = mLabel(latest.d);
    const peak = tail.reduce((a, b) => (b.v > a.v ? b : a));
    const step = Math.max(4, Math.round(tail.length / 8));
    return {
      slug: "inflation", vintage, source: "BLS CPI via FRED",
      kicker: "Weekly data check · prices",
      title: "How fast are prices rising? (CPI, year over year)",
      hero: `${latest.v.toFixed(1)}%`, heroLabel: `12-month inflation · ${vintage}`,
      chartSVG: lineChart(
        [{ color: C.s1, points: pts, endLabel: (v) => v }],
        { fmtTick: (t) => `${t}%`, fmtVal: (v) => `${v.toFixed(1)}%`,
          refLine: { v: 2, label: "2% Fed target" }, labelStep: step, yLabel: "Year-over-Year Inflation (%)" }),
      table: {
        columns: ["Month", "CPI Index", "YoY Inflation"],
        rows: tail.map((x) => [
          mLabel(x.d), byMonth.get(x.d.slice(0, 7)).toFixed(2), `${x.v.toFixed(1)}%`,
        ]),
      },
      caption:
`Inflation check: prices rose ${latest.v.toFixed(1)}% over the past 12 months (CPI, ${vintage}). The Fed's target is 2%. Highest reading in this ${tail.length}-month window: ${peak.v.toFixed(1)}% in ${mLabel(peak.d)}.

Real numbers, real source — BLS CPI via FRED, data through ${vintage}:
https://fred.stlouisfed.org/series/CPIAUCSL`,
    };
  },

  async hires() {
    const [hil, ldl] = await Promise.all([fred("JTSHIL"), fred("JTSLDL")]);
    const n = yrs(2) * 12;
    const hilTail = hil.slice(-n), ldlTail = ldl.slice(-n);
    const mk = (tail) => tail.map((x) => ({ label: mShort(x.d), v: x.v / 1000 }));
    const H = mk(hilTail), L = mk(ldlTail);
    const vintage = mLabel(hil[hil.length - 1].d);
    const hLast = H[H.length - 1].v, lLast = L[L.length - 1].v;
    const step = Math.max(4, Math.round(H.length / 8));
    return {
      slug: "hires", vintage, source: "BLS JOLTS via FRED",
      kicker: "Weekly data check · layoff headlines vs. data",
      title: "Every month, US employers hire far more people than they lay off",
      hero: `${(hLast / lLast).toFixed(1)}×`, heroLabel: `hires per layoff · ${vintage}`,
      legendHTML: legend([{ name: "Hires", color: C.s1 }, { name: "Layoffs & discharges", color: C.s2 }]),
      chartSVG: lineChart(
        [{ color: C.s1, points: H, endLabel: (v) => `Hires ${v}` },
         { color: C.s2, points: L, endLabel: (v) => `Layoffs ${v}` }],
        { fmtTick: (t) => `${t}M`, fmtVal: (v) => `${v.toFixed(1)}M`, labelStep: step, yLabel: "Millions per Month" }),
      table: {
        columns: ["Month", "Hires (M)", "Layoffs & Discharges (M)", "Hires per Layoff"],
        rows: H.map((h, i) => [
          mLabel(hilTail[i].d), h.v.toFixed(1), L[i].v.toFixed(1), (h.v / L[i].v).toFixed(1) + "×",
        ]),
      },
      caption:
`Seeing scary layoff headlines? Here's the actual data (${vintage}): employers hired ${hLast.toFixed(1)} million people and laid off ${lLast.toFixed(1)} million — about ${(hLast / lLast).toFixed(1)} hires for every layoff. The layoff rate remains near historic lows.

Real numbers, real source — BLS JOLTS via FRED, data through ${vintage}:
https://fred.stlouisfed.org/series/JTSHIL`,
    };
  },

  async debt() {
    const n = yrs(1) * 12 + 1;
    const days = yrs(1) * 370 + 40;
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const rows = (await fiscal(
      `/v2/accounting/od/debt_to_penny?filter=record_date:gte:${since}&sort=record_date&page[size]=${Math.min(10000, days + 50)}`
    )).data;
    const byMonth = new Map();
    for (const r of rows) byMonth.set(r.record_date.slice(0, 7), r); // last record wins
    const monthly = [...byMonth.values()].slice(-n)
      .map((r) => ({ d: r.record_date, v: Number(r.tot_pub_debt_out_amt) }));
    const pts = monthly.map((x) => ({ label: mShort(x.d), v: x.v / 1e12 }));
    const latest = monthly[monthly.length - 1];
    const delta = latest.v - monthly[0].v;
    const vintage = latest.d;
    const step = Math.max(2, Math.round(pts.length / 8));
    return {
      slug: "debt", vintage, source: "US Treasury, Debt to the Penny",
      kicker: "Weekly data check · the national debt",
      title: "What does the US government owe right now?",
      hero: moneyT(latest.v), heroLabel: `total public debt · ${vintage}`,
      chartSVG: lineChart(
        [{ color: C.s1, points: pts, endLabel: (v) => v }],
        { fmtTick: (t) => `$${t}T`, fmtVal: (v) => `$${v.toFixed(2)}T`, labelStep: step, yLabel: "Total Public Debt ($ Trillions)" }),
      table: {
        columns: ["Month", "Total Public Debt"],
        rows: monthly.map((x) => [mLabel(x.d), `$${Math.round(x.v).toLocaleString("en-US")}`]),
      },
      caption:
`National debt check: ${moneyT(latest.v)} as of ${vintage} — up ${moneyT(delta)} over the past ${monthly.length - 1} months. (Note: the y-axis starts near the recent range, not zero, to make the trend visible.)

Real numbers, real source — US Treasury "Debt to the Penny":
https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/`,
    };
  },



  async "debt-holders"() {
    return debtHolderTopic("credit-card");
  },

  async "debt-holders-consumer"() {
    return debtHolderTopic("consumer");
  },

  async "debt-holders-real-estate"() {
    return debtHolderTopic("real-estate");
  },
  async "household-debt"() {
    const [totalDebt, mortgages, consumer, debtService, fedDebtRows] = await Promise.all([
      fred("CMDEBT"),       // household + nonprofit credit-market instruments, $ millions
      fred("HHMSDODNS"),    // home mortgages, $ millions
      fred("HCCSDODNS"),    // consumer credit, $ millions
      fred("TDSP"),         // household debt service payments / disposable personal income
      fiscal("/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1"),
    ]);
    const latest = last(totalDebt);
    const mortgage = closest(mortgages, latest.d);
    const consumerCredit = closest(consumer, latest.d);
    const service = closest(debtService, latest.d);
    const total = latest.v * 1e6;
    const mortgageAmt = mortgage.v * 1e6;
    const consumerAmt = consumerCredit.v * 1e6;
    const otherAmt = Math.max(total - mortgageAmt - consumerAmt, 0);
    const federalDebt = Number(fedDebtRows.data[0].tot_pub_debt_out_amt);
    const components = [
      { label: "Home mortgages", amount: mortgageAmt },
      { label: "Consumer credit", amount: consumerAmt },
      { label: "Nonprofits + other", amount: otherAmt },
    ];
    const pts = components.map((r, i) => ({ label: r.label, v: r.amount / 1e12, color: i === 0 ? C.s1 : i === 1 ? C.s2 : C.baseline }));
    const vintage = `Q${Math.floor(Number(latest.d.slice(5, 7)) / 3) + 1} ${latest.d.slice(0, 4)}`;
    return {
      slug: "household-debt", vintage, source: "Federal Reserve Financial Accounts via FRED; Treasury FiscalData",
      kicker: "Weekly data check · household debt",
      title: "Household debt is separate from the national debt",
      hero: moneyT(total), heroLabel: `household + nonprofit debt · ${vintage}`,
      chartSVG: horizontalBarChart(pts, { fmtTick: (t) => `$${t.toFixed(0)}T`, fmtVal: (v) => `$${v.toFixed(1)}T` }),
      table: {
        columns: ["Debt Type", "Amount", "Share of Total"],
        rows: components.map((r) => [r.label, moneyT(r.amount), `${(r.amount / total * 100).toFixed(1)}%`]),
      },
      caption:
`Household debt check (${vintage}): households and nonprofits together owed about ${moneyT(total)} in credit-market debt. That is separate from the federal government's ${moneyT(federalDebt)} total public debt. Households alone carry mortgages (${moneyT(mortgageAmt)}) plus consumer credit like auto loans, student loans, and credit cards (${moneyT(consumerAmt)}) — ${moneyT(mortgageAmt + consumerAmt)} combined. The remaining ${moneyT(otherAmt)} is mostly nonprofit-sector debt (hospitals, universities, etc.), plus smaller household liabilities not captured above. Debt-service payments were ${service.v.toFixed(1)}% of disposable personal income.

Source note: this uses Federal Reserve Financial Accounts series mirrored on FRED, so it is not the same dataset as the NY Fed Consumer Credit Panel, but it updates cleanly with no API key.

Real numbers, real source — Federal Reserve via FRED and US Treasury FiscalData:
https://fred.stlouisfed.org/series/CMDEBT`,
    };
  },
  async "tax-dollar"() {
    const { fy, total, rows } = await spendingByBudgetFunction("2025");
    const top = rows.slice(0, 8);
    const other = rows.slice(8).reduce((s, r) => s + r.amount, 0);
    const display = [...top, { name: "Everything else", amount: other }];
    const cents = (amount) => amount / total * 100;
    const pts = display.map((r, i) => ({
      label: r.name === "Education, Training, Employment, and Social Services" ? "Education & jobs" : r.name,
      v: cents(r.amount),
      color: i < 4 ? C.s1 : i === display.length - 1 ? C.baseline : C.s2,
    }));
    const medicare = rows.find((r) => r.name === "Medicare");
    const socialSecurity = rows.find((r) => r.name === "Social Security");
    const defense = rows.find((r) => r.name === "National Defense");
    const interest = rows.find((r) => r.name === "Net Interest");
    const topFour = [medicare, socialSecurity, defense, interest].filter(Boolean);
    const topFourCents = topFour.reduce((s, r) => s + cents(r.amount), 0);
    const foreign = rows.find((r) => r.name === "International Affairs");
    return {
      slug: "tax-dollar", vintage: `FY${fy}`, source: "USAspending.gov budget function totals",
      kicker: "Weekly data check · federal spending",
      title: "Out of every federal spending dollar, where does the money go?",
      hero: `${Math.round(topFourCents)}¢`, heroLabel: "Medicare + Social Security + defense + interest",
      chartSVG: horizontalBarChart(pts, { fmtTick: (t) => `${Math.round(t)}¢`, fmtVal: (v) => `${v.toFixed(1)}¢` }),
      table: {
        columns: ["Category", "Amount", "Cents per $1"],
        rows: display.map((r) => [r.name, fmtM(r.amount), `${cents(r.amount).toFixed(1)}¢`]),
      },
      caption:
`Tax-dollar check (FY${fy}): out of every federal spending dollar, Medicare is ${cents(medicare.amount).toFixed(1)}¢, Social Security is ${cents(socialSecurity.amount).toFixed(1)}¢, national defense is ${cents(defense.amount).toFixed(1)}¢, and net interest is ${cents(interest.amount).toFixed(1)}¢. Together, those four are about ${Math.round(topFourCents)}¢ of every $1. International affairs is ${cents(foreign.amount).toFixed(1)}¢.

Source note: USAspending budget-function totals are useful for showing the mix of spending by category. They are gross budget-function totals, so use them for shares/ranking rather than exact Treasury net outlay totals.

Real numbers, real source — USAspending.gov budget function data, FY${fy}:
https://www.usaspending.gov/explorer/budget_function`,
    };
  },
  async gas() {
    const gas = await fred("GASREGW");
    const y = yrs(5);
    const tail = gas.slice(-y * 52);
    const pts = tail.map((x) => ({ label: mYr(x.d), v: x.v }));
    const latest = last(gas);
    const yearAgo = closest(gas, oneYearBefore(latest.d));
    const change = latest.v - yearAgo.v;
    const peak = tail.reduce((a, b) => (b.v > a.v ? b : a));
    const vintage = latest.d;
    return {
      slug: "gas", vintage, source: "EIA weekly gasoline survey via FRED",
      kicker: "Weekly data check · gas prices",
      title: `US average price for regular gas, last ${y} years`,
      hero: `$${latest.v.toFixed(2)}`, heroLabel: `per gallon · week of ${vintage}`,
      chartSVG: lineChart(
        [{ color: C.s1, points: pts, endLabel: (v) => v }],
        { fmtTick: (t) => `$${t.toFixed(2)}`, fmtVal: (v) => `$${v.toFixed(2)}`, labelStep: 52 * Math.max(1, Math.ceil(y / 8)), yLabel: "Price per Gallon ($)" }),
      table: {
        columns: ["Week Of", "Price/Gallon"],
        rows: tail.map((x) => [x.d, `$${x.v.toFixed(2)}`]),
      },
      caption:
`Gas price check: regular gas averaged $${latest.v.toFixed(2)}/gal for the week of ${vintage}. That is ${change >= 0 ? "up" : "down"} $${Math.abs(change).toFixed(2)} from roughly a year earlier (${yearAgo.d}). The ${y}-year high was $${peak.v.toFixed(2)} in the week of ${peak.d}.

Real numbers, real source — EIA weekly gasoline survey via FRED, data through ${vintage}:
https://fred.stlouisfed.org/series/GASREGW`,
    };
  },

  async "gas-az"() {
    // No true statewide weekly Arizona series exists. EIA's weekly regional
    // data only goes down to PADD 5 (West Coast: AZ+CA+NV+OR+WA+AK+HI) — not
    // AZ alone. The genuinely Arizona-specific series is BLS's monthly average
    // price for the Phoenix-Mesa-Scottsdale metro area (most of the state's
    // population), via FRED, keyless — so this card is monthly, not weekly.
    const az = await fred("APUS48A74714");
    const y = yrs(5);
    const tail = az.slice(-y * 12);
    const pts = tail.map((x) => ({ label: mYr(x.d), v: x.v }));
    const latest = last(az);
    const yearAgo = closest(az, oneYearBefore(latest.d));
    const change = latest.v - yearAgo.v;
    const peak = tail.reduce((a, b) => (b.v > a.v ? b : a));
    const vintage = mLabel(latest.d);
    return {
      slug: "gas-az", vintage, source: "BLS average price, Phoenix-Mesa-Scottsdale, via FRED",
      kicker: "Weekly data check · Arizona gas prices",
      title: `Average regular gas price — Phoenix metro, last ${y} years`,
      hero: `$${latest.v.toFixed(2)}`, heroLabel: `per gallon · Phoenix metro · ${vintage}`,
      chartSVG: lineChart(
        [{ color: C.s1, points: pts, endLabel: (v) => v }],
        { fmtTick: (t) => `$${t.toFixed(2)}`, fmtVal: (v) => `$${v.toFixed(2)}`, labelStep: 12 * Math.max(1, Math.ceil(y / 8)), yLabel: "Price per Gallon ($)" }),
      table: {
        columns: ["Month", "Price/Gallon"],
        rows: tail.map((x) => [mLabel(x.d), `$${x.v.toFixed(2)}`]),
      },
      caption:
`Arizona gas check (Phoenix metro, ${vintage}): regular unleaded averaged $${latest.v.toFixed(2)}/gal. That is ${change >= 0 ? "up" : "down"} $${Math.abs(change).toFixed(2)} from roughly a year earlier. The ${y}-year high was $${peak.v.toFixed(2)} in ${mLabel(peak.d)}.

Note: there's no official statewide weekly Arizona gas price — this is BLS's monthly average for the Phoenix-Mesa-Scottsdale metro area, where most Arizonans live. EIA's weekly regional figure only goes down to the West Coast (PADD 5), which blends AZ with CA/NV/OR/WA/AK/HI.

Real numbers, real source — BLS average price data via FRED, data through ${vintage}:
https://fred.stlouisfed.org/series/APUS48A74714`,
    };
  },

  async border() {
    // CBP publishes monthly-updated CSVs; scrape the stats page for the newest
    // "-aor.csv" link (listed newest first) so the URL never goes stale.
    const UA = { headers: { "User-Agent": "Mozilla/5.0 (fiscal-data-toolkit)" } };
    const pageRes = await fetch("https://www.cbp.gov/document/stats/nationwide-encounters", UA);
    if (!pageRes.ok) throw new Error(`CBP page HTTP ${pageRes.status}`);
    const m = (await pageRes.text()).match(/href="([^"]*nationwide-encounters[^"]*-aor\.csv)"/);
    if (!m) throw new Error("Could not find CBP encounters CSV link");
    const csvRes = await fetch(new URL(m[1], "https://www.cbp.gov").href, UA);
    if (!csvRes.ok) throw new Error(`CBP CSV HTTP ${csvRes.status}`);
    const csv = await csvRes.text();

    // Columns: Fiscal Year, Month Grouping, Month (abbv), ... , Encounter Count.
    // FY runs Oct-Sep, so OCT-DEC belong to the prior CALENDAR year. Citizenship
    // values can contain quoted commas, so take col 0/2 from the front and the
    // count from after the last comma.
    const CAL = { OCT: 10, NOV: 11, DEC: 12, JAN: 1, FEB: 2, MAR: 3, APR: 4,
                  MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9 };
    const totals = new Map();
    for (const line of csv.split("\n").slice(1)) {
      const c = line.split(",");
      if (c.length < 4) continue;
      const fy = Number(String(c[0]).slice(0, 4)), mon = CAL[c[2]];
      const count = Number(line.slice(line.lastIndexOf(",") + 1));
      if (!fy || !mon || !Number.isFinite(count)) continue;
      const key = `${mon >= 10 ? fy - 1 : fy}-${String(mon).padStart(2, "0")}`;
      totals.set(key, (totals.get(key) || 0) + count);
    }
    const monthly = [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ d: `${k}-01`, raw: v, v: v / 1000 }));
    const n = yrs(2) * 12;
    const tail = monthly.slice(-n);
    const pts = tail.map((x) => ({ label: mYr(x.d), v: x.v }));
    const latest = last(tail), peak = tail.reduce((a, b) => (b.v > a.v ? b : a));
    const vintage = mLabel(latest.d);
    const step = Math.max(4, Math.round(tail.length / 8));
    return {
      slug: "border", vintage, source: "US Customs & Border Protection",
      kicker: "Weekly data check · the border",
      title: "How many encounters does CBP record nationwide each month?",
      hero: `${Math.round(latest.v)}K`, heroLabel: `encounters · ${vintage}`,
      chartSVG: lineChart(
        [{ color: C.s1, points: pts, endLabel: (v) => v }],
        { fmtTick: (t) => `${t}K`, fmtVal: (v) => `${Math.round(v)}K`, labelStep: step, yLabel: "Nationwide Encounters (thousands)" }),
      table: {
        columns: ["Month", "Nationwide Encounters"],
        rows: tail.map((x) => [mLabel(x.d), x.raw.toLocaleString("en-US")]),
      },
      caption:
`Border check (${vintage}): CBP recorded ${Math.round(latest.v * 1000).toLocaleString("en-US")} nationwide encounters last month — all borders and ports of entry, Border Patrol plus Field Operations. Peak in this ${tail.length}-month window: ${Math.round(peak.v * 1000).toLocaleString("en-US")} in ${mLabel(peak.d)}.

Real numbers, real source — CBP nationwide encounters data:
https://www.cbp.gov/document/stats/nationwide-encounters`,
    };
  },

  async mortgage() {
    const [mort30, medPrice] = await Promise.all([fred("MORTGAGE30US"), fred("MSPUS")]);
    const y = yrs(5);
    const tail = monthlyResample(mort30).slice(-y * 12);
    const pts = tail.map((x) => ({ label: mYr(x.d), v: x.v }));
    const rate = last(mort30);
    const price = last(medPrice);
    const principal = price.v * 0.8;
    const pmt = monthlyPayment(principal, rate.v);
    const rate2021 = mort30.reduce((best, pt) => pt.d.startsWith("2021") && pt.v < best.v ? pt : best, { v: Infinity });
    const pmt2021 = monthlyPayment(principal, rate2021.v);
    const diff = pmt - pmt2021;
    const vintage = rate.d;
    return {
      slug: "mortgage", vintage, source: "Freddie Mac and Census via FRED",
      kicker: "Weekly data check · housing affordability",
      title: `30-year mortgage rate, last ${y} years — and today's payment`,
      hero: money0(pmt), heroLabel: `monthly P&I on 20% down · ${rate.v.toFixed(2)}% rate`,
      chartSVG: lineChart(
        [{ color: C.s1, points: pts, endLabel: (v) => v }],
        { fmtTick: (t) => `${t.toFixed(2)}%`, fmtVal: (v) => `${v.toFixed(2)}%`, labelStep: 12 * Math.max(1, Math.ceil(y / 8)), yLabel: "30-Year Fixed Rate (%)" }),
      table: {
        columns: ["Month", "30-Yr Fixed Rate", "Est. Monthly P&I*"],
        rows: tail.map((x) => [mLabel(x.d), `${x.v.toFixed(2)}%`, money0(monthlyPayment(principal, x.v))]),
      },
      caption:
`Mortgage check (${vintage}): the 30-year fixed rate was ${rate.v.toFixed(2)}%. On the latest median new-home price (${money0(price.v)}, ${mLabel(price.d)}) with 20% down, principal and interest is about ${money0(pmt)}/month. At the 2021 low rate (${rate2021.v.toFixed(2)}%), the same loan would be about ${money0(pmt2021)}/month - a ${money0(Math.abs(diff))}/month difference.

Real numbers, real source - Freddie Mac mortgage rates and Census median new-home price via FRED:
https://fred.stlouisfed.org/series/MORTGAGE30US`,
    };
  },

  async banks() {
    const res = await fetch("https://api.fdic.gov/banks/failures?fields=NAME,CITYST,FAILDATE,CERT&sort_by=FAILDATE&sort_order=DESC&limit=10000&format=json");
    if (!res.ok) throw new Error(`FDIC ${res.status} for bank failures`);
    const rows = (await res.json()).data.map((r) => r.data);
    const thisYear = new Date().getUTCFullYear();
    const span = yrs(15);
    const years = Array.from({ length: span }, (_, i) => thisYear - (span - 1) + i);
    const counts = new Map(years.map((y) => [y, 0]));
    for (const r of rows) {
      const y = parseUSDate(r.FAILDATE).getUTCFullYear();
      if (counts.has(y)) counts.set(y, counts.get(y) + 1);
    }
    const pts = years.map((y) => ({ label: String(y).slice(2), v: counts.get(y) }));
    const latest = rows[0];
    const latestDate = isoFromUSDate(latest.FAILDATE);
    const currentCount = counts.get(thisYear);
    return {
      slug: "banks", vintage: latestDate, source: "FDIC failed bank list",
      kicker: "Weekly data check · bank failures",
      title: "How many FDIC-insured banks have failed this year?",
      hero: String(currentCount), heroLabel: `bank failures in ${thisYear}`,
      chartSVG: columnChart(pts, { fmtTick: (t) => String(Math.round(t)), fmtVal: (v) => String(Math.round(v)), yLabel: "Bank Failures (count)" }),
      table: {
        columns: ["Year", "Bank Failures"],
        rows: years.map((y) => [String(y), String(counts.get(y))]),
      },
      caption:
`Bank failure check: ${currentCount} FDIC-insured bank${currentCount === 1 ? " has" : "s have"} failed so far in ${thisYear}. Most years are quiet; the chart shows annual failures over the last ${span} years. Most recent failure: ${latest.NAME} (${latest.CITYST}) on ${latestDate}.

Real numbers, real source - FDIC failed bank list:
https://banks.data.fdic.gov/explore/failures`,
    };
  },

  async trade() {
    const key = getCensusKey();
    if (!key) throw new Error(
      "needs a free Census API key — sign up at https://api.census.gov/data/key_signup.html, " +
      "then set CENSUS_API_KEY as an environment variable or add it to a .env file in the repo root"
    );
    const { time, allRows } = await topTradingPartners(key, 8);
    const vintage = mLabel(`${time}-01`);
    const deficits = allRows.filter((r) => r.balance < 0).sort((a, b) => a.balance - b.balance).slice(0, 4);
    const surpluses = allRows.filter((r) => r.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 4);
    const rows = [...deficits, ...surpluses];
    const exportCats = new Map(await Promise.all(rows.map(async (r) => {
      const top = await censusTopExportCategory(key, time, r.code);
      return [r.code, top];
    })));
    const pts = rows.map((r) => ({ label: shortCountryName(r.name), v: r.balance / 1e9 }));
    const biggestDeficit = deficits[0];
    const biggestSurplus = surpluses[0];
    const exportText = `Top US export to ${biggestDeficit.name}: ${exportCats.get(biggestDeficit.code)?.name || "n/a"}`;
    return {
      slug: "trade", vintage, source: "US Census Bureau, international trade in goods",
      kicker: "Weekly data check · trading partners",
      title: "Where the US runs goods deficits and surpluses",
      hero: fmtM(biggestDeficit.balance), heroLabel: `deficit with ${biggestDeficit.name} · ${vintage}`,
      chartSVG: columnChart(pts, { fmtTick: (t) => `$${Math.round(t)}B`, fmtVal: (v) => `$${v.toFixed(1)}B`, labelIndex: 0, yLabel: "Trade Balance ($ Billions)" }),
      table: {
        columns: ["Country", "Exports", "Imports", "Balance", "Top US Export"],
        rows: rows.map((r) => [r.name, fmtM(r.exports), fmtM(r.imports), fmtM(r.balance), exportCats.get(r.code)?.name || "n/a"]),
      },
      caption:
`Trade check (goods only, ${vintage}): the biggest goods deficit in this snapshot is with ${biggestDeficit.name} (${fmtM(biggestDeficit.balance)}), while the biggest goods surplus is with ${biggestSurplus.name} (${fmtM(biggestSurplus.balance)}). ${exportText}. Note: goods only — Census doesn't publish services trade by country, so the full (goods+services) picture with any one partner can look different.

Real numbers, real source — US Census Bureau international trade data:
https://www.census.gov/foreign-trade/data/`,
    };
  },
};

// ── main ─────────────────────────────────────────────────────────────────────
const ROTATION = ["jobs", "inflation", "debt", "hires", "mortgage"];
const EVERGREEN = ["tax-dollar", "household-debt", "debt-holders", "debt-holders-consumer", "debt-holders-real-estate", "gas", "gas-az", "banks", "border", "trade"];

(async () => {
  const week = Math.floor((new Date().getDate() - 1) / 7) % ROTATION.length;
  const picks = ALL ? [...ROTATION, ...EVERGREEN]
    : TOPIC ? [TOPIC]
    : [ROTATION[week]];

  mkdirSync(OUTDIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);

  for (const name of picks) {
    if (!TOPICS[name]) {
      console.error(`Unknown topic "${name}". Topics: ${Object.keys(TOPICS).join(", ")}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`\n  Building "${name}" digest (live data)...`);
    let t;
    try {
      t = await TOPICS[name]();
    } catch (err) {
      console.log(`  ! Skipping "${name}": ${err.message}`);
      process.exitCode = 1;
      continue;
    }
    const html = cardHTML(t);
    const base = path.join(OUTDIR, `${t.slug}-${stamp}`);
    writeFileSync(`${base}.html`, html);
    writeFileSync(`${base}.txt`, t.caption + "\n");
    if (t.table) writeFileSync(`${base}.csv`, toCSV(t.table.columns, t.table.rows));
    if (!NO_IMAGE) screenshot(`${base}.html`, `${base}.png`);

    console.log(`\n  ── CAPTION (copy/paste) ─────────────────────────────────────────────`);
    console.log(t.caption.split("\n").map((l) => "  " + l).join("\n"));
    if (TABLE && t.table) printTable(t.title, t.table.columns, t.table.rows, t.source, !!YEARS);

    const files = [!NO_IMAGE && "png", "html", "txt", t.table && "csv"].filter(Boolean);
    console.log(`\n  Files: ${files.map((ext) => `${t.slug}-${stamp}.${ext}`).join(" / ")}`);
  }
})();
