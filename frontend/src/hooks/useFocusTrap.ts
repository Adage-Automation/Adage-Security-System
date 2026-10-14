import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Standard modal accessibility behavior: focuses `initialFocusRef` when the
 * modal opens, traps Tab/Shift+Tab inside `containerRef`, and calls
 * `onEscape` on Escape. Previously copy-pasted near-identically into every
 * modal in the app (Corrections, Employees x2, Users, Dashboard,
 * SecurityHome, Insights x2) — extracted 2026-10-14.
 *
 * `onEscape` is called unconditionally on Escape; a caller that needs to
 * block closing (e.g. while a save is in flight) does that inside its own
 * callback (`() => { if (!saving) close(); }`) rather than this hook taking
 * on that logic itself.
 */
export function useFocusTrap(isOpen: boolean, containerRef: RefObject<HTMLElement>, initialFocusRef: RefObject<HTMLElement>, onEscape: () => void) {
  // Separate from the Escape/Tab listener below so a re-render while the
  // modal is already open (which recreates `onEscape` and re-subscribes
  // that listener) never steals focus back from whatever the user is
  // currently interacting with inside the modal.
  useEffect(() => {
    if (isOpen) initialFocusRef.current?.focus();
  }, [isOpen, initialFocusRef]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
      if (event.key === 'Tab') {
        const focusable = containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onEscape, containerRef]);
}
