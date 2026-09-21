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
export function todayInAppTimezone(): string {
  const timeZone = process.env.APP_TIMEZONE ?? 'Asia/Kolkata';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
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
