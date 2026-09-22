// A browser has no independent "app clock" — Date.now() always reads the
// device's own OS clock, which can drift or simply be set wrong. This
// module builds a corrected clock on top of it: whenever the app can
// reach the server, it compares the server's reported time (GET
// /api/health) against the device's own clock at that same moment and
// remembers the difference. That offset is then applied to the device
// clock when capturing an offline tap's time (movementQueue.ts), so a
// wrong device clock doesn't corrupt clientMovementAt — see
// docs/decisions.md.
const STORAGE_KEY = 'adage.clock-offset-ms';

function readOffset(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    // localStorage can throw (private browsing, storage disabled) — the
    // safe fallback is "no correction," i.e. trust the device clock as
    // before, not to crash the tap.
    return 0;
  }
}

// Called with the ISO time from a health-check response. Splits the
// request's round-trip in half to estimate when the server's clock
// reading actually corresponds to on the device's own timeline — a
// reasonable approximation for typical mobile-network latency, not lab-
// grade NTP precision, but far better than trusting an unverified device
// clock outright.
export function recordServerTime(serverTimeIso: string, requestStartedAt: number, requestFinishedAt: number): void {
  const serverTimeMs = new Date(serverTimeIso).getTime();
  if (Number.isNaN(serverTimeMs)) return;
  const estimatedLocalTimeAtServerMoment = (requestStartedAt + requestFinishedAt) / 2;
  const offset = serverTimeMs - estimatedLocalTimeAtServerMoment;
  try {
    localStorage.setItem(STORAGE_KEY, String(offset));
  } catch {
    // Not fatal — just means this calibration attempt is lost; the next
    // successful health check tries again.
  }
}

// The device clock, corrected by the last known offset from the server.
// Falls back to the raw device clock (today's behavior) if no
// calibration has ever succeeded — e.g. the very first launch, offline
// before ever reaching the server even once.
export function correctedNow(): number {
  return Date.now() + readOffset();
}
