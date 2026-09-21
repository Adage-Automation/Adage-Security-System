import { todayInAppTimezone } from './day-range';

describe('todayInAppTimezone', () => {
  const originalEnv = process.env.APP_TIMEZONE;

  afterEach(() => {
    process.env.APP_TIMEZONE = originalEnv;
    jest.useRealTimers();
  });

  // 2026-01-01T02:00:00Z is still 2025-12-31 in UTC terms but already
  // 2026-01-01 07:30 IST — the exact boundary where the old
  // `new Date().toISOString().slice(0, 10)` implementation returned the
  // wrong (previous) calendar day for the first 5.5 hours of every IST day.
  it('returns the IST calendar date, not the UTC one, near midnight IST', () => {
    process.env.APP_TIMEZONE = 'Asia/Kolkata';
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T02:00:00Z'));

    expect(todayInAppTimezone()).toBe('2026-01-01');
  });

  it('agrees with the UTC date well away from the boundary', () => {
    process.env.APP_TIMEZONE = 'Asia/Kolkata';
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T10:00:00Z'));

    expect(todayInAppTimezone()).toBe('2026-06-15');
  });
});
