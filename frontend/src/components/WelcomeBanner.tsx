import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { IconX } from './icons';

const SESSION_FLAG = 'adage.just-logged-in';

const ROLE_HINTS: Record<string, string> = {
  SECURITY: 'Search for an employee below to record their entry or exit.',
  ADMIN: 'Search for an employee below to record a movement, or use the menu above to manage users, employees, and settings.',
  HR: "Here's today's activity — filter by employee or date below, or open an employee's day to email their record.",
};

// Shown once, right after a successful login, on whichever page the guard/
// HR/admin lands on — a quick "you're in, here's what to do" instead of
// landing silently on a screen full of controls with no orientation at
// all. Login.tsx sets the sessionStorage flag right before navigating;
// this reads and clears it on mount so a page refresh or the back button
// never brings it back. Found in the 2026-09-22 UX audit.
export function WelcomeBanner() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_FLAG)) {
        sessionStorage.removeItem(SESSION_FLAG);
        setVisible(true);
      }
    } catch {
      // sessionStorage unavailable — just skip the welcome banner, not worth failing over.
    }
  }, []);

  if (!visible || !user) return null;

  const hint = ROLE_HINTS[user.role] ?? '';

  return (
    <div className="status-banner success" role="status" aria-live="polite" style={{ justifyContent: 'space-between' }}>
      <span>
        <strong>Welcome back, {user.name}.</strong>
        {hint && <span className="status-detail"> {hint}</span>}
      </span>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Dismiss welcome message"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 4, display: 'flex' }}
      >
        <IconX />
      </button>
    </div>
  );
}

export function markJustLoggedIn(): void {
  try {
    sessionStorage.setItem(SESSION_FLAG, '1');
  } catch {
    // Best-effort only — worst case, no welcome banner is shown.
  }
}
