import { TimeWindowPreference } from "./types";

const IST_OFFSET_MINUTES = 330;

const WEEKDAYS = new Map([
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6]
]);

const MONTHS = new Map([
  ["jan", 0],
  ["january", 0],
  ["feb", 1],
  ["february", 1],
  ["mar", 2],
  ["march", 2],
  ["apr", 3],
  ["april", 3],
  ["may", 4],
  ["jun", 5],
  ["june", 5],
  ["jul", 6],
  ["july", 6],
  ["aug", 7],
  ["august", 7],
  ["sep", 8],
  ["sept", 8],
  ["september", 8],
  ["oct", 9],
  ["october", 9],
  ["nov", 10],
  ["november", 10],
  ["dec", 11],
  ["december", 11]
]);

export type DayResolution = {
  preferredDate?: string;
  requestedDayLabel?: string;
  timeWindow?: TimeWindowPreference;
  reason?: "past_date" | "ambiguous";
};

export function resolveDayPreference(input: string, now = new Date()): DayResolution {
  const lower = input.toLowerCase();
  const today = istDateParts(now);
  const todayDate = dateFromParts(today.year, today.month, today.day);
  const timeWindow = inferTimeWindow(input);

  const candidates = [
    relativeDay(lower, todayDate),
    explicitMonthDate(lower, todayDate),
    numericDate(lower, todayDate),
    weekdayDate(lower, todayDate)
  ].filter((candidate): candidate is Date => Boolean(candidate));

  const unique = uniqueDates(candidates);
  if (unique.length > 1) {
    return { timeWindow, reason: "ambiguous" };
  }

  if (unique.length === 1) {
    const resolved = unique[0];
    if (resolved < todayDate) {
      return { timeWindow, reason: "past_date" };
    }
    return {
      preferredDate: formatIsoDate(resolved),
      requestedDayLabel: formatDayLabel(resolved),
      timeWindow
    };
  }

  if (hasExplicitPastDate(lower, todayDate)) {
    return { timeWindow, reason: "past_date" };
  }

  if (timeWindow) {
    return { timeWindow, reason: "ambiguous" };
  }

  return { reason: "ambiguous" };
}

export function inferTimeWindow(input: string): TimeWindowPreference | undefined {
  const lower = input.toLowerCase();
  if (/\b(morning|am)\b/.test(lower)) {
    return "morning";
  }
  if (/\b(evening|night)\b/.test(lower)) {
    return "evening";
  }
  if (/\b(afternoon|pm|post lunch)\b/.test(lower)) {
    return "afternoon";
  }
  return undefined;
}

export function availabilityWindowForDate(preferredDate: string) {
  return {
    windowStart: istWallClockToUtcIso(preferredDate, 9, 0),
    windowEnd: istWallClockToUtcIso(preferredDate, 18, 0)
  };
}

export function slotMatchesTimeWindow(startTime: string, timeWindow?: TimeWindowPreference) {
  if (!timeWindow) {
    return true;
  }
  const hour = istDateParts(new Date(startTime)).hour;
  if (timeWindow === "morning") {
    return hour >= 9 && hour < 12;
  }
  if (timeWindow === "afternoon") {
    return hour >= 12 && hour < 17;
  }
  return hour >= 17 && hour < 21;
}

function relativeDay(lower: string, today: Date) {
  if (/\bday after tomorrow\b/.test(lower)) {
    return addDays(today, 2);
  }
  if (/\btomorrow\b/.test(lower)) {
    return addDays(today, 1);
  }
  if (/\btoday\b/.test(lower)) {
    return today;
  }
  return null;
}

function weekdayDate(lower: string, today: Date) {
  for (const [name, weekday] of WEEKDAYS) {
    if (!new RegExp(`\\b${name}\\b`).test(lower)) {
      continue;
    }
    const delta = (weekday - today.getUTCDay() + 7) % 7;
    return addDays(today, delta === 0 ? 7 : delta);
  }
  return null;
}

function explicitMonthDate(lower: string, today: Date) {
  const monthPattern = Array.from(MONTHS.keys()).join("|");
  const patterns = [
    {
      pattern: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${monthPattern})(?:\\s*,?\\s*(\\d{4}))?\\b`),
      dayIndex: 1,
      monthIndex: 2,
      yearIndex: 3
    },
    {
      pattern: new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?\\b`),
      dayIndex: 2,
      monthIndex: 1,
      yearIndex: 3
    }
  ];

  for (const { pattern, dayIndex, monthIndex, yearIndex } of patterns) {
    const match = lower.match(pattern);
    if (!match) {
      continue;
    }
    const month = MONTHS.get(match[monthIndex]);
    if (month === undefined) {
      continue;
    }
    return resolveCalendarDate(Number(match[dayIndex]), month, match[yearIndex], today);
  }
  return null;
}

function numericDate(lower: string, today: Date) {
  const match = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (!match) {
    return null;
  }
  const year = match[3]
    ? String(Number(match[3]) < 100 ? Number(match[3]) + 2000 : Number(match[3]))
    : undefined;
  return resolveCalendarDate(Number(match[1]), Number(match[2]) - 1, year, today);
}

function resolveCalendarDate(day: number, month: number, yearText: string | undefined, today: Date) {
  const year = yearText ? Number(yearText) : today.getUTCFullYear();
  const candidate = dateFromParts(year, month, day);
  if (candidate.getUTCDate() !== day || candidate.getUTCMonth() !== month) {
    return null;
  }
  if (yearText || candidate >= today) {
    return candidate;
  }
  return dateFromParts(year + 1, month, day);
}

function hasExplicitPastDate(lower: string, today: Date) {
  const match = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s*,?\s*(\d{4})\b/);
  if (!match) {
    return false;
  }
  const month = MONTHS.get(match[2]);
  if (month === undefined) {
    return false;
  }
  const candidate = dateFromParts(Number(match[3]), month, Number(match[1]));
  return candidate < today;
}

function istWallClockToUtcIso(preferredDate: string, hour: number, minute: number) {
  const [year, month, day] = preferredDate.split("-").map(Number);
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MINUTES * 60 * 1000;
  return new Date(utcMs).toISOString();
}

function istDateParts(date: Date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours()
  };
}

function dateFromParts(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function uniqueDates(dates: Date[]) {
  return Array.from(new Map(dates.map((date) => [formatIsoDate(date), date])).values());
}

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDayLabel(date: Date) {
  return date.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}
