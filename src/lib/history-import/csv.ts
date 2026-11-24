// Pure helpers for reading old outreach files. One CSV reader lives in src/lib/csv.ts.

export { parseCsv, readRecords, type CsvRecord } from "@/lib/csv";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Milliseconds the zone is ahead of UTC at the given instant. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The instant at which the zone's wall clock reads the given fields; null when a field is out of range. */
function wallToDate(y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string): Date | null {
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(guess);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null; // e.g. Feb 30
  let instant = guess - zoneOffsetMs(guess, timeZone);
  const second = zoneOffsetMs(instant, timeZone);
  if (instant !== guess - second) instant = guess - second;
  return new Date(instant);
}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i;
const ISO_WALL = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const US_WALL = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?$/i;

/**
 * Reads a date or date and time from an old log. A value with an offset is taken as written; one
 * without is read on the wall clock of timeZone. Accepts ISO with offset, YYYY-MM-DD,
 * YYYY-MM-DD HH:mm[:ss] and M/D/YYYY[ h:mm AM]. Anything else gives null.
 */
export function parseWallTime(raw: string, timeZone: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    if (ISO_WITH_OFFSET.test(s)) {
      const f = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s)!;
      // Check the written calendar fields first: Date would roll Feb 30 over to Mar 2.
      if (wallToDate(Number(f[1]), Number(f[2]), Number(f[3]), Number(f[4]), Number(f[5]), Number(f[6] ?? 0), "UTC") === null) return null;
      const d = new Date(s.replace(" ", "T").replace(/\s+/g, ""));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    let m = ISO_WALL.exec(s);
    if (m) {
      return wallToDate(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), timeZone);
    }
    m = US_WALL.exec(s);
    if (m) {
      let hour = Number(m[4] ?? 0);
      const meridiem = m[7]?.toUpperCase();
      if (meridiem) {
        if (hour < 1 || hour > 12) return null;
        hour = (hour % 12) + (meridiem === "PM" ? 12 : 0);
      }
      return wallToDate(Number(m[3]), Number(m[1]), Number(m[2]), hour, Number(m[5] ?? 0), Number(m[6] ?? 0), timeZone);
    }
  } catch {
    // An unknown time zone name throws RangeError; treat the value as unreadable.
    return null;
  }
  return null;
}
