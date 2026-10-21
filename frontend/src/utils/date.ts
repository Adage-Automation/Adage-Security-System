// `new Date().toISOString().slice(0, 10)` takes the UTC calendar date —
// for Asia/Kolkata (UTC+5:30) that returns YESTERDAY's date for the first
// 5.5 hours of every single day. Since the whole app's timezone authority
// is Asia/Kolkata, every "default to today" date picker was silently
// wrong during early-morning hours (a real risk exactly when a night-shift
// handover might be checking records). Found in the 2026-09-04 audit.
//
// This uses the browser's LOCAL date instead, which is correct as long as
// the device clock/timezone is set correctly — the same assumption every
// other client-side "today" already makes.
export function localIso(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

// `new Date("YYYY-MM-DD")` parses as UTC midnight, not local midnight — for
// any timezone west of UTC that's the previous local day, so setHours()
// on the result lands on the wrong calendar day (it happens to cancel out
// for Asia/Kolkata, which is east of UTC, which is why this went unnoticed).
// Parses the components directly so the Date is local midnight on the
// intended day everywhere. Found in the 2026-10 audit.
export function localDateFromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayIso(): string {
  return localIso(new Date());
}

export function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localIso(d);
}

// Monday as the start of the week, matching how "this week" reads to
// most of this app's users (not Sunday-start).
export function startOfWeekIso(): string {
  const d = new Date();
  const day = d.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diffToMonday);
  return localIso(d);
}

export function startOfMonthIso(): string {
  const d = new Date();
  d.setDate(1);
  return localIso(d);
}

// The company's attendance/payroll cycle runs the 26th of one month to the
// 25th of the next, not the calendar month — a separate, real need from
// "This Month". `offset` shifts by whole cycles (±1 = previous/next
// cycle) so a page can page back/forward through past cycles.
export function attendanceMonthRange(offset = 0): { from: string; to: string; label: string } {
  const now = new Date();
  // Before the 26th, "this" cycle actually started last month.
  const cycleMonth = now.getMonth() - (now.getDate() < 26 ? 1 : 0) + offset;
  const start = new Date(now.getFullYear(), cycleMonth, 26);
  const end = new Date(now.getFullYear(), cycleMonth + 1, 25);
  const label = `${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return { from: localIso(start), to: localIso(end), label };
}

// Shared so every movement time in the app (Corrections, Dashboard,
// EmployeeDetails) renders identically — was duplicated inline in each
// page before this. Found in the 2026-09-11 dead-code/duplication audit.
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
