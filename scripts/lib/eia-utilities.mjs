// eia-utilities.mjs — residential electricity and natural gas costs by state,
// shared by any script that builds a household cost-of-living basket.

import { STATES } from "./data-common.mjs";

// National average annual residential natural-gas consumption for homes that
// use gas (EIA: ~65 Mcf/year) — applied to each state's price since EIA does
// not publish per-customer state-level gas consumption. This is an estimate;
// homes without gas service pay $0 of it.
export const NATIONAL_AVG_ANNUAL_GAS_MCF = 65;

const NON_STATE_EIA_CODES = new Set(["US", "PACN", "PACC", "NEW", "MAT", "ENC", "WNC", "SAT", "ESC", "WSC", "MTN"]);
const abbrToName = new Map(STATES.map((s) => [s.abbr, s.name]));

async function eiaLatestPeriod(eiaKey, url, extraFacets) {
  const qs = new URLSearchParams({ api_key: eiaKey, frequency: "monthly", "data[0]": extraFacets.dataField, "sort[0][column]": "period", "sort[0][direction]": "desc", length: "1" });
  for (const [k, v] of Object.entries(extraFacets.facets || {})) qs.set(k, v);
  const res = await fetch(`${url}?${qs}`);
  if (!res.ok) throw new Error(`EIA API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const period = json.response?.data?.[0]?.period;
  if (!period) throw new Error(`Could not determine latest EIA period for ${url}`);
  return period;
}

// Electricity: annual bill per residential customer, computed directly from
// EIA's reported monthly revenue and customer counts (not an assumption).
export async function fetchElectricity(eiaKey) {
  const url = "https://api.eia.gov/v2/electricity/retail-sales/data/";
  const period = await eiaLatestPeriod(eiaKey, url, { dataField: "revenue", facets: { "facets[sectorid][]": "RES", "facets[stateid][]": "US" } });
  const qs = new URLSearchParams({
    api_key: eiaKey, frequency: "monthly", "data[0]": "revenue", "data[1]": "customers",
    "facets[sectorid][]": "RES", start: period, end: period, length: "5000",
  });
  const res = await fetch(`${url}?${qs}`);
  if (!res.ok) throw new Error(`EIA electricity API HTTP ${res.status}`);
  const json = await res.json();
  const byState = new Map();
  for (const d of json.response?.data || []) {
    if (NON_STATE_EIA_CODES.has(d.stateid)) continue;
    const revenue = Number(d.revenue), customers = Number(d.customers);
    if (!(revenue > 0) || !(customers > 0)) continue;
    byState.set(d.stateDescription, (revenue * 1e6 / customers) * 12);
  }
  return { period, byState };
}

// Natural gas: state residential price ($/Mcf) x a national-average annual
// consumption assumption (see NATIONAL_AVG_ANNUAL_GAS_MCF above). EIA leaves
// a handful of states null in the very latest month (reporting lag, filled
// in later) — pull the last few months and take each state's most recent
// non-null reading instead of requiring one uniform period for all states.
export async function fetchGas(eiaKey) {
  const url = "https://api.eia.gov/v2/natural-gas/pri/sum/data/";
  const latest = await eiaLatestPeriod(eiaKey, url, { dataField: "value", facets: { "facets[process][]": "PRS" } });
  const qs = new URLSearchParams({
    api_key: eiaKey, frequency: "monthly", "data[0]": "value", "facets[process][]": "PRS",
    "sort[0][column]": "period", "sort[0][direction]": "desc", length: "5000",
  });
  const res = await fetch(`${url}?${qs}`);
  if (!res.ok) throw new Error(`EIA natural gas API HTTP ${res.status}`);
  const json = await res.json();
  const byState = new Map(); // first (most recent, desc-sorted) non-null value wins per state
  for (const d of json.response?.data || []) {
    if (!d.duoarea?.startsWith("S")) continue; // skip "NUS" (national)
    const name = abbrToName.get(d.duoarea.slice(1));
    const price = Number(d.value);
    if (!name || !(price > 0) || byState.has(name)) continue;
    byState.set(name, price * NATIONAL_AVG_ANNUAL_GAS_MCF);
  }
  return { period: latest, byState };
}
