// NAIC "2023 Auto Insurance Database Average Premium Supplement" (published
// June 2025), Table 4 — Average Expenditure per insured vehicle, by state.
// https://content.naic.org/sites/default/files/aut-db_1.pdf (page 22)
//
// MANUALLY MAINTAINED — this is the one dataset in the toolkit that is not
// pulled live. NAIC only republishes this report every 1-2 years (no API,
// PDF only). Transcribed and cross-checked by rendering the source PDF page
// to an image and reading it directly, after an initial text-extraction
// pass produced misaligned rows for several states (Louisiana, New York) —
// do not regenerate this file from pdftotext output without re-verifying
// against the rendered page.
//
// To refresh: check https://content.naic.org for a newer "Auto Insurance
// Database Average Premium Supplement", update REPORT_YEAR/PUBLISHED, and
// replace the table below the same way (render the PDF page, read the
// values visually — do not trust raw PDF text extraction for this table).

export const REPORT_YEAR = 2023;
export const PUBLISHED = "June 2025";
export const SOURCE_URL = "https://content.naic.org/sites/default/files/aut-db_1.pdf";

// state name -> average expenditure per insured vehicle, USD/year
export const AVG_EXPENDITURE_PER_VEHICLE = {
  "Alabama": 1081.24, "Alaska": 1112.96, "Arizona": 1343.85, "Arkansas": 1050.78,
  "California": 1223.16, "Colorado": 1452.82, "Connecticut": 1393.95, "Delaware": 1462.03,
  "District of Columbia": 1676.99, "Florida": 1863.82, "Georgia": 1555.08, "Hawaii": 888.07,
  "Idaho": 863.96, "Illinois": 1153.05, "Indiana": 926.42, "Iowa": 869.46,
  "Kansas": 972.64, "Kentucky": 1045.66, "Louisiana": 1749.22, "Maine": 856.28,
  "Maryland": 1477.34, "Massachusetts": 1326.46, "Michigan": 1443.45, "Minnesota": 1102.79,
  "Mississippi": 1199.53, "Missouri": 1154.92, "Montana": 975.01, "Nebraska": 980.31,
  "Nevada": 1461.47, "New Hampshire": 986.84, "New Jersey": 1572.86, "New Mexico": 1081.61,
  "New York": 1752.55, "North Carolina": 925.08, "North Dakota": 807.77, "Ohio": 947.24,
  "Oklahoma": 1084.54, "Oregon": 1170.31, "Pennsylvania": 1154.63, "Rhode Island": 1539.47,
  "South Carolina": 1367.39, "South Dakota": 936.15, "Tennessee": 1049.83, "Texas": 1428.94,
  "Utah": 1168.98, "Vermont": 893.16, "Virginia": 1114.47, "Washington": 1152.50,
  "West Virginia": 1062.98, "Wisconsin": 921.55, "Wyoming": 948.24,
};

export const COUNTRYWIDE_AVG_EXPENDITURE = 1281.60;
