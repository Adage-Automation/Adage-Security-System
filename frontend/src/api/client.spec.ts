// testEnvironment is 'node' (see jest.config.js) — no jsdom, so `window`
// isn't a real browser global here. Stubbed just enough to verify the
// redirect call itself, not real navigation.
(global as any).window = { location: { assign: jest.fn() } };

import { api, ApiError, redirectOnSessionExpired } from './client';

describe('api client — 401 session-expiry redirect', () => {
  beforeEach(() => {
    (global as any).window.location.assign = jest.fn();
    (global as any).fetch = jest.fn();
  });

  it('redirects to /login on a 401 from an ordinary authenticated endpoint', async () => {
    (global as any).fetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'Not authenticated' }),
    });

    await expect(api.get('/employees')).rejects.toThrow(ApiError);
    expect(window.location.assign).toHaveBeenCalledWith('/login');
  });

  it('does not redirect on a 401 from /auth/login (lets Login.tsx show its own message)', async () => {
    (global as any).fetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'Invalid username or password' }),
    });

    await expect(api.post('/auth/login', { username: 'x', password: 'y' })).rejects.toThrow(ApiError);
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('does not redirect on a 401 from /auth/me (AuthContext/ProtectedRoute already handle it)', async () => {
    (global as any).fetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'Not authenticated' }),
    });

    await expect(api.get('/auth/me')).rejects.toThrow(ApiError);
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it('does not redirect on a non-401 error', async () => {
    (global as any).fetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ message: 'Forbidden' }),
    });

    await expect(api.get('/employees')).rejects.toThrow(ApiError);
    expect(window.location.assign).not.toHaveBeenCalled();
  });
});

// The raw-fetch binary download/upload call sites in Employees.tsx
// (export, import-template, import) can't go through request() above —
// they need blob/FormData handling instead of this module's always-JSON
// wrapper — so they call this exported helper directly instead. Covered
// here as the same shared logic `request()` uses internally.
describe('redirectOnSessionExpired', () => {
  beforeEach(() => {
    (global as any).window.location.assign = jest.fn();
  });

  it('redirects on a 401 for a plain path with no exclusion', () => {
    redirectOnSessionExpired(401, '/employees/export');
    expect(window.location.assign).toHaveBeenCalledWith('/login');
  });

  it('redirects on a 401 even with no path given (the default for these raw-fetch callers)', () => {
    redirectOnSessionExpired(401);
    expect(window.location.assign).toHaveBeenCalledWith('/login');
  });

  it('does not redirect on a non-401 status', () => {
    redirectOnSessionExpired(403, '/employees/export');
    expect(window.location.assign).not.toHaveBeenCalled();
  });
});
