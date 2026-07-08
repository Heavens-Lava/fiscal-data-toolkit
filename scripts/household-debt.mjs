#!/usr/bin/env node
// household-debt.mjs — U.S. household/nonprofit debt snapshot from FRED,
// contrasted with federal public debt from Treasury FiscalData. No API keys.
//
// Run:  node scripts/household-debt.mjs
// Data: Federal Reserve Financial Accounts via FRED + Treasury FiscalData.
// Note: this is not the NY Fed Consumer Credit Panel; it is the Fed Z.1/FRED
// credit-market debt measure, which updates cleanly without a key.

async function fred(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!res.ok) throw new Error(`FRED ${res.status} for ${id}`);
  return (await res.text())
    .trim().split("\n").slice(1)
    .map((l) => { const [d, v] = l.split(","); return { d, raw: v, v: Number(v) }; })
    .filter((x) => x.raw !== "" && x.raw !== "." && Number.isFinite(x.v));
}

async function fiscal(path) {
  const base = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`FiscalData ${res.status}`);
  return res.json();
}

const last = (a) => a[a.length - 1];
const money = (n) => {
  const s = n < 0 ? "-" : "", a = Math.abs(n);
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  return `${s}$${Math.round(a).toLocaleString("en-US")}`;
};
function closest(series, targetDate) {
  const target = Date.parse(targetDate);
  return series.reduce((best, pt) =>
    Math.abs(Date.parse(pt.d) - target) < Math.abs(Date.parse(best.d) - target) ? pt : best
  );
}

(async () => {
  try {
    const [totalDebt, mortgages, consumer, debtService, fedDebtRows] = await Promise.all([
      fred("CMDEBT"),
      fred("HHMSDODNS"),
      fred("HCCSDODNS"),
      fred("TDSP"),
      fiscal("/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1"),
    ]);

    const latest = last(totalDebt);
    const total = latest.v * 1e6;
    const mortgage = closest(mortgages, latest.d).v * 1e6;
    const consumerCredit = closest(consumer, latest.d).v * 1e6;
    const other = Math.max(total - mortgage - consumerCredit, 0);
    const service = closest(debtService, latest.d).v;
    const federalDebt = Number(fedDebtRows.data[0].tot_pub_debt_out_amt);
    const federalDate = fedDebtRows.data[0].record_date;

    console.log("\n  U.S. HOUSEHOLD DEBT SNAPSHOT");
    console.log("  (source: Federal Reserve via FRED + Treasury FiscalData, no key)\n");
    console.log(`  Household/nonprofit debt ..... ${money(total)}   (as of ${latest.d})`);
    console.log(`  Federal public debt .......... ${money(federalDebt)}   (as of ${federalDate})`);
    console.log("\n  Household debt breakdown:");
    console.log(`    Home mortgages ............. ${money(mortgage)}   (${(mortgage / total * 100).toFixed(1)}%)`);
    console.log(`    Consumer credit ............ ${money(consumerCredit)}   (${(consumerCredit / total * 100).toFixed(1)}%)`);
    console.log(`    Other household debt ....... ${money(other)}   (${(other / total * 100).toFixed(1)}%)`);
    console.log(`\n  Debt-service payments ........ ${service.toFixed(1)}% of disposable personal income`);
    console.log("\n  Note: this is separate from the national debt. It is also not the NY Fed");
    console.log("  Consumer Credit Panel series; it is the Fed Z.1/FRED credit-market debt measure.\n");
  } catch (err) {
    console.error("Failed to fetch household debt data:", err.message);
    process.exit(1);
  }
})();
