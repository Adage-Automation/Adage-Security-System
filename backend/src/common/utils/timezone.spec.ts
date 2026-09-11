import { validateTimezoneConfiguration } from './timezone';

describe('validateTimezoneConfiguration', () => {
  const originalAppTimezone = process.env.APP_TIMEZONE;
  const originalTimezone = process.env.TZ;

  afterEach(() => {
    if (originalAppTimezone === undefined) {
      delete process.env.APP_TIMEZONE;
    } else {
      process.env.APP_TIMEZONE = originalAppTimezone;
    }

    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  });

  it('accepts a matching configured timezone', () => {
    process.env.APP_TIMEZONE = 'Asia/Kolkata';
    process.env.TZ = 'Asia/Kolkata';

    expect(validateTimezoneConfiguration()).toEqual({
      expected: 'Asia/Kolkata',
      actual: 'Asia/Kolkata',
      isValid: true,
    });
  });

  it('treats Asia/Calcutta as the same timezone as Asia/Kolkata', () => {
    process.env.APP_TIMEZONE = 'Asia/Kolkata';
    process.env.TZ = 'Asia/Calcutta';

    expect(validateTimezoneConfiguration()).toEqual({
      expected: 'Asia/Kolkata',
      actual: 'Asia/Kolkata',
      isValid: true,
    });
  });

  it('flags a mismatch between APP_TIMEZONE and TZ', () => {
    process.env.APP_TIMEZONE = 'Asia/Kolkata';
    process.env.TZ = 'UTC';

    expect(validateTimezoneConfiguration()).toEqual({
      expected: 'Asia/Kolkata',
      actual: 'UTC',
      isValid: false,
    });
  });
});
