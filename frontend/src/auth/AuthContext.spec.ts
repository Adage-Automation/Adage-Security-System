import { ApiError, ApiTimeoutError } from '../api/client';
import { shouldUseCachedUser } from './AuthContext';

describe('shouldUseCachedUser', () => {
  it('does not trust the cache when the server actually rejected the session (ApiError)', () => {
    expect(shouldUseCachedUser(new ApiError(401, 'Unauthorized'))).toBe(false);
  });

  it('trusts the cache on a request timeout', () => {
    expect(shouldUseCachedUser(new ApiTimeoutError())).toBe(true);
  });

  it('trusts the cache on a network failure even while navigator.onLine reports true', () => {
    // Regression for the 2026-09-11 audit finding: fetch throws a plain
    // TypeError when the server is unreachable (dead backend, DNS hiccup,
    // VPN drop) even though the device itself has a live network link, so
    // navigator.onLine alone is not a reliable signal here.
    expect(shouldUseCachedUser(new TypeError('Failed to fetch'))).toBe(true);
  });
});
