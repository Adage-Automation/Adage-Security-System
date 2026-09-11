const TIMEZONE_ALIASES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Kolkata': 'Asia/Kolkata',
};

function normalizeTimezone(value?: string): string {
  if (!value) {
    return 'unknown';
  }

  return TIMEZONE_ALIASES[value] ?? value;
}

export function validateTimezoneConfiguration(): { expected: string; actual: string; isValid: boolean } {
  const expected = normalizeTimezone(process.env.APP_TIMEZONE ?? 'Asia/Kolkata');
  const actual = normalizeTimezone(process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown');

  return {
    expected,
    actual,
    isValid: actual === expected,
  };
}
