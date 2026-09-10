// The fixed set of keys the `settings` table is allowed to hold — mirrors
// what `prisma/seed.ts` creates. Without this, SettingsController.set
// accepted any arbitrary key, so a typo (or a stray client bug) would
// silently create a junk row instead of erroring.
export const SETTING_KEYS = ['COMPANY_NAME', 'TIMEZONE', 'SECURITY_EMAIL', 'EMAIL_SENDER_NAME'] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
