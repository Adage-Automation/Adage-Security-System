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
function localIso(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

export function todayIso(): string {
  return localIso(new Date());
}

export function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localIso(d);
}

// Shared so every movement time in the app (Corrections, Dashboard,
// EmployeeDetails) renders identically — was duplicated inline in each
// page before this. Found in the 2026-09-11 dead-code/duplication audit.
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
