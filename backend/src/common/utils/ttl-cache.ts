// A minimal in-memory TTL cache — no eviction beyond expiry (no LRU, no
// size cap). Safe for this app's use because the key space is small and
// bounded (a handful of date-range presets x a few filter combinations),
// not unbounded user input, and because Render currently runs this app as
// a single process (WEB_CONCURRENCY=1) — a multi-instance deployment would
// need a shared cache (Redis) instead, since each instance would otherwise
// serve a different cached view. Added 2026-10-15, to relieve Insights'
// summary endpoint on the free tier's very limited CPU (0.1 vCPU) —
// repeat/overlapping requests for the same filters (e.g. the page's own
// Department Comparison fetch alongside the main summary fetch) hit the
// cache instead of recomputing.
// ponytail: plain Map with lazy expiry-on-read, add real eviction/sizing
// if this ever needs to handle a genuinely unbounded key space.
export class TtlCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}
