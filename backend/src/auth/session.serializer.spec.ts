import { SessionSerializer } from './session.serializer';

describe('SessionSerializer.deserializeUser', () => {
  const authService = { findAuthenticatedUserById: jest.fn() };
  const serializer = new SessionSerializer(authService as any);

  beforeEach(() => jest.clearAllMocks());

  it('calls done with the user on success', async () => {
    const user = { id: 1, name: 'Test User' };
    authService.findAuthenticatedUserById.mockResolvedValue(user);
    const done = jest.fn();

    await serializer.deserializeUser(1, done);

    expect(done).toHaveBeenCalledWith(null, user);
  });

  it('calls done with false (not an error) when the user is gone/deactivated', async () => {
    authService.findAuthenticatedUserById.mockResolvedValue(null);
    const done = jest.fn();

    await serializer.deserializeUser(1, done);

    expect(done).toHaveBeenCalledWith(null, false);
  });

  // This runs on every authenticated request via Passport's session
  // middleware, outside Nest's normal controller/exception-filter
  // pipeline — before this fix, a thrown error here (e.g. a DB
  // connectivity/connection-pool failure) was an unhandled rejection that
  // crashed the entire backend process, confirmed twice in production
  // (2026-10-14). It must surface as a normal failed request instead.
  it('calls done with the error instead of throwing, when the DB call fails', async () => {
    const dbError = new Error('Timed out fetching a new connection from the connection pool');
    authService.findAuthenticatedUserById.mockRejectedValue(dbError);
    const done = jest.fn();

    await expect(serializer.deserializeUser(1, done)).resolves.toBeUndefined();

    expect(done).toHaveBeenCalledWith(dbError);
  });
});
