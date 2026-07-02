#!/usr/bin/env node
// healthcare-spending.mjs — Federal healthcare spending broken into sub-categories.
// Sources: USASpending.gov CFDA programs + subagency breakdown.  No API key required.
//
// Run:  node scripts/healthcare-spending.mjs
//       node scripts/healthcare-spending.mjs 2024

const USASPEND = "https://api.usaspending.gov/api/v2";
const UA_H = { "User-Agent": "fiscal-data-toolkit/1.0", "Content-Type": "application/json" };

const now = new Date();
const ARGS = process.argv.slice(2);
const FY = parseInt(
  ARGS.find((a) => /^\d{4}$/.test(a)) ||
  (now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1)
);

const fyStart = `${FY - 1}-10-01`;
const fyEnd   = `${FY}-09-30`;

async function post(path, body) {
  const res = await fetch(`${USASPEND}${path}`, {
    method: "POST",
    headers: UA_H,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

const money = (n) => {
  const v = Number(n);
  if (!v || !isFinite(v)) return "-";
  const s = v < 0 ? "-" : "", a = Math.abs(v);
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9)  return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6)  return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${a.toLocaleString()}`;
};

const rpad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

// CFDA program groupings for federal health spending
const MEDICARE_CODES = new Set(["93.773", "93.774", "93.770"]);
const MEDICAID_CODES = new Set(["93.778"]);
const CHIP_CODES     = new Set(["93.767"]);
const ACA_CODES      = new Set(["93.423", "93.720", "93.718"]);

// Programs to label by CFDA code
const CFDA_LABELS = {
  "93.773": "Medicare Part A — Hospital Insurance",
  "93.774": "Medicare Part B — Supplementary Medical Insurance",
  "93.770": "Medicare Part D — Prescription Drug Coverage",
  "93.778": "Medicaid — Federal share to states",
  "93.767": "Children's Health Insurance Program (CHIP)",
  "93.423": "ACA — State Innovation Waivers (1332)",
  "93.720": "ACA — Basic Health Program",
  "93.718": "ACA — Health Insurance Exchange Grants",
};

// HHS subagencies that are health-focused
const HEALTH_SUBAGENCIES = new Set([
  "Centers for Medicare and Medicaid Services",
  "National Institutes of Health",
  "Centers for Disease Control and Prevention",
  "Food and Drug Administration",
  "Health Resources and Services Administration",
  "Agency for Healthcare Research and Quality",
  "Substance Abuse and Mental Health Services Administration",
  "Indian Health Service",
  "Administration for Strategic Preparedness and Response",
  "Office of the Secretary",
]);

(async () => {
  console.log(`\n  U.S. FEDERAL HEALTHCARE SPENDING — FY${FY}  (Oct ${FY - 1} → Sep ${FY})`);
  console.log("  Source: USASpending.gov CFDA programs + subagency breakdown\n");

  const filters = { time_period: [{ start_date: fyStart, end_date: fyEnd }] };

  // Fetch CFDA programs and subagency data in parallel
  const [cfdaData, subagencyData] = await Promise.all([
    post("/search/spending_by_category/cfda/", { filters, limit: 100 }),
    post("/search/spending_by_category/awarding_subagency/", { filters, limit: 50 }),
  ]);

  const cfda = (cfdaData.results || []);
  const subs  = (subagencyData.results || []);

  // ── Medicare breakdown ────────────────────────────────────────────────────
  console.log("  ── MEDICARE  (CMS)  ─────────────────────────────────────────────────────\n");

  const medicareRows = cfda.filter(r => MEDICARE_CODES.has(r.code)).sort((a, b) => b.amount - a.amount);
  const medicareTotal = medicareRows.reduce((s, r) => s + r.amount, 0);
  const unknownMedicare = 0; // Medicare Advantage (Part C) flows through Part A/B

  console.log(`  ${"Program".padEnd(55)}  ${"Amount".padStart(10)}   ${"Share of Medicare".padStart(17)}`);
  console.log(`  ${"─".repeat(55)}  ${"─".repeat(10)}   ${"─".repeat(17)}`);
  for (const r of medicareRows) {
    const label = CFDA_LABELS[r.code] || r.name;
    const share = `${(r.amount / medicareTotal * 100).toFixed(1)}%`;
    console.log(`  ${rpad(label, 55)}  ${lpad(money(r.amount), 10)}   ${lpad(share, 17)}`);
  }
  console.log(`  ${rpad("  Medicare total", 55)}  ${lpad(money(medicareTotal), 10)}`);
  console.log(`\n  Note: Medicare Advantage (Part C) is a delivery model — costs flow through`);
  console.log(`  Part A and B above. ~51% of Medicare beneficiaries use Medicare Advantage.\n`);

  // ── Medicaid + CHIP ───────────────────────────────────────────────────────
  console.log("  ── MEDICAID + CHIP  ─────────────────────────────────────────────────────\n");

  const medicaidRows = cfda.filter(r => MEDICAID_CODES.has(r.code) || CHIP_CODES.has(r.code))
    .sort((a, b) => b.amount - a.amount);
  const medicaidTotal = medicaidRows.reduce((s, r) => s + r.amount, 0);

  console.log(`  ${"Program".padEnd(55)}  ${"Amount".padStart(10)}`);
  console.log(`  ${"─".repeat(55)}  ${"─".repeat(10)}`);
  for (const r of medicaidRows) {
    const label = CFDA_LABELS[r.code] || r.name;
    console.log(`  ${rpad(label, 55)}  ${lpad(money(r.amount), 10)}`);
  }
  console.log(`  ${rpad("  Medicaid + CHIP total", 55)}  ${lpad(money(medicaidTotal), 10)}`);
  console.log(`\n  Note: These are federal matching funds. States contribute an additional`);
  console.log(`  ~40% on average — federal share varies 50–77% by state income level.\n`);

  // ── ACA subsidies ─────────────────────────────────────────────────────────
  const acaRows = cfda.filter(r => ACA_CODES.has(r.code)).sort((a, b) => b.amount - a.amount);
  const acaTotal = acaRows.reduce((s, r) => s + r.amount, 0);

  if (acaTotal > 1e9) {
    console.log("  ── ACA MARKETPLACE SUBSIDIES  ───────────────────────────────────────────\n");
    console.log(`  ${"Program".padEnd(55)}  ${"Amount".padStart(10)}`);
    console.log(`  ${"─".repeat(55)}  ${"─".repeat(10)}`);
    for (const r of acaRows) {
      const label = CFDA_LABELS[r.code] || r.name;
      console.log(`  ${rpad(label, 55)}  ${lpad(money(r.amount), 10)}`);
    }
    console.log(`  ${rpad("  ACA total", 55)}  ${lpad(money(acaTotal), 10)}`);
    console.log();
  }

  // ── Other HHS health programs ─────────────────────────────────────────────
  console.log("  ── OTHER HHS / FEDERAL HEALTH PROGRAMS  ─────────────────────────────────\n");
  console.log(`  ${"Subagency".padEnd(50)}  ${"Amount".padStart(10)}`);
  console.log(`  ${"─".repeat(50)}  ${"─".repeat(10)}`);

  // Show NIH, CDC, FDA, HRSA, etc. from subagency data
  const otherHealthAgencies = subs.filter(r => {
    const n = r.name;
    return n === "National Institutes of Health" ||
           n === "Centers for Disease Control and Prevention" ||
           n === "Food and Drug Administration" ||
           n === "Health Resources and Services Administration" ||
           n === "Substance Abuse and Mental Health Services Administration" ||
           n === "Indian Health Service" ||
           n === "Agency for Healthcare Research and Quality" ||
           n === "Administration for Strategic Preparedness and Response" ||
           n === "Administration for Children and Families";
  }).sort((a, b) => b.amount - a.amount);

  const otherTotal = otherHealthAgencies.reduce((s, r) => s + r.amount, 0);
  for (const r of otherHealthAgencies) {
    console.log(`  ${rpad(r.name, 50)}  ${lpad(money(r.amount), 10)}`);
  }
  console.log(`  ${rpad("  Other programs total", 50)}  ${lpad(money(otherTotal), 10)}`);

  // ── VA health (separate from HHS) ─────────────────────────────────────────
  const vaHealth = subs.find(r => r.name === "Department of Veterans Affairs");
  if (vaHealth) {
    console.log(`\n  ── VETERANS HEALTH  (VA — separate from HHS)  ─────────────────────────`);
    console.log(`\n  Department of Veterans Affairs (total)          ${lpad(money(vaHealth.amount), 10)}`);
    console.log(`  Note: VA spending covers health care, disability compensation,`);
    console.log(`  education benefits, and housing — not exclusively healthcare.\n`);
  }

  // ── Summary: all federal health ───────────────────────────────────────────
  const grandTotal = medicareTotal + medicaidTotal + acaTotal + otherTotal;
  const cmsTotal = subs.find(r => r.name === "Centers for Medicare and Medicaid Services");

  console.log("  ── SUMMARY ──────────────────────────────────────────────────────────────\n");
  console.log(`  ${"Category".padEnd(48)}  ${"Amount".padStart(10)}   ${"Share".padStart(7)}`);
  console.log(`  ${"─".repeat(48)}  ${"─".repeat(10)}   ${"─".repeat(7)}`);

  const summaryRows = [
    { name: "Medicare (Part A + B + D)", amt: medicareTotal },
    { name: "Medicaid (federal share)", amt: medicaidRows.find(r => r.code === "93.778")?.amount || 0 },
    { name: "CHIP", amt: medicaidRows.find(r => r.code === "93.767")?.amount || 0 },
    ...(acaTotal > 1e9 ? [{ name: "ACA marketplace subsidies", amt: acaTotal }] : []),
    { name: "NIH — research grants", amt: subs.find(r => r.name === "National Institutes of Health")?.amount || 0 },
    { name: "Administration for Children & Families", amt: subs.find(r => r.name === "Administration for Children and Families")?.amount || 0 },
    { name: "CDC — public health programs", amt: subs.find(r => r.name === "Centers for Disease Control and Prevention")?.amount || 0 },
    { name: "Health Resources & Services Admin (HRSA)", amt: subs.find(r => r.name === "Health Resources and Services Administration")?.amount || 0 },
    { name: "SAMHSA — behavioral health", amt: subs.find(r => r.name === "Substance Abuse and Mental Health Services Administration")?.amount || 0 },
    { name: "Indian Health Service", amt: subs.find(r => r.name === "Indian Health Service")?.amount || 0 },
    { name: "FDA — drug/food safety", amt: subs.find(r => r.name === "Food and Drug Administration")?.amount || 0 },
    { name: "ASPR — emergency preparedness", amt: subs.find(r => r.name === "Administration for Strategic Preparedness and Response")?.amount || 0 },
  ].filter(r => r.amt > 0).sort((a, b) => b.amt - a.amt);

  const summaryTotal = summaryRows.reduce((s, r) => s + r.amt, 0);
  for (const r of summaryRows) {
    const share = `${(r.amt / summaryTotal * 100).toFixed(1)}%`;
    console.log(`  ${rpad(r.name, 48)}  ${lpad(money(r.amt), 10)}   ${lpad(share, 7)}`);
  }
  console.log(`  ${"─".repeat(48)}  ${"─".repeat(10)}`);
  console.log(`  ${rpad("  Identified federal health total", 48)}  ${lpad(money(summaryTotal), 10)}`);

  if (cmsTotal) {
    console.log(`\n  CMS (Centers for Medicare & Medicaid) total: ${money(cmsTotal.amount)}`);
    console.log(`  (CMS total includes Medicare + Medicaid + CHIP + administration costs)`);
  }

  console.log(`
  KEY FACTS
  ─────────────────────────────────────────────────────────────────────────
  Medicare covers ~67M Americans (65+ and disabled). Part A = hospital stays,
  Part B = doctor visits & outpatient, Part C = Medicare Advantage (managed),
  Part D = prescription drugs. Medicare Advantage (Part C) is private insurance
  paid through Part A/B funding — ~half of beneficiaries use it.

  Medicaid covers ~90M low-income Americans. Federal gov pays 50–77% of costs;
  states pay the rest. ACA expanded Medicaid eligibility in 40 states.

  CHIP covers ~7M low-income children not eligible for Medicaid.

  NIH funds ~80% of all non-pharmaceutical biomedical research in the U.S.
  FDA has a small budget (~$6-7B) but regulates $3.3T in consumer goods.
`);
})();
