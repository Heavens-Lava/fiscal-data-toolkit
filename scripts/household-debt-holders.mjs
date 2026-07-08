#!/usr/bin/env node
// household-debt-holders.mjs — which FDIC-insured banks hold the most household-adjacent
// loan categories: credit cards, auto loans, other consumer loans, and real-estate loans.
// No API keys.
//
// Run:  node scripts/household-debt-holders.mjs
// Data: FDIC BankFind financials + Federal Reserve/FRED household debt series.
// Caveat: FDIC bank balance sheets do not show every household loan. Mortgages are often
// securitized or held/guaranteed outside banks, and student loans are largely federal.

const FDIC = "https://api.fdic.gov/banks/financials";

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

async function fred(id) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`);
  if (!res.ok) throw new Error(`FRED ${res.status} for ${id}`);
  return (await res.text())
    .trim().split("\n").slice(1)
    .map((l) => { const [d, v] = l.split(","); return { d, raw: v, v: Number(v) }; })
    .filter((x) => x.raw !== "" && x.raw !== "." && Number.isFinite(x.v));
}

const last = (a) => a[a.length - 1];
const usd = (n) => {
  const s = n < 0 ? "-" : "", a = Math.abs(n);
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${Math.round(a).toLocaleString("en-US")}`;
};
const qLabel = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-Q${Math.ceil(Number(yyyymmdd.slice(4, 6)) / 3)}`;
const val = (row, key) => (Number(row[key]) || 0) * 1000; // FDIC financials are $ thousands
const pad = (s, n) => String(s).slice(0, n).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

function top(rows, key, n = 10) {
  return rows
    .map((r) => ({ name: r.NAME, cert: r.CERT, amount: val(r, key), assets: val(r, "ASSET") }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n);
}

function sum(rows, key) {
  return rows.reduce((s, r) => s + val(r, key), 0);
}

function printTop(title, rows, total) {
  console.log(`\n  ${title}`);
  console.log(`  ${"Bank".padEnd(34)} ${"Amount".padStart(10)}  ${"Share".padStart(6)}`);
  console.log(`  ${"-".repeat(34)} ${"-".repeat(10)}  ${"-".repeat(6)}`);
  for (const r of rows) {
    console.log(`  ${pad(r.name, 34)} ${lpad(usd(r.amount), 10)}  ${lpad((r.amount / total * 100).toFixed(1) + "%", 6)}`);
  }
}

(async () => {
  try {
    const latest = (await getJSON(`${FDIC}?fields=REPDTE&sort_by=REPDTE&sort_order=DESC&limit=1&format=json`)).data[0].data.REPDTE;
    const fields = [
      "NAME", "CERT", "REPDTE", "ASSET", "LNRE", "LNCON", "LNCRCD", "LNAUTO", "LNCONOTH",
    ].join(",");
    const banks = (await getJSON(
      `${FDIC}?filters=REPDTE:${latest}&fields=${fields}&limit=10000&format=json`
    )).data.map((r) => r.data);

    const [consumerCredit, householdDebt] = await Promise.all([fred("HCCSDODNS"), fred("CMDEBT")]);
    const consumerLatest = last(consumerCredit);
    const householdLatest = last(householdDebt);
    const fedConsumerCredit = consumerLatest.v * 1e6;
    const fedHouseholdDebt = householdLatest.v * 1e6;

    const totals = {
      realEstate: sum(banks, "LNRE"),
      consumer: sum(banks, "LNCON"),
      creditCard: sum(banks, "LNCRCD"),
      auto: sum(banks, "LNAUTO"),
      otherConsumer: sum(banks, "LNCONOTH"),
    };

    console.log("\n  WHO HOLDS HOUSEHOLD-ADJACENT DEBT?  (FDIC-insured banks)");
    console.log(`  Source: FDIC BankFind financials, ${qLabel(latest)} (${banks.length.toLocaleString("en-US")} banks)`);
    console.log("\n  Bank balance-sheet totals:");
    console.log(`    Real-estate loans ............ ${usd(totals.realEstate)}`);
    console.log(`    Consumer loans total ......... ${usd(totals.consumer)}`);
    console.log(`      Credit-card loans .......... ${usd(totals.creditCard)}`);
    console.log(`      Auto loans ................. ${usd(totals.auto)}`);
    console.log(`      Other consumer loans ....... ${usd(totals.otherConsumer)}`);
    console.log("\n  Broader household-debt context (Federal Reserve via FRED):");
    console.log(`    Household/nonprofit debt ..... ${usd(fedHouseholdDebt)}   (${householdLatest.d})`);
    console.log(`    Consumer credit .............. ${usd(fedConsumerCredit)}   (${consumerLatest.d})`);
    console.log(`    FDIC banks hold about ........ ${(totals.consumer / fedConsumerCredit * 100).toFixed(1)}% of broad consumer credit`);

    printTop("Top banks by credit-card loans", top(banks, "LNCRCD"), totals.creditCard);
    printTop("Top banks by auto loans", top(banks, "LNAUTO"), totals.auto);
    printTop("Top banks by other consumer loans", top(banks, "LNCONOTH"), totals.otherConsumer);
    printTop("Top banks by real-estate loans", top(banks, "LNRE"), totals.realEstate);

    console.log("\n  Important caveats:");
    console.log("    • FDIC data covers FDIC-insured banks, not credit unions, finance companies, GSEs, MBS pools, or the federal student-loan portfolio.");
    console.log("    • 'Real-estate loans' includes more than household first mortgages, so don't read it as 'who owns all home mortgages.'");
    console.log("    • The bank that services or originated a loan may not be the bank/investor that owns it.\n");
  } catch (err) {
    console.error("Failed to fetch debt-holder data:", err.message);
    process.exit(1);
  }
})();
