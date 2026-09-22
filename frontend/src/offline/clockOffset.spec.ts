import { correctedNow, recordServerTime } from './clockOffset';

// jest.config.js runs this suite under testEnvironment: 'node' (no DOM),
// so localStorage isn't a global here the way it is in a real browser —
// a minimal in-memory shim is enough for what clockOffset.ts actually
// calls (getItem/setItem).
function installLocalStorageShim() {
  const store = new Map<string, string>();
  (global as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    clear: () => store.clear(),
  };
}

describe('clockOffset', () => {
  beforeEach(() => {
    installLocalStorageShim();
  });

  it('returns the raw device clock when no calibration has ever happened', () => {
    const before = Date.now();
    const now = correctedNow();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after + 1);
  });

  it('corrects the device clock once calibrated against a server time', () => {
    // Server says it's 10 minutes ahead of this device.
    const deviceNow = Date.now();
    const serverTime = new Date(deviceNow + 10 * 60 * 1000).toISOString();
    recordServerTime(serverTime, deviceNow, deviceNow);

    const corrected = correctedNow();
    // Should be ~10 minutes ahead of the raw device clock (within a
    // small tolerance for test execution time).
    expect(corrected - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    expect(corrected - Date.now()).toBeLessThan(11 * 60 * 1000);
  });

  it('ignores a malformed server time instead of corrupting the offset', () => {
    recordServerTime('not-a-date', Date.now(), Date.now());
    const now = correctedNow();
    expect(Math.abs(now - Date.now())).toBeLessThan(1000);
  });
});
