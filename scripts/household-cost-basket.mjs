#!/usr/bin/env node
// Basic annual household bills by state: median contract rent, residential
// electricity, estimated natural gas, and auto insurance for one vehicle.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { C, cardHTML, horizontalBarChart, screenshot, toCSV } from "./lib/chart-kit.mjs";
import { SOCIAL, STAMP, argValue, censusRows, envValue, money, pct, rel, uniqueRows } from "./lib/data-common.mjs";
import { fetchElectricity, fetchGas, NATIONAL_AVG_ANNUAL_GAS_MCF } from "./lib/eia-utilities.mjs";
import { AVG_EXPENDITURE_PER_VEHICLE, PUBLISHED as NAIC_PUBLISHED, REPORT_YEAR as NAIC_YEAR, SOURCE_URL as NAIC_URL } from "./lib/naic-auto-insurance-2023.mjs";

const censusKey = envValue("CENSUS_API_KEY");
if (!censusKey) throw new Error("Missing CENSUS_API_KEY in .env.");
const eiaKey = envValue("EIA_API_KEY");
if (!eiaKey) throw new Error("Missing EIA_API_KEY in .env.");

const censusYear = Number(argValue("--year", "2024"));
const view = String(argValue("--view", "cost")).toLowerCase();
if (!Number.isInteger(censusYear) || censusYear < 2005) throw new Error("--year must be a valid ACS year.");
if (!new Set(["cost", "burden"]).has(view)) throw new Error("--view must be cost or burden.");
const noImage = process.argv.includes("--no-image");
const outBase = path.join(SOCIAL, `household-cost-basket-${STAMP}`);
mkdirSync(SOCIAL, { recursive: true });

const [rentRows, incomeRows, electricity, gas] = await Promise.all([
  censusRows(censusYear, "acs/acs1", ["B25058_001E"], "state:*", censusKey),
  censusRows(censusYear, "acs/acs1/profile", ["DP03_0062E"], "state:*", censusKey),
  fetchElectricity(eiaKey),
  fetchGas(eiaKey),
]);

const incomeByState = new Map(incomeRows.map((row) => [row.NAME, Number(row.DP03_0062E)]));
const rows = rentRows.map((row) => {
  const state = row.NAME;
  const monthlyRent = Number(row.B25058_001E);
  const income = incomeByState.get(state);
  const annualElectricity = electricity.byState.get(state);
  const annualGas = gas.byState.get(state);
  const autoInsurance = AVG_EXPENDITURE_PER_VEHICLE[state];
  if (row.state === "72" || !(monthlyRent > 0) || !(income > 0) || !(annualElectricity > 0) || !(annualGas > 0) || !(autoInsurance > 0)) return null;
  const annualRent = monthlyRent * 12;
  const combined = annualRent + annualElectricity + annualGas + autoInsurance;
  return {
    state, annualRent, annualElectricity, annualGas, autoInsurance, combined,
    monthly: combined / 12, income, incomeShare: combined / income * 100,
  };
}).filter(Boolean);
if (!rows.length) throw new Error("No complete Census, EIA, and NAIC household-cost rows were matched.");

const byCost = [...rows].sort((a, b) => b.combined - a.combined).map((row, index) => ({ ...row, costRank: index + 1 }));
const byBurden = [...rows].sort((a, b) => b.incomeShare - a.incomeShare).map((row, index) => ({ ...row, burdenRank: index + 1 }));
const costRank = new Map(byCost.map((row) => [row.state, row.costRank]));
const burdenRank = new Map(byBurden.map((row) => [row.state, row.burdenRank]));
const ranked = (view === "cost" ? byCost : byBurden).map((row, index) => ({
  ...row, rank: index + 1, costRank: costRank.get(row.state), burdenRank: burdenRank.get(row.state),
}));

const az = ranked.find((row) => row.state === "Arizona");
const highest = ranked.slice(0, 5);
const lowest = ranked.slice(-5).reverse();
const chartRows = uniqueRows([...highest, az, ...lowest.slice().reverse()], "state");
const valueFor = (row) => view === "cost" ? row.combined : row.incomeShare;
const valueFormat = view === "cost" ? money : (value) => pct(value);
const chartSVG = horizontalBarChart(chartRows.map((row) => ({
  label: `#${row.rank} ${row.state}`,
  v: valueFor(row),
  color: row.state === "Arizona" ? C.s2 : C.s1,
})), {
  fmtTick: view === "cost" ? (value) => `$${Math.round(value / 1000)}k` : (value) => `${Math.round(value)}%`,
  fmtVal: valueFormat,
});

const html = cardHTML({
  kicker: "Basic household bills check",
  title: view === "cost"
    ? "Rent + utilities + auto insurance, one-car renter"
    : "Basic household bills as a share of median income",
  hero: valueFormat(valueFor(highest[0])),
  heroLabel: `${highest[0].state}; contract rent, utilities, and one insured vehicle`,
  chartSVG,
  source: "U.S. Census Bureau ACS; U.S. EIA; NAIC",
  vintage: `ACS ${censusYear}; EIA ${electricity.period}; NAIC ${NAIC_YEAR}`,
});

const rowSummary = (row) => view === "cost"
  ? `${money(row.combined)}/year (${money(row.monthly)}/month)`
  : `${pct(row.incomeShare)} of median household income`;
const facebook = [
  "How much does it cost just to pay the basic household bills in each state?",
  `${highest[0].state} tops the list at ${money(highest[0].monthly)}/month, while ${lowest[0].state} averages just ${money(lowest[0].monthly)}/month.`, "",
  "This ranking estimates the annual cost of four basic household expenses:",
  "• Rent", "• Electricity", "• Natural gas", "• Auto insurance (one insured vehicle)", "",
  view === "cost" ? "State | Annual basic household bills" : "State | Share of median household income",
  ...ranked.map((row) => `#${row.rank} ${row.state} | ${rowSummary(row)}`), "",
  az ? `Arizona ranks #${az.rank}.` : "",
  az ? "Average annual household bills:" : "",
  az ? `• Rent: ${money(az.annualRent)}` : "", az ? `• Electricity: ${money(az.annualElectricity)}` : "",
  az ? `• Natural gas: ${money(az.annualGas)}` : "", az ? `• Auto insurance: ${money(az.autoInsurance)}` : "",
  az ? `Total: ${money(az.combined)}/year (${money(az.monthly)}/month)` : "", "",
  `Groceries are excluded because BLS and USDA do not publish a comparable official food-price level for every state. This is not a complete cost-of-living budget: healthcare, gasoline, car payments, taxes, phone/internet, and other expenses are also excluded.`, "",
  `Natural gas uses each state's EIA residential price multiplied by a national-average ${NATIONAL_AVG_ANNUAL_GAS_MCF} Mcf annual usage assumption; homes without gas service would pay less. Auto insurance is per insured vehicle, so multi-car households would pay more.`, "",
  "How much do you actually spend each month on these four bills? Comment below and share this with someone comparing states.", "",
  "Sources:", "• U.S. Census Bureau (ACS)", "• U.S. Energy Information Administration (EIA)", "• National Association of Insurance Commissioners (NAIC)",
  "Source website: https://www.census.gov/data/developers/data-sets/acs-1year.html",
  "EIA: https://www.eia.gov/opendata/",
  `NAIC: ${NAIC_URL}`,
  "Census and EIA information retrieved programmatically via API; NAIC figures were transcribed from the regulator's published report.",
  "Graph made by Jeffrey Macy.",
].filter(Boolean);

const lines = [
  `Household cost basket (${STAMP})`, "",
  `Scenario: median contract rent + residential electricity + estimated natural gas + auto insurance for one insured vehicle. Census vintage ${censusYear}; EIA electricity ${electricity.period}; EIA gas ${gas.period}; NAIC ${NAIC_YEAR} (published ${NAIC_PUBLISHED}).`, "",
  view === "cost" ? "State | Annual basic household bills" : "State | Basic household bills share of median income",
  "---|---:",
  ...ranked.map((row) => `#${row.rank} ${row.state} | ${rowSummary(row)}`), "",
  "Facebook post", "-------------", facebook.join("\n"), "",
  `Method note: ACS B25058 median contract rent x12; EIA residential revenue/customers x12 for electricity; EIA state residential gas price x ${NATIONAL_AVG_ANNUAL_GAS_MCF} Mcf; NAIC average expenditure for one insured vehicle. Mixed vintages are shown rather than pretending every source measures the same year.`,
];

function writeDetailAsset({ slug, kicker, title, question, value, valueLabel, source, sourceWebsite, vintage, note, apiNote, tickFormat }) {
  const detailBase = path.join(SOCIAL, `${slug}-${STAMP}`);
  const detailRows = [...rows]
    .map((row) => ({ ...row, detailValue: value(row) }))
    .sort((a, b) => b.detailValue - a.detailValue)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const detailAz = detailRows.find((row) => row.state === "Arizona");
  const detailHigh = detailRows.slice(0, 5);
  const detailLow = detailRows.slice(-5).reverse();
  const detailChartRows = uniqueRows([...detailHigh, detailAz, ...detailLow.slice().reverse()], "state");
  const detailChart = horizontalBarChart(detailChartRows.map((row) => ({
    label: `#${row.rank} ${row.state}`,
    v: row.detailValue,
    color: row.state === "Arizona" ? C.s2 : C.s1,
  })), { fmtTick: tickFormat, fmtVal: money });
  const detailHtml = cardHTML({
    kicker,
    title,
    hero: money(detailHigh[0].detailValue),
    heroLabel: `${detailHigh[0].state}; ${valueLabel}`,
    chartSVG: detailChart,
    source,
    vintage,
  });
  const detailFacebook = [
    question, "",
    `Highest:`, ...detailHigh.map((row) => `#${row.rank} ${row.state}: ${money(row.detailValue)}/year (${money(row.detailValue / 12)}/month)`), "",
    `Lowest:`, ...detailLow.map((row) => `#${row.rank} ${row.state}: ${money(row.detailValue)}/year (${money(row.detailValue / 12)}/month)`), "",
    detailAz ? `Arizona: #${detailAz.rank}, ${money(detailAz.detailValue)}/year (${money(detailAz.detailValue / 12)}/month).` : "", "",
    note, "",
    "Which state surprised you most? Comment below and share this with someone comparing places to live.", "",
    `Source website: ${sourceWebsite}`,
    apiNote,
    "Graph made by Jeffrey Macy.",
  ].filter(Boolean);
  const detailLines = [
    `${title} (${STAMP})`, "",
    `State | ${valueLabel}`,
    "---|---:",
    ...detailRows.map((row) => `#${row.rank} ${row.state} | ${money(row.detailValue)}/year (${money(row.detailValue / 12)}/month)`), "",
    "Facebook post", "-------------", detailFacebook.join("\n"), "",
    note,
  ];
  writeFileSync(`${detailBase}.txt`, detailLines.join("\n"));
  writeFileSync(`${detailBase}.csv`, toCSV(
    ["rank", "state", "annual_cost", "monthly_cost"],
    detailRows.map((row) => [row.rank, row.state, row.detailValue, row.detailValue / 12])
  ));
  writeFileSync(`${detailBase}.html`, detailHtml);
  const image = !noImage && screenshot(`${detailBase}.html`, `${detailBase}.png`);
  return ["txt", "csv", "html", image && "png"].filter(Boolean).map((ext) => rel(`${detailBase}.${ext}`));
}

writeFileSync(`${outBase}.txt`, lines.join("\n"));
writeFileSync(`${outBase}.csv`, toCSV(
  ["display_rank", "cost_rank", "burden_rank", "state", "annual_contract_rent", "annual_electricity", "annual_gas_estimate", "annual_auto_insurance_one_vehicle", "combined_annual", "combined_monthly", "median_household_income", "income_share_pct", "census_year", "eia_electricity_period", "eia_gas_period", "naic_year"],
  ranked.map((row) => [row.rank, row.costRank, row.burdenRank, row.state, row.annualRent, row.annualElectricity, row.annualGas, row.autoInsurance, row.combined, row.monthly, row.income, row.incomeShare, censusYear, electricity.period, gas.period, NAIC_YEAR])
));
writeFileSync(`${outBase}.html`, html);
const wroteImage = !noImage && screenshot(`${outBase}.html`, `${outBase}.png`);
const detailFiles = [
  ...writeDetailAsset({
    slug: "household-cost-rent",
    kicker: "Household bills: rent",
    title: "Annual contract rent for renters, by state",
    question: "How much does contract rent cost across the states and D.C.?",
    value: (row) => row.annualRent,
    valueLabel: "median contract rent",
    source: "U.S. Census Bureau ACS",
    sourceWebsite: "https://www.census.gov/data/developers/data-sets/acs-1year.html",
    vintage: String(censusYear),
    note: "Contract rent excludes renter-paid utilities. It is used here so electricity and gas can be shown separately without double-counting them.",
    apiNote: "Information retrieved programmatically via API.",
    tickFormat: (value) => `$${Math.round(value / 1000)}k`,
  }),
  ...writeDetailAsset({
    slug: "household-cost-utilities",
    kicker: "Household bills: utilities",
    title: "Annual electricity + estimated natural gas",
    question: "How much do residential electricity and natural gas cost across the states and D.C.?",
    value: (row) => row.annualElectricity + row.annualGas,
    valueLabel: "electricity plus estimated natural gas",
    source: "U.S. Energy Information Administration",
    sourceWebsite: "https://www.eia.gov/opendata/",
    vintage: `Electricity ${electricity.period}; gas ${gas.period}`,
    note: `Electricity uses EIA residential revenue per customer. Natural gas uses each state's residential price multiplied by a national-average ${NATIONAL_AVG_ANNUAL_GAS_MCF} Mcf annual usage assumption; homes without gas service would pay less.`,
    apiNote: "Information retrieved programmatically via API.",
    tickFormat: (value) => `$${Math.round(value / 1000)}k`,
  }),
  ...writeDetailAsset({
    slug: "household-cost-auto-insurance",
    kicker: "Household bills: auto insurance",
    title: "Annual auto insurance cost for one vehicle",
    question: "How much does auto insurance cost for one insured vehicle across the states and D.C.?",
    value: (row) => row.autoInsurance,
    valueLabel: "average expenditure per insured vehicle",
    source: "NAIC Auto Insurance Database",
    sourceWebsite: NAIC_URL,
    vintage: `${NAIC_YEAR} (published ${NAIC_PUBLISHED})`,
    note: "NAIC average expenditure blends coverage levels and driver profiles. It is per insured vehicle, so a two-car household would generally pay more.",
    apiNote: "NAIC figures were transcribed from the regulator's published report.",
    tickFormat: (value) => money(value),
  }),
];
console.log(lines.join("\n"));
console.log(`\nFiles: ${["txt", "csv", "html", wroteImage && "png"].filter(Boolean).map((ext) => rel(`${outBase}.${ext}`)).join(" / ")}`);
console.log(`Breakdown files:\n${detailFiles.join("\n")}`);
