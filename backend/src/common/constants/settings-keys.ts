// The fixed set of keys the `settings` table is allowed to hold — mirrors
// what `prisma/seed.ts` creates. Without this, SettingsController.set
// accepted any arbitrary key, so a typo (or a stray client bug) would
// silently create a junk row instead of erroring.
// SHIFT_REFERENCE_START/END and EXPECTED_DAILY_HOURS back the Insights
// hours-shortfall metric — the office uses flexible timing (no fixed
// clock-in deadline), so these are shown only as a reference window on
// charts, never used to flag someone as "late." The only real compliance
// check is EXPECTED_DAILY_HOURS: did the employee's first-entry-to-last-
// exit span that day reach it. Added 2026-10-05.
export const SETTING_KEYS = [
  'COMPANY_NAME',
  'TIMEZONE',
  'EMAIL_SENDER_NAME',
  'SHIFT_REFERENCE_START',
  'SHIFT_REFERENCE_END',
  'EXPECTED_DAILY_HOURS',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
