const partsFormatter = new Map();

function formatter(timeZone) {
  if (!partsFormatter.has(timeZone)) {
    partsFormatter.set(timeZone, new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    }));
  }
  return partsFormatter.get(timeZone);
}

function zonedParts(date, timeZone) {
  return Object.fromEntries(formatter(timeZone).formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
}

function addDays({ year, month, day }, days) {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function dateKey(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function zonedTimeToUtc({ year, month, day, hour, minute }, timeZone) {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;
  // A second pass handles offsets around daylight-saving transitions.
  for (let pass = 0; pass < 2; pass++) {
    const actual = zonedParts(new Date(guess), timeZone);
    const rendered = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess -= rendered - target;
  }
  return new Date(guess);
}

export function parseScheduleSlots(value = "08:00,12:00") {
  const slots = String(value).split(",").map((slot) => slot.trim()).filter(Boolean);
  if (!slots.length || slots.some((slot) => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot))) {
    throw new Error("SOCIAL_SCHEDULE_SLOTS must contain comma-separated 24-hour times such as 08:00,12:00.");
  }
  return [...new Set(slots)].sort();
}

export function nextAvailableScheduleSlot({
  scheduled = [],
  published = [],
  timeZone = "America/Phoenix",
  slots = ["08:00", "12:00"],
  now = new Date(),
  startDaysAhead = 1,
  dailyLimit = slots.length,
  searchDays = 366,
  // Facebook rejects scheduled_publish_time values too far out (confirmed by
  // testing: ~28 days ahead succeeds, ~29 fails) even though its docs cite a
  // looser 75-day figure. Stay a day under the observed boundary so callers
  // get a clear error here instead of a silent, hard-to-diagnose (#100) from
  // the Graph API later.
  maxDaysAhead = 27,
}) {
  // Validate the timezone before searching.
  formatter(timeZone).format(now);
  const activeScheduled = scheduled.filter((entry) => !entry.status || ["scheduled", "processing"].includes(entry.status));
  const occupied = new Set(activeScheduled.map((entry) => new Date(entry.scheduledAt).getTime()));
  const dailyCounts = new Map();
  const addToDay = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;
    const key = dateKey(date, timeZone);
    dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1);
  };
  activeScheduled.forEach((entry) => addToDay(entry.scheduledAt));
  published.forEach((entry) => addToDay(entry.at || entry.publishedAt));
  const today = zonedParts(now, timeZone);
  const firstDate = addDays(today, Math.max(0, startDaysAhead));

  for (let dayOffset = 0; dayOffset < Math.min(searchDays, maxDaysAhead); dayOffset++) {
    const date = addDays(firstDate, dayOffset);
    const key = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
    if ((dailyCounts.get(key) || 0) >= dailyLimit) continue;
    for (const slot of slots) {
      const [hour, minute] = slot.split(":").map(Number);
      const candidate = zonedTimeToUtc({ ...date, hour, minute }, timeZone);
      if (candidate.getTime() <= now.getTime() || occupied.has(candidate.getTime())) continue;
      return { scheduledAt: candidate.toISOString(), timeZone, slot };
    }
  }
  throw new Error("No open publishing slot was found in the scheduling window.");
}

export function videoCadenceSchedulePlan({ scheduled = [], nextSlot, maxGapDays = 7 }) {
  if (!nextSlot?.scheduledAt) throw new Error("A normal next slot is required for video cadence planning.");
  const active = scheduled.filter((entry) =>
    (!entry.status || ["scheduled", "processing"].includes(entry.status)) &&
    !Number.isNaN(new Date(entry.scheduledAt).getTime())
  );
  const videos = active
    .filter((entry) => entry.media === "video")
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
  if (!videos.length) return { ...nextSlot, cadenceAdjusted: false, displaced: null };

  const latestVideo = videos[videos.length - 1];
  const normalTime = new Date(nextSlot.scheduledAt).getTime();
  const cadenceTime = new Date(latestVideo.scheduledAt).getTime() + maxGapDays * 24 * 60 * 60 * 1000;
  if (normalTime <= cadenceTime) return { ...nextSlot, cadenceAdjusted: false, displaced: null };

  const displaced = active.find((entry) => new Date(entry.scheduledAt).getTime() === cadenceTime) || null;
  return {
    ...nextSlot,
    scheduledAt: new Date(cadenceTime).toISOString(),
    cadenceAdjusted: true,
    displaced,
    displacedAt: displaced ? nextSlot.scheduledAt : null,
    previousVideoAt: latestVideo.scheduledAt,
    maxGapDays,
  };
}
