// Tiny helpers for persisting per-page UI state (filters, open modal, etc.)
// across a navigate-away-and-back round trip, same sessionStorage approach
// as useScrollRestoration. Wrapped in try/catch since sessionStorage can
// throw in some privacy modes — losing restored state is harmless, never
// worth crashing the page over.
export function saveSessionState(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function loadSessionState<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
