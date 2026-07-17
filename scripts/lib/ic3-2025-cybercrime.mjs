// FBI Internet Crime Complaint Center (IC3), 2025 Annual Report — state
// breakdown of complaint counts and dollar losses.
// https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf (pages 28-29:
// "States by Complaint Count" / "States by Complaint Loss")
//
// MANUALLY MAINTAINED — like the NAIC auto insurance data, IC3 only
// publishes this once a year as a PDF (no API). Transcribed by rendering
// the PDF pages to images and reading them directly (pdftoppm), NOT from
// raw pdftotext extraction — this report uses a two-column layout that
// garbles cleanly under plain text extraction, the same trap that bit the
// NAIC data earlier.
//
// To refresh: download the new year's report from ic3.gov/AnnualReport,
// find "Complaints by State" in the table of contents, render that PDF
// page (and the next one, for losses) to an image, and re-transcribe
// visually — do not trust pdftotext for this report.

export const REPORT_YEAR = 2025;
export const SOURCE_URL = "https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf";

// state name -> complaint count (excludes DC/territories handled separately below)
export const COMPLAINTS_BY_STATE = {
  "California": 116414, "Texas": 97912, "Florida": 71843, "New York": 45255,
  "Illinois": 32977, "Pennsylvania": 31154, "Arizona": 28868, "Ohio": 27626,
  "North Carolina": 25940, "Georgia": 25936, "Washington": 25619, "Virginia": 25314,
  "Massachusetts": 22936, "Michigan": 22191, "Indiana": 20777, "New Jersey": 20648,
  "Maryland": 19430, "Colorado": 18847, "Wisconsin": 16680, "Tennessee": 16261,
  "South Carolina": 14699, "Missouri": 14087, "Minnesota": 13595, "Nevada": 13366,
  "Oregon": 12477, "Oklahoma": 11964, "Alabama": 9936, "Utah": 9903,
  "Connecticut": 9714, "Kentucky": 9414, "Louisiana": 8623, "Kansas": 7927,
  "Arkansas": 6161, "New Mexico": 5688, "Iowa": 5436, "Mississippi": 5084,
  "Idaho": 4479, "New Hampshire": 4374, "West Virginia": 4209, "Nebraska": 3724,
  "Hawaii": 3328, "Alaska": 3202, "District of Columbia": 3113, "Delaware": 3089,
  "Maine": 2888, "Rhode Island": 2700, "Montana": 2618, "South Dakota": 2514,
  "Vermont": 1580, "Wyoming": 1552, "North Dakota": 1418,
};

export const LOSSES_BY_STATE = {
  "California": 3674716305, "Texas": 1825636181, "Florida": 1596138595, "New York": 1226307877,
  "New Jersey": 660411901, "Arizona": 630700609, "Pennsylvania": 537787231, "Illinois": 535255201,
  "Georgia": 534581965, "Virginia": 476120025, "Washington": 458165375, "North Carolina": 431561716,
  "Ohio": 421289526, "Massachusetts": 410924066, "Maryland": 390242821, "Michigan": 381068131,
  "Colorado": 355049719, "Nevada": 302235247, "Tennessee": 269214519, "South Carolina": 264083026,
  "Minnesota": 248892986, "Missouri": 233933401, "Indiana": 233016771, "Connecticut": 219500212,
  "Utah": 195417205, "Wisconsin": 194227722, "Oregon": 193196479, "Alabama": 167212658,
  "Kansas": 147337101, "Oklahoma": 131921776, "Kentucky": 119685861, "Hawaii": 106447375,
  "Louisiana": 105440238, "Arkansas": 102541947, "District of Columbia": 97368097, "Iowa": 95520131,
  "West Virginia": 92648544, "Idaho": 88725284, "New Mexico": 85571285, "Mississippi": 77360761,
  "Rhode Island": 71960439, "Nebraska": 71844724, "Delaware": 62012494, "New Hampshire": 59283023,
  "Maine": 56536020, "Montana": 53192859, "South Dakota": 51452806, "Alaska": 39972438,
  "North Dakota": 37865442, "Vermont": 26567033, "Wyoming": 25826205,
};

export const NATIONAL_TOTAL_COMPLAINTS = 1008597;
export const NATIONAL_TOTAL_LOSSES = 21000000000; // ~$21B, as reported (rounded)
