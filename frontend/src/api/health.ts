// navigator.onLine only reflects the network link layer — a device on
// working Wi-Fi with a captive portal, a dead backend, or a DNS hiccup
// still reports true. This does a real round trip to the backend (with a
// short timeout of its own, independent of the main 20s request timeout)
// so the guard's "offline" banner reflects "can I actually reach the
// server", not just "is the link up". Closes the gap flagged in the
// 2026-09-21 audit — the same class of bug already fixed for auth
// (AuthContext.tsx's shouldUseCachedUser), now given an explicit signal on
// the recording screen too instead of only being discovered by waiting out
// a failed movement submission.
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

export async function isServerReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch('/api/health', { signal: controller.signal, cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
