import { useEffect, useRef } from 'react';

/**
 * Restores window scroll position when navigating back to a list page
 * (e.g. Dashboard -> employee details -> back to Dashboard), instead of
 * always landing at the top. Plain BrowserRouter has no built-in scroll
 * restoration, so this does it manually via sessionStorage.
 *
 * `ready` should be true once the page's content has actually rendered
 * (e.g. after the initial fetch resolves) — restoring before then would
 * try to scroll into content that doesn't exist yet and silently clamp to 0.
 */
export function useScrollRestoration(key: string, ready: boolean) {
  const restored = useRef(false);

  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    // sessionStorage can throw in some privacy modes — losing restored
    // scroll position is harmless, never worth crashing the page over.
    try {
      const saved = sessionStorage.getItem(`scroll:${key}`);
      if (saved) window.scrollTo(0, Number(saved));
    } catch {
      /* ignore */
    }
  }, [key, ready]);

  useEffect(() => {
    const onScroll = () => {
      try {
        sessionStorage.setItem(`scroll:${key}`, String(window.scrollY));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [key]);
}
