import { BadRequestException } from '@nestjs/common';

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
