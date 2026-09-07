import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Employee, CreateMovementResponse, MovementType } from '../types';
import { enqueueMovement, listPendingMovements, removePendingMovement } from '../offline/movementQueue';
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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [pendingCount, setPendingCount] = useState(0);
  const [confirmDialog, setConfirmDialog] = useState<{ movementType: MovementType; lastType: MovementType } | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

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
    refreshPendingCount();
    if (isOnline) {
      void syncPending();
    }
  }, [isOnline]);

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

  async function refreshPendingCount() {
    const pending = await listPendingMovements();
    setPendingCount(pending.length);
  }

  async function syncPending() {
    const pending = await listPendingMovements();
    for (const item of pending) {
      try {
        // A movement queued while offline was never actually confirmed
        // against the duplicate-check (that requires a server round trip,
        // impossible offline) — item.confirmed is always false at this
        // point. If the server now reports requiresConfirmation, retry
        // once with confirmed:true rather than leaving it stuck in the
        // queue forever with no UI to ever resolve it: the guard's
        // original tap while offline is the only signal of intent
        // available during a background sync. Found in the 2026-09-04
        // audit — the previous code never handled this response shape at
        // all, so a genuinely duplicate offline tap silently never synced.
        let res = await api.post<CreateMovementResponse>('/movements', {
          employeeId: item.employeeId,
          movementType: item.movementType,
          confirmed: item.confirmed ?? false,
        });
        if (res.requiresConfirmation) {
          res = await api.post<CreateMovementResponse>('/movements', {
            employeeId: item.employeeId,
            movementType: item.movementType,
            confirmed: true,
          });
        }
        if (res.created) {
          await removePendingMovement(item.localId);
        }
      } catch {
        // stays queued; will retry on next sync trigger
      }
    }
    await refreshPendingCount();
  }

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
  }

  async function handleMovement(movementType: MovementType, confirmed = false) {
    if (!selected) return;

    if (!isOnline) {
      // Never falsely report success — the queued state is shown distinctly
      // from a confirmed save (spec §52, decided deliberately).
      await enqueueMovement({
        employeeId: selected.id,
        employeeName: selected.employeeName,
        movementType,
        confirmed,
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
        // Network failure (fetch threw) — queue it instead of losing the tap.
        await enqueueMovement({
          employeeId: selected.id,
          employeeName: selected.employeeName,
          movementType,
          confirmed,
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
                    <div className="result-meta">{emp.employeeCode}</div>
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
          <div className="empty-hint">Type a name, employee ID, or email to get started.</div>
        </div>
      )}

      {selected && (
        <>
          <div className="selected-employee-card">
            <div className="avatar">{initials(selected.employeeName)}</div>
            <div className="name">{selected.employeeName}</div>
            <div className="code">Employee ID: {selected.employeeCode}</div>
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
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-icon">
              <IconAlertTriangle />
            </div>
            <p>
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
