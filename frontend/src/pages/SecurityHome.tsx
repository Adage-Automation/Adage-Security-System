import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
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
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
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
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.get<Employee[]>(`/employees/search?q=${encodeURIComponent(query)}`);
        setResults(res);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const refreshPendingCount = useCallback(async () => {
    if (!user) return;
    const pending = await listPendingMovements(user.id);
    setPendingCount(pending.length);
    const conflictItems = pending.filter((item) => item.syncState === 'conflict');
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
          await updatePendingMovement(item.localId, { syncState: 'conflict' });
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
    if (!item || !window.confirm(`Record this ${item.movementType} for ${item.employeeName} anyway?`)) return;
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

  useEffect(() => {
    void refreshPendingCount();
    if (isOnline) void syncPending();
  }, [isOnline, refreshPendingCount, syncPending]);

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
    setStatus({ kind: 'idle' });
  }

  function resetSelection() {
    setSelected(null);
    setQuery('');
    setResults([]);
    pendingRequestIdRef.current = null;
  }

  async function handleMovement(movementType: MovementType, confirmed = false) {
    if (!selected) return;

    // A fresh tap (confirmed=false) gets a new id; a confirm-resubmit
    // (confirmed=true, from the modal) reuses the id from the tap that
    // triggered it, so the server can tell they're the same logical
    // request if the first one's response never arrived.
    if (!confirmed || !pendingRequestIdRef.current) {
      pendingRequestIdRef.current = generateRequestId();
    }
    const clientRequestId = pendingRequestIdRef.current;

    if (!isOnline) {
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
  }

  return (
    <div className="page">
      <div className="date-heading">
        <IconCalendar />
        {today}
      </div>

      {!isOnline && (
        <div className="status-banner pending">
          <IconWifiOff />
          You are offline. Records will be saved once connection returns.
        </div>
      )}

      {conflictCount > 0 && (
        <div className="status-banner error" role="alert">
          {conflictCount} offline movement{conflictCount === 1 ? '' : 's'} need review because a newer record exists.
          {conflicts.map((item) => (
            <div key={item.localId} style={{ marginTop: 8 }}>
              {item.employeeName} · {item.movementType}{' '}
              <button type="button" className="table-action-btn" onClick={() => void resolveConflict(item.localId)}>
                Record anyway
              </button>
            </div>
          ))}
        </div>
      )}
      {pendingCount > 0 && (
        <div className="status-banner pending">
          <IconClock />
          {pendingCount} record{pendingCount === 1 ? '' : 's'} pending sync.
        </div>
      )}

      {status.kind === 'success' && (
        <div className="status-banner success">
          <IconCheckCircle />
          <span>
            {status.movementType === 'ENTRY' ? 'Entry' : 'Exit'} Recorded
            <span className="status-detail"> — {status.employeeName}, {status.time}</span>
          </span>
        </div>
      )}
      {status.kind === 'pending-sync' && (
        <div className="status-banner pending">
          <IconClock />
          <span>
            Queued: {status.movementType === 'ENTRY' ? 'Entry' : 'Exit'}
            <span className="status-detail"> — {status.employeeName}, pending sync</span>
          </span>
        </div>
      )}
      {status.kind === 'error' && (
        <div className="status-banner error">
          <IconXCircle />
          {status.message}
        </div>
      )}

      {!selected && (
        <div className="search-box">
          <IconSearch className="search-icon" />
          <input
            aria-label="Search employees by name, employee code, email, or car number"
            placeholder="Search employee..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {results.length > 0 && (
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
          {query.trim() && results.length === 0 && (
            <div className="search-results">
              <div className="search-empty">No matching employees found.</div>
            </div>
          )}
        </div>
      )}

      {!selected && !query.trim() && (
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
            <button className="big-button entry" onClick={() => handleMovement('ENTRY')}>
              <IconEntry />
              ENTRY
            </button>
            <button className="big-button exit" onClick={() => handleMovement('EXIT')}>
              <IconExit />
              EXIT
            </button>
          </div>

          <button className="dashboard-button" onClick={resetSelection} style={{ marginBottom: 12 }}>
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
              >
                Cancel
              </button>
              <button
                className="confirm-btn"
                ref={confirmButtonRef}
                onClick={() => {
                  const { movementType } = confirmDialog;
                  setConfirmDialog(null);
                  void handleMovement(movementType, true);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
