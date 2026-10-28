import { BadRequestException } from '@nestjs/common';

// `new Date().toISOString()` always returns the UTC calendar date,
// regardless of the server process's TZ — so it returns YESTERDAY's date
// for the first 5.5 hours of every IST day even on a correctly-configured
// production server. This mirrors frontend/src/utils/date.ts's todayIso()
// fix (2026-09-04) on the backend, using Intl instead of getTimezoneOffset()
// since Node has no built-in "local date in an arbitrary IANA zone" helper.
// Found in the 2026-09-21 audit: backend/src/dashboard/dashboard.controller.ts's
// no-date-param fallback had reintroduced the exact bug already fixed
// everywhere else.
// Generalized from the date-less version below so Insights' day-bucketing
// (grouping a `movementAt` timestamp into "which calendar day was this in
// Asia/Kolkata") can reuse the exact same timezone-correct logic, instead
// of a second, easy-to-get-wrong implementation using UTC date math.
// Constructing an Intl.DateTimeFormat is expensive relative to using one
// (locale data compilation) — ~10x in a benchmark — and this function is
// called per movement record in Insights' aggregation loops, so a cached
// instance (env var never changes at runtime) matters for real request
// latency. Found 2026-10-15 while chasing Insights' summary slowness.
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();
function getDateFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function formatDateInAppTimezone(date: Date): string {
  const timeZone = process.env.APP_TIMEZONE ?? 'Asia/Kolkata';
  const parts = getDateFormatter(timeZone).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

// Same caching rationale as getDateFormatter above, for exports that need
// the full timestamp (not just the calendar date) rendered in the app's
// timezone rather than raw UTC. Added 2026-10-28 — the Audit Log export
// was writing `row.createdAt.toISOString()` directly, so a 2am IST row
// came out 5h30m off and on the previous calendar date, while the same
// row on screen renders correctly via toLocaleString('en-IN') (browser-
// local, effectively IST for this app's users).
const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();
function getDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dateTimeFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-IN', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    dateTimeFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function formatDateTimeInAppTimezone(date: Date): string {
  const timeZone = process.env.APP_TIMEZONE ?? 'Asia/Kolkata';
  return getDateTimeFormatter(timeZone).format(date);
}

// Time-only variant — for messages/labels that show just a clock time,
// not a full timestamp. Same timezone-correctness reasoning as the two
// formatters above: `date.toLocaleTimeString('en-IN')` (no `timeZone`
// option) uses the Node process's OS-level TZ, not this app's own
// APP_TIMEZONE env var — the two are unrelated unless someone has also
// set the OS environment's TZ to match, which nothing enforces. Added
// 2026-10-28, found reviewing the error messages added earlier the same
// day in movements.service.ts's addMissingRecord ordering check.
const timeFormatterCache = new Map<string, Intl.DateTimeFormat>();
function getTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = timeFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-IN', { timeZone, hour: '2-digit', minute: '2-digit', hour12: true });
    timeFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function formatTimeInAppTimezone(date: Date): string {
  const timeZone = process.env.APP_TIMEZONE ?? 'Asia/Kolkata';
  return getTimeFormatter(timeZone).format(date);
}

export function todayInAppTimezone(): string {
  return formatDateInAppTimezone(new Date());
}

// Day-of-week for a given instant's app-timezone calendar date. Once
// formatDateInAppTimezone has resolved "which calendar day was this in
// Asia/Kolkata", day-of-week is timezone-independent, so parsing that
// YYYY-MM-DD as UTC midnight is safe.
export function isWeekday(date: Date): boolean {
  const day = new Date(`${formatDateInAppTimezone(date)}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

// Which days count toward Insights' analytics — 'weekdays' (the default,
// Mon-Fri only), 'all' (every day, the pre-2026-10-14 behavior), or
// 'weekends' (Sat/Sun only, for auditing who's coming in off-schedule).
// Added 2026-10-14, by request.
export const DAY_SCOPES = ['weekdays', 'all', 'weekends'] as const;
export type DayScope = (typeof DAY_SCOPES)[number];

export function matchesDayScope(date: Date, scope: DayScope): boolean {
  if (scope === 'all') return true;
  return scope === 'weekdays' ? isWeekday(date) : !isWeekday(date);
}

// Like dayRange() but spans multiple days — [from, to] inclusive on both
// ends. Used by Insights' date-range filters (trends over weeks/months),
// where dayRange()'s single-day [start, start+1) window doesn't apply.
export function dateRangeInclusive(fromStr: string, toStr: string): { start: Date; end: Date } {
  const { start } = dayRange(fromStr);
  const { end } = dayRange(toStr);
  if (end <= start) {
    throw new BadRequestException(`Invalid range: "from" (${fromStr}) must be on or before "to" (${toStr})`);
  }
  return { start, end };
}

// Shared by movements.service.ts and reports.service.ts — every
// date-scoped query in the app goes through this. Previously each call
// site built `new Date(dateStr)` directly with no validation: a malformed
// `date` query param (typo, hand-edited URL, stale bookmark) produced an
// `Invalid Date`, which either silently matched nothing or threw a raw
// RangeError deep inside Prisma/Intl.DateTimeFormat — a 500, not a clean
// validation error (found in the 2026-09-10 audit).
export function dayRange(dateStr: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new BadRequestException(`Invalid date "${dateStr}" — expected YYYY-MM-DD`);
  }
  const start = new Date(dateStr);
  if (Number.isNaN(start.getTime())) {
    throw new BadRequestException(`Invalid date "${dateStr}" — expected YYYY-MM-DD`);
  }
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}
