// world-bank.mjs — shared helpers for querying World Bank Open Data across
// every real country (not the regional/income-group aggregates the API
// mixes into the same list).

let realCountryCodesPromise = null;

export async function realCountryCodes() {
  if (!realCountryCodesPromise) {
    realCountryCodesPromise = (async () => {
      const res = await fetch("https://api.worldbank.org/v2/country?format=json&per_page=400");
      if (!res.ok) throw new Error(`World Bank HTTP ${res.status}`);
      const json = await res.json();
      const rows = json[1] || [];
      return new Set(rows.filter((r) => r.region?.value !== "Aggregates").map((r) => r.id));
    })();
  }
  return realCountryCodesPromise;
}

// Latest available value per real country for a World Bank indicator.
export async function worldBankLatestByCountry(indicatorId, { maxYearsBack = 5 } = {}) {
  const [countries, res] = await Promise.all([
    realCountryCodes(),
    fetch(`https://api.worldbank.org/v2/country/all/indicator/${indicatorId}?format=json&per_page=2000&mrv=${maxYearsBack}`),
  ]);
  if (!res.ok) throw new Error(`World Bank HTTP ${res.status}`);
  const json = await res.json();
  const rows = json[1] || [];
  const best = new Map();
  for (const row of rows) {
    if (row.value == null || !countries.has(row.countryiso3code)) continue;
    const cur = best.get(row.countryiso3code);
    if (!cur || Number(row.date) > Number(cur.year)) {
      best.set(row.countryiso3code, { code: row.countryiso3code, name: row.country?.value, year: row.date, value: Number(row.value) });
    }
  }
  return [...best.values()];
}
