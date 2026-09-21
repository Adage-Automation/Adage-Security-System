import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { isServerReachable } from '../api/health';
import { useAuth } from '../auth/useAuth';
import { Employee, CreateMovementResponse, MovementType } from '../types';
import { enqueueMovement, listPendingMovements, removePendingMovement, updatePendingMovement } from '../offline/movementQueue';
import {
  IconSearch,
  IconEntry,
  IconExit,
  IconGrid,
  IconCheckCircle,
  IconAlertTriangle,
  IconClock,
  IconXCircle,
  IconUserSearch,
  IconWifiOff,
  IconCalendar,
  IconX,
} from '../components/icons';

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; movementType: MovementType; employeeName: string; time: string }
  | { kind: 'pending-sync'; movementType: MovementType; employeeName: string }
  | { kind: 'error'; message: string };

export function SecurityHome() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [conflicts, setConflicts] = useState<Awaited<ReturnType<typeof listPendingMovements>>>([]);
  const [confirmDialog, setConfirmDialog] = useState<{ movementType: MovementType; lastType: MovementType } | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  // navigator.onLine only tells us the link is up, not that the server is
  // actually reachable (dead backend, DNS hiccup, captive portal all still
  // report true) — see api/health.ts. Optimistic true so the banner doesn't
  // flash on first render before the initial check resolves.
  const [serverReachable, setServerReachable] = useState(true);
  const isEffectivelyOnline = isOnline && serverReachable;
  const [searchError, setSearchError] = useState<string | null>(null);
  // Guards against a double-tap firing two concurrent createMovement calls
  // (each with its own fresh idempotency key, since each is a genuinely new
  // tap) — without this, a guard double-tapping on a slow connection could
  // create two real duplicate ENTRY/EXIT records. Found in the 2026-09-21
  // audit.
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  // Tracks whether the browse/search dropdown is open, independent of
  // whether `results` has anything in it — without this, clicking outside
  // the search box couldn't close the dropdown (results stayed populated),
  // and it covered the rest of the page until a result was picked. Found
  // in the 2026-09-21 audit.
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  // One id per guard tap, reused across that tap's retries (the confirm-
  // resubmit, and the offline queue's sync) so the server can recognize a
  // retry of an already-succeeded request instead of creating a duplicate
  // — see the clientRequestId comment in schema.prisma. Regenerated only
  // on a fresh tap (confirmed=false), never on a confirm-resubmit.
  const pendingRequestIdRef = useRef<string | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const confirmDialogRef = useRef<HTMLDivElement>(null);

  const today = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => {
      setIsOnline(false);
      setServerReachable(true); // link is the known problem; don't also show a stale "server unreachable" state
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Periodic real reachability check, independent of the browser's
  // online/offline events (which never fire for "link is fine, server/DB is
  // down or unreachable"). Only runs while the link itself is up — no point
  // pinging a server we already know we can't reach at the network layer.
  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;
    const check = () => {
      void isServerReachable().then((reachable) => {
        if (!cancelled) setServerReachable(reachable);
      });
    };
    check();
    const interval = setInterval(check, 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOnline]);

  // Extracted so it can be called both from the debounced typing effect
  // below and immediately on focus (see the search input's onFocus) — a
  // blank query now returns a browse list of the first 10 active
  // employees (backend change, 2026-09-21) instead of nothing, so tapping
  // the empty search box shows something right away instead of looking
  // unresponsive until the guard starts typing.
  const fetchResults = useCallback(async (q: string) => {
    try {
      const res = await api.get<Employee[]>(`/employees/search?q=${encodeURIComponent(q)}`);
      setResults(res);
      setSearchError(null);
    } catch {
      // Previously swallowed into an empty result list, indistinguishable
      // from "no such employee" — a guard on a flaky connection could
      // wrongly conclude someone isn't registered. Found in the
      // 2026-09-21 audit.
      setResults([]);
      setSearchError(q.trim() ? 'Search failed — check your connection and try again.' : null);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Blank query still fetches (the browse list) but with no debounce
    // delay — only actual typing needs the 250ms settle time.
    debounceRef.current = setTimeout(() => void fetchResults(query), query.trim() ? 250 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchResults]);

  const refreshPendingCount = useCallback(async () => {
    if (!user) return;
    const pending = await listPendingMovements(user.id);
    setPendingCount(pending.length);
    const conflictItems = pending
      .filter((item) => item.syncState === 'conflict')
      .sort((a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime());
    setConflicts(conflictItems);
    setConflictCount(conflictItems.length);
  }, [user]);

  const syncPending = useCallback(async () => {
    if (!user) return;
    const pending = await listPendingMovements(user.id);
    for (const item of pending) {
      if (item.syncState === 'conflict') continue;
      try {
        // A movement queued while offline was never actually confirmed
        // against the duplicate-check (that requires a server round trip,
        // impossible offline) — item.confirmed is always false at this
        // point. If the server now reports requiresConfirmation, retry
        // once with confirmed:true rather than leaving it stuck in the
        // queue forever with no UI to ever resolve it: the guard's
        // original tap while offline is the only signal of intent
        // available during a background sync. Found in the 2026-09-04
        // audit — a duplicate response is now kept as an explicit conflict
        // for review instead of being silently auto-confirmed.
        const res = await api.post<CreateMovementResponse>('/movements', {
          employeeId: item.employeeId,
          movementType: item.movementType,
          confirmed: item.confirmed ?? false,
          clientRequestId: item.clientRequestId,
        });
        if (res.requiresConfirmation) {
          await updatePendingMovement(item.localId, {
            syncState: 'conflict',
            conflictReason: 'A newer movement already exists for this employee.',
          });
          continue;
        }
        if (res.created) {
          await removePendingMovement(item.localId);
        }
      } catch {
        // stays queued; will retry on next sync trigger
      }
    }
    await refreshPendingCount();
  }, [refreshPendingCount, user]);

  async function resolveConflict(localId: string) {
    const item = conflicts.find((candidate) => candidate.localId === localId);
    if (!item) return;

    try {
      const result = await api.post<CreateMovementResponse>('/movements', {
        employeeId: item.employeeId,
        movementType: item.movementType,
        confirmed: true,
        clientRequestId: item.clientRequestId,
      });
      if (result.created) await removePendingMovement(item.localId);
      await refreshPendingCount();
    } catch {
      setStatus({ kind: 'error', message: 'Unable to resolve this offline conflict. It remains queued.' });
    }
  }

  async function dismissConflict(localId: string) {
    try {
      await removePendingMovement(localId);
      await refreshPendingCount();
    } catch {
      setStatus({ kind: 'error', message: 'Unable to dismiss this offline conflict. Please try again.' });
    }
  }

  useEffect(() => {
    void refreshPendingCount();
    if (isEffectivelyOnline) void syncPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEffectivelyOnline, refreshPendingCount, syncPending]);

  // Previously only retried when the browser's online/offline events fired
  // — but those never fire for "link is fine, the server was briefly
  // unreachable when the tap failed and got queued". Without this, a
  // movement queued during a transient server-side blip (not a real link
  // drop) could sit unsynced indefinitely even though the guard's device
  // never actually went offline. Polls only while there's something to
  // sync. Found in the 2026-09-21 audit (offline-queue data-loss review).
  useEffect(() => {
    if (!isEffectivelyOnline || pendingCount === 0) return;
    const interval = setInterval(() => void syncPending(), 20_000);
    return () => clearInterval(interval);
  }, [isEffectivelyOnline, pendingCount, syncPending]);

  // The offline queue lives only in this browser's IndexedDB — clearing
  // site data, uninstalling the PWA, or switching devices before it syncs
  // loses those movements permanently with no server-side trace. This can't
  // be fully eliminated client-side, but a guard is far less likely to do
  // any of that if warned at the moment they'd try to leave/close the page
  // while something is still unsynced. Found in the 2026-09-21 audit.
  useEffect(() => {
    function warnIfPending(e: BeforeUnloadEvent) {
      if (pendingCount === 0) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', warnIfPending);
    return () => window.removeEventListener('beforeunload', warnIfPending);
  }, [pendingCount]);

  // Closes the dropdown on any click/tap outside the search box — without
  // this, clicking elsewhere on the page (or on the Dashboard link right
  // below it) did nothing, leaving the dropdown open over the rest of the
  // screen. Found in the 2026-09-21 audit.
  useEffect(() => {
    if (!dropdownOpen) return;
    const closeIfOutside = (event: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', closeIfOutside);
    return () => document.removeEventListener('mousedown', closeIfOutside);
  }, [dropdownOpen]);

  useEffect(() => {
    if (confirmDialog) confirmButtonRef.current?.focus();
  }, [confirmDialog]);

  useEffect(() => {
    if (!confirmDialog) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmDialog(null);
      if (event.key === 'Tab') {
        const focusable = confirmDialogRef.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
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
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [confirmDialog]);

  function selectEmployee(emp: Employee) {
    setSelected(emp);
    setQuery('');
    setResults([]);
    setSearchError(null);
    setStatus({ kind: 'idle' });
    setDropdownOpen(false);
  }

  function resetSelection() {
    setSelected(null);
    setQuery('');
    setResults([]);
    setSearchError(null);
    pendingRequestIdRef.current = null;
    setDropdownOpen(false);
  }

  async function handleMovement(movementType: MovementType, confirmed = false) {
    if (!selected) return;
    // Blocks a double-tap (impatient guard, slow network, or the 20s
    // timeout window) from firing a second concurrent request — each fresh
    // tap would otherwise get its own idempotency key and neither the
    // dedup nor the duplicate-type check reliably catches two requests
    // racing each other. Found in the 2026-09-21 audit.
    if (submitting) return;

    // A fresh tap (confirmed=false) gets a new id; a confirm-resubmit
    // (confirmed=true, from the modal) reuses the id from the tap that
    // triggered it, so the server can tell they're the same logical
    // request if the first one's response never arrived.
    if (!confirmed || !pendingRequestIdRef.current) {
      pendingRequestIdRef.current = generateRequestId();
    }
    const clientRequestId = pendingRequestIdRef.current;

    setSubmitting(true);
    try {
      if (!isEffectivelyOnline) {
        // Never falsely report success — the queued state is shown distinctly
        // from a confirmed save (spec §52, decided deliberately).
        await enqueueMovement({
          userId: user!.id,
          employeeId: selected.id,
          employeeName: selected.employeeName,
          movementType,
          confirmed,
          clientRequestId,
        });
        await refreshPendingCount();
        setStatus({ kind: 'pending-sync', movementType, employeeName: selected.employeeName });
        setTimeout(resetSelection, 1800);
        return;
      }

      try {
        const res = await api.post<CreateMovementResponse>('/movements', {
          employeeId: selected.id,
          movementType,
          confirmed,
          clientRequestId,
        });

        if (res.requiresConfirmation && res.lastMovementType) {
          setConfirmDialog({ movementType, lastType: res.lastMovementType });
          return;
        }

        const time = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).format(
          new Date(res.record!.movementAt),
        );
        setStatus({ kind: 'success', movementType, employeeName: selected.employeeName, time });
        setTimeout(resetSelection, 1800);
      } catch (err) {
        if (err instanceof ApiError) {
          setStatus({ kind: 'error', message: 'Unable to save record. Please check the connection and try again.' });
        } else {
          // Network failure (fetch threw) — queue it instead of losing the
          // tap. Carries the same clientRequestId as this attempt: if the
          // request actually reached the server and committed before the
          // connection dropped, the eventual sync retry will be recognized
          // as a replay instead of creating a duplicate record.
          await enqueueMovement({
            userId: user!.id,
            employeeId: selected.id,
            employeeName: selected.employeeName,
            movementType,
            confirmed,
            clientRequestId,
          });
          await refreshPendingCount();
          setStatus({ kind: 'pending-sync', movementType, employeeName: selected.employeeName });
          setTimeout(resetSelection, 1800);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="date-heading">
        <IconCalendar />
        {today}
      </div>

      {!isEffectivelyOnline && (
        <div className="status-banner pending" role="status" aria-live="polite">
          <IconWifiOff />
          {isOnline
            ? 'The server is unreachable right now. Records will be saved once connection returns.'
            : 'You are offline. Records will be saved once connection returns.'}
        </div>
      )}

      {conflictCount > 0 && (
        <div className="status-banner error" role="alert" aria-live="assertive">
          {conflictCount} offline movement{conflictCount === 1 ? '' : 's'} need review because a newer record exists.
          {conflicts.map((item) => (
            <div key={item.localId} style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span>
                {item.employeeName} · {item.movementType}
                {item.conflictReason ? ` — ${item.conflictReason}` : ''}
              </span>
              <button type="button" className="table-action-btn" onClick={() => void resolveConflict(item.localId)}>
                Record anyway
              </button>
              <button type="button" className="table-action-btn" onClick={() => void dismissConflict(item.localId)}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}
      {pendingCount > 0 && (
        <div className="status-banner pending" role="status" aria-live="polite">
          <IconClock />
          {pendingCount} record{pendingCount === 1 ? '' : 's'} pending sync.
        </div>
      )}

      {status.kind === 'success' && (
        <div className="status-banner success" role="status" aria-live="polite">
          <IconCheckCircle />
          <span>
            {status.movementType === 'ENTRY' ? 'Entry' : 'Exit'} Recorded
            <span className="status-detail"> — {status.employeeName}, {status.time}</span>
          </span>
        </div>
      )}
      {status.kind === 'pending-sync' && (
        <div className="status-banner pending" role="status" aria-live="polite">
          <IconClock />
          <span>
            Queued: {status.movementType === 'ENTRY' ? 'Entry' : 'Exit'}
            <span className="status-detail"> — {status.employeeName}, pending sync</span>
          </span>
        </div>
      )}
      {status.kind === 'error' && (
        <div className="status-banner error" role="alert" aria-live="assertive">
          <IconXCircle />
          {status.message}
        </div>
      )}

      {!selected && (
        <div className="search-box" ref={searchBoxRef}>
          <IconSearch className="search-icon" />
          <input
            aria-label="Search employees by name, employee code, email, or car number"
            placeholder="Search employee..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setDropdownOpen(true);
              void fetchResults(query);
            }}
          />
          {query && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => {
                setQuery('');
                setSearchError(null);
              }}
              aria-label="Clear search"
            >
              <IconX />
            </button>
          )}
          {dropdownOpen && results.length > 0 && (
            <div className="search-results">
              {results.map((emp) => (
                <button key={emp.id} onClick={() => selectEmployee(emp)}>
                  <span className="result-avatar">{initials(emp.employeeName)}</span>
                  <span className="result-text">
                    <div className="result-name">{emp.employeeName}</div>
                    <div className="result-meta">
                      {emp.employeeCode}
                      {emp.carNumber ? ` · ${emp.carNumber}` : ''}
                    </div>
                  </span>
                </button>
              ))}
            </div>
          )}
          {dropdownOpen && searchError && (
            <div className="search-results">
              <div className="search-empty error-text">{searchError}</div>
            </div>
          )}
          {dropdownOpen && !searchError && query.trim() && results.length === 0 && (
            <div className="search-results">
              <div className="search-empty">No matching employees found.</div>
            </div>
          )}
        </div>
      )}

      {!selected && !dropdownOpen && !query.trim() && (
        <div className="empty-state">
          <IconUserSearch />
          <div className="empty-title">Search for an employee</div>
          <div className="empty-hint">Type a name, employee ID, email, or car number to get started.</div>
        </div>
      )}

      {selected && (
        <>
          <div className="selected-employee-card">
            <div className="avatar">{initials(selected.employeeName)}</div>
            <div className="name">{selected.employeeName}</div>
            <div className="code">Employee ID: {selected.employeeCode}</div>
            {selected.carNumber && <div className="code">Car Number: {selected.carNumber}</div>}
          </div>

          <div className="action-buttons">
            <button className="big-button entry" onClick={() => void handleMovement('ENTRY')} disabled={submitting}>
              {submitting ? <span className="spinner" /> : <IconEntry />}
              ENTRY
            </button>
            <button className="big-button exit" onClick={() => void handleMovement('EXIT')} disabled={submitting}>
              {submitting ? <span className="spinner" /> : <IconExit />}
              EXIT
            </button>
          </div>

          <button className="dashboard-button" onClick={resetSelection} disabled={submitting} style={{ marginBottom: 12 }}>
            Cancel Selection
          </button>
        </>
      )}

      <Link to="/dashboard" className="dashboard-button">
        <IconGrid />
        DASHBOARD
      </Link>

      {confirmDialog && (
        <div className="modal-overlay" role="presentation">
          <div ref={confirmDialogRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="duplicate-movement-title">
            <div className="modal-icon">
              <IconAlertTriangle />
            </div>
            <p id="duplicate-movement-title">
              This employee was already marked as{' '}
              {confirmDialog.lastType === 'ENTRY' ? 'inside' : 'outside'}.
              <br />
              Do you want to record another {confirmDialog.movementType}?
            </p>
            <div className="modal-actions">
              <button
                className="cancel-btn"
                onClick={() => setConfirmDialog(null)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className="confirm-btn"
                ref={confirmButtonRef}
                disabled={submitting}
                onClick={() => {
                  const { movementType } = confirmDialog;
                  setConfirmDialog(null);
                  void handleMovement(movementType, true);
                }}
              >
                {submitting && <span className="spinner" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
