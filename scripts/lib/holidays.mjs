// holidays.mjs — major US holidays (computed by rule, works for any year) and
// a mapping of which post topics are thematically relevant to each one, so
// the content calendar can suggest posting a related topic on/around it
// instead of just filling the next mechanical time slot.

function nthWeekdayOfMonth(year, month, weekday, n) {
  // month: 0-11, weekday: 0=Sun..6=Sat, n: 1-based occurrence
  const first = new Date(Date.UTC(year, month, 1));
  const firstWeekday = first.getUTCDay();
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
  return new Date(Date.UTC(year, month, day));
}

function lastWeekdayOfMonth(year, month, weekday) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const lastWeekday = last.getUTCDay();
  const day = last.getUTCDate() - ((lastWeekday - weekday + 7) % 7);
  return new Date(Date.UTC(year, month, day));
}

const iso = (d) => d.toISOString().slice(0, 10);

export function usHolidays(year) {
  return [
    { name: "New Year's Day", date: iso(new Date(Date.UTC(year, 0, 1))) },
    { name: "Martin Luther King Jr. Day", date: iso(nthWeekdayOfMonth(year, 0, 1, 3)) },
    { name: "Presidents Day", date: iso(nthWeekdayOfMonth(year, 1, 1, 3)) },
    { name: "Tax Day", date: iso(new Date(Date.UTC(year, 3, 15))) },
    { name: "Memorial Day", date: iso(lastWeekdayOfMonth(year, 4, 1)) },
    { name: "Juneteenth", date: iso(new Date(Date.UTC(year, 5, 19))) },
    { name: "Independence Day", date: iso(new Date(Date.UTC(year, 6, 4))) },
    { name: "Labor Day", date: iso(nthWeekdayOfMonth(year, 8, 1, 1)) },
    { name: "Columbus Day", date: iso(nthWeekdayOfMonth(year, 9, 1, 2)) },
    { name: "Veterans Day", date: iso(new Date(Date.UTC(year, 10, 11))) },
    { name: "Thanksgiving", date: iso(nthWeekdayOfMonth(year, 10, 4, 4)) },
    { name: "Christmas", date: iso(new Date(Date.UTC(year, 11, 25))) },
    { name: "New Year's Eve", date: iso(new Date(Date.UTC(year, 11, 31))) },
  ];
}

// Which built topics fit which holiday, and how many days before the holiday
// to post (0 = on the day itself). Topics not listed here have no known
// holiday tie-in — that's fine, most posts are evergreen.
export const HOLIDAY_TOPICS = {
  "New Year's Day": [
    { topic: "state-population-watch", daysBefore: 0, note: "population milestones angle" },
    { topic: "world-population-watch", daysBefore: 1 },
  ],
  "Tax Day": [
    { topic: "tax-dollar-detail", daysBefore: 2 },
    { topic: "spending-by-category", daysBefore: 1 },
  ],
  "Memorial Day": [
    { topic: "military-spending-watch", daysBefore: 1 },
    { topic: "veteran-homelessness-watch", daysBefore: 0 },
  ],
  "Independence Day": [
    { topic: "natural-gas-production-watch", daysBefore: 2, note: "US #1 in the world — patriotic angle" },
    { topic: "state-gdp-watch", daysBefore: 1 },
    { topic: "world-gdp-growth-watch", daysBefore: 0 },
    { topic: "state-electricity-generation-watch", daysBefore: 3 },
  ],
  "Labor Day": [
    { topic: "state-income-watch", daysBefore: 1 },
    { topic: "state-unemployment-watch", daysBefore: 0 },
    { topic: "occupation-wages", daysBefore: 2 },
    { topic: "labor-market", daysBefore: 0 },
  ],
  "Veterans Day": [
    { topic: "veteran-homelessness-watch", daysBefore: 1 },
    { topic: "military-spending-watch", daysBefore: 0 },
  ],
  "Thanksgiving": [
    { topic: "usda-food-prices", daysBefore: 2, note: "grocery/food-cost angle" },
  ],
  "Christmas": [
    { topic: "household-cost-basket", daysBefore: 3, note: "holiday-spending-adjacent household cost angle" },
  ],
};
