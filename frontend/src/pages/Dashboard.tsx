import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Employee, MovementRecord, MovementType } from '../types';
import { IconGrid, IconUsers, IconEntry, IconExit, IconInbox, IconChevronRight, IconDoorOpen, IconX } from '../components/icons';
import { AdminNav } from '../components/AdminNav';
import { TableSkeleton } from '../components/TableSkeleton';
import { OfflineBadge } from '../components/OfflineBadge';
import { WelcomeBanner } from '../components/WelcomeBanner';
import { useAuth } from '../auth/useAuth';
import { todayIso, isoDaysAgo, formatTime } from '../utils/date';

type SummaryCardKind = 'employees' | 'entries' | 'exits' | 'inside';

export function getSummaryModalRows(kind: SummaryCardKind, records: MovementRecord[]): MovementRecord[] {
  const sorted = [...records].sort((a, b) => new Date(a.movementAt).getTime() - new Date(b.movementAt).getTime());

  if (kind === 'employees') {
    const latestByEmployee = new Map<number, MovementRecord>();
    for (const record of sorted) {
      latestByEmployee.set(record.employeeId, record);
    }
    return [...latestByEmployee.values()];
  }

  if (kind === 'entries') {
    return records.filter((record) => record.movementType === 'ENTRY');
  }

  if (kind === 'exits') {
    return records.filter((record) => record.movementType === 'EXIT');
  }

  const latestByEmployee = new Map<number, MovementRecord>();
  for (const record of sorted) {
    latestByEmployee.set(record.employeeId, record);
  }
  return [...latestByEmployee.values()].filter((record) => record.movementType === 'ENTRY');
}

// Who the summary cards' detail drill-down is for — Security already sees
// the same underlying movement data in the table further down this same
// page (both roles hold VIEW_DASHBOARD), so this isn't hiding data Security
// couldn't otherwise reach; it's a deliberate UI restriction, by request
// (2026-09-28), to keep the guard-facing view simpler.
function canViewSummaryDetails(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'HR';
}

export function Dashboard() {
  const { user } = useAuth();
  const [date, setDate] = useState(todayIso());
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [employeeResults, setEmployeeResults] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [movementType, setMovementType] = useState<'' | MovementType>('');
  const [records, setRecords] = useState<MovementRecord[]>([]);
  // Distinguishes "haven't heard back yet" from "heard back, genuinely
  // empty" — without this, the empty state briefly flashes on every
  // navigation/filter change before the fetch resolves, since `records`
  // starts as [] either way (found in the 2026-09-09 audit).
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [summary, setSummary] = useState<{ totalEmployees: number; totalEntries: number; totalExits: number; currentlyInside: number } | null>(null);
  // See the matching comment in SecurityHome.tsx — tracks dropdown
  // visibility separately from `employeeResults` so a click outside the
  // search box can close it. Found in the 2026-09-21 audit.
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const employeeSearchRef = useRef<HTMLDivElement>(null);

  // Detail drill-down for a summary card — a fresh, unfiltered fetch for
  // the selected date, independent of whatever employee/movement-type
  // filter is currently applied to the table below. The summary counts
  // themselves (from /dashboard/summary) are always for the whole day
  // regardless of those filters, so the drill-down list must be too, or
  // the modal's rows wouldn't add up to the number the user just clicked.
  const [summaryModal, setSummaryModal] = useState<SummaryCardKind | null>(null);
  const [summaryModalRecords, setSummaryModalRecords] = useState<MovementRecord[]>([]);
  const [summaryModalLoading, setSummaryModalLoading] = useState(false);
  const summaryModalCloseRef = useRef<HTMLButtonElement>(null);
  const summaryModalRef = useRef<HTMLDivElement>(null);
  // Guards against a slower response for an earlier-opened card landing
  // after a faster response for one opened right after it, overwriting the
  // modal with the wrong list — same monotonic-sequence pattern already
  // used for every debounced search in this app (employee search, audit
  // log, etc.). Found while self-reviewing this change before commit.
  const summaryModalSeqRef = useRef(0);

  const isToday = date === todayIso();

  function openSummaryModal(kind: SummaryCardKind) {
    setSummaryModal(kind);
    setSummaryModalLoading(true);
    const seq = ++summaryModalSeqRef.current;
    api
      .get<MovementRecord[]>(`/movements?date=${date}`)
      .then((res) => {
        if (seq === summaryModalSeqRef.current) setSummaryModalRecords(res);
      })
      .catch(() => {
        if (seq === summaryModalSeqRef.current) setSummaryModalRecords([]);
      })
      .finally(() => {
        if (seq === summaryModalSeqRef.current) setSummaryModalLoading(false);
      });
  }

  useEffect(() => {
    if (summaryModal) summaryModalCloseRef.current?.focus();
    if (!summaryModal) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSummaryModal(null);
      if (event.key === 'Tab') {
        const focusable = summaryModalRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
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
  }, [summaryModal]);

  const summaryModalConfig: Record<SummaryCardKind, { title: string; rows: MovementRecord[]; showTime: boolean }> = {
    employees: { title: 'Total Employees', rows: getSummaryModalRows('employees', summaryModalRecords), showTime: false },
    entries: { title: 'Total Entries', rows: getSummaryModalRows('entries', summaryModalRecords), showTime: true },
    exits: { title: 'Total Exits', rows: getSummaryModalRows('exits', summaryModalRecords), showTime: true },
    inside: { title: isToday ? 'Currently Inside' : 'Not Exited By End Of Day', rows: getSummaryModalRows('inside', summaryModalRecords), showTime: true },
  };

  useEffect(() => {
    api
      .get<{ totalEmployees: number; totalEntries: number; totalExits: number; currentlyInside: number }>(`/dashboard/summary?date=${date}`)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [date]);

  useEffect(() => {
    setRecordsLoading(true);
    const params = new URLSearchParams({ date });
    if (selectedEmployee) params.set('employeeId', String(selectedEmployee.id));
    if (movementType) params.set('movementType', movementType);
    api
      .get<MovementRecord[]>(`/movements?${params.toString()}`)
      .then(setRecords)
      .catch(() => setRecords([]))
      .finally(() => setRecordsLoading(false));
  }, [date, selectedEmployee, movementType]);

  // A blank query returns a browse list of the first 10 active employees
  // (backend change, 2026-09-21) instead of nothing, so the dropdown shows
  // something as soon as the field is focused rather than only once
  // something's been typed. onFocus (below) covers re-focusing an already-
  // empty field, which this effect alone can't detect since the query
  // value hasn't changed.
  // Guards against a slower response for an earlier query landing after a
  // faster response for a newer one, flashing stale results. Found in the
  // 2026-09-25 audit.
  const employeeSearchSeqRef = useRef(0);

  const fetchEmployeeResults = useCallback((q: string) => {
    const seq = ++employeeSearchSeqRef.current;
    api
      .get<Employee[]>(`/employees/search?q=${encodeURIComponent(q)}`)
      .then((res) => {
        if (seq === employeeSearchSeqRef.current) setEmployeeResults(res);
      })
      .catch(() => {
        if (seq === employeeSearchSeqRef.current) setEmployeeResults([]);
      });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchEmployeeResults(employeeQuery), employeeQuery.trim() ? 250 : 0);
    return () => clearTimeout(t);
  }, [employeeQuery, fetchEmployeeResults]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const closeIfOutside = (event: MouseEvent) => {
      if (employeeSearchRef.current && !employeeSearchRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', closeIfOutside);
    return () => document.removeEventListener('mousedown', closeIfOutside);
  }, [dropdownOpen]);

  return (
    <div className="page-wide">
      <AdminNav />
      <WelcomeBanner />

      <div className="page-heading">
        <IconGrid />
        Dashboard
      </div>

      {summary && (
        <div className="summary-cards summary-cards-4">
          {(
            [
              { kind: 'employees' as const, icon: <IconUsers />, value: summary.totalEmployees, label: 'Total Employees', highlight: false },
              { kind: 'entries' as const, icon: <IconEntry style={{ color: 'var(--entry-green)' }} />, value: summary.totalEntries, label: 'Total Entries', highlight: false },
              { kind: 'exits' as const, icon: <IconExit style={{ color: 'var(--exit-red)' }} />, value: summary.totalExits, label: 'Total Exits', highlight: false },
              {
                kind: 'inside' as const,
                icon: <IconDoorOpen style={{ color: 'var(--brand)' }} />,
                value: summary.currentlyInside,
                label: isToday ? 'Currently Inside' : 'Not Exited By End Of Day',
                highlight: true,
              },
            ]
          ).map((card) =>
            canViewSummaryDetails(user?.role) ? (
              <button
                key={card.kind}
                type="button"
                className={`summary-card clickable ${card.highlight ? 'highlight' : ''}`}
                onClick={() => openSummaryModal(card.kind)}
              >
                {card.icon}
                <div className="value">{card.value}</div>
                <div className="label">{card.label}</div>
              </button>
            ) : (
              <div key={card.kind} className={`summary-card ${card.highlight ? 'highlight' : ''}`}>
                {card.icon}
                <div className="value">{card.value}</div>
                <div className="label">{card.label}</div>
              </div>
            ),
          )}
        </div>
      )}

      {summaryModal && (
        <div className="modal-overlay" role="presentation">
          <div
            ref={summaryModalRef}
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="summary-modal-title"
            style={{ textAlign: 'left', maxWidth: 440, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
          >
            <h3 id="summary-modal-title" style={{ marginTop: 0, textAlign: 'center' }}>
              {summaryModalConfig[summaryModal].title}
            </h3>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 12 }}>
              {new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(date))}
            </div>

            {summaryModalLoading && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <span className="spinner dark" />
              </div>
            )}

            {!summaryModalLoading && summaryModalConfig[summaryModal].rows.length === 0 && (
              <div className="empty-state" style={{ padding: '16px 0' }}>
                <IconInbox />
                <div className="empty-title">Nobody here</div>
              </div>
            )}

            {!summaryModalLoading && summaryModalConfig[summaryModal].rows.length > 0 && (
              <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {summaryModalConfig[summaryModal].rows.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: '#f4f7f6',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{r.employee?.employeeName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.employee?.employeeCode}</div>
                      {r.recordedBy?.name && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Recorded by: {r.recordedBy.name}</div>
                      )}
                    </div>
                    {summaryModalConfig[summaryModal].showTime && (
                      <span className={`movement-badge ${r.movementType}`} style={{ whiteSpace: 'nowrap' }}>
                        {formatTime(r.movementAt)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button ref={summaryModalCloseRef} type="button" className="cancel-btn" onClick={() => setSummaryModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="filters-bar">
        <div className="field">
          <label>
            Date
            <div className="date-quick-row">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <button type="button" className={`quick-date-btn ${date === todayIso() ? 'active' : ''}`} onClick={() => setDate(todayIso())}>
                Today
              </button>
              <button type="button" className={`quick-date-btn ${date === isoDaysAgo(1) ? 'active' : ''}`} onClick={() => setDate(isoDaysAgo(1))}>
                Yesterday
              </button>
            </div>
          </label>
        </div>
        <div className="field" style={{ position: 'relative' }}>
          <label>Employee</label>
          {selectedEmployee ? (
            <div className="filter-chip">
              <span>
                {selectedEmployee.employeeName}
                {selectedEmployee.carNumber ? ` · ${selectedEmployee.carNumber}` : ''}
              </span>
              <button type="button" onClick={() => setSelectedEmployee(null)} aria-label="Clear employee filter">
                <IconX />
              </button>
            </div>
          ) : (
            <div style={{ position: 'relative' }} ref={employeeSearchRef}>
              <input
                aria-label="Search dashboard employees by name, employee code, email, or car number"
                placeholder="All Employees"
                value={employeeQuery}
                onChange={(e) => setEmployeeQuery(e.target.value)}
                onFocus={() => {
                  setDropdownOpen(true);
                  fetchEmployeeResults(employeeQuery);
                }}
                style={{ paddingRight: employeeQuery ? 36 : undefined }}
              />
              {employeeQuery && (
                <button type="button" className="search-clear-btn" onClick={() => setEmployeeQuery('')} aria-label="Clear employee search">
                  <IconX />
                </button>
              )}
              {dropdownOpen && employeeResults.length > 0 && (
                <div className="search-results">
                  {employeeResults.map((emp) => (
                    <button
                      key={emp.id}
                      onClick={() => {
                        setSelectedEmployee(emp);
                        setEmployeeQuery('');
                        setEmployeeResults([]);
                        setDropdownOpen(false);
                      }}
                    >
                      <span className="result-text">
                        <div className="result-name">{emp.employeeName}</div>
                        <div className="result-meta">{emp.employeeCode}</div>
                        {emp.carNumber && <div className="result-meta">Car: {emp.carNumber}</div>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="field">
          <label>
            Movement
            <select value={movementType} onChange={(e) => setMovementType(e.target.value as any)}>
              <option value="">All</option>
              <option value="ENTRY">ENTRY</option>
              <option value="EXIT">EXIT</option>
            </select>
          </label>
        </div>
        {selectedEmployee && (
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Link
              className="dashboard-button"
              to={`/employee-details?employeeId=${selectedEmployee.id}&date=${date}`}
            >
              View Employee Day
              <IconChevronRight />
            </Link>
          </div>
        )}
      </div>

      {recordsLoading && records.length === 0 && <TableSkeleton columns={5} />}

      {records.length > 0 && (
        <>
          <table className="records-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>Time</th>
                <th>Movement</th>
                <th>Recorded By</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link className="employee-name-link" to={`/employee-details?employeeId=${r.employeeId}&date=${date}`}>
                      {r.employee?.employeeName}
                    </Link>
                  </td>
                  <td>{new Date(r.movementAt).toLocaleDateString('en-IN')}</td>
                  <td>
                    {formatTime(r.movementAt)}
                    {r.recordedOffline && <OfflineBadge />}
                  </td>
                  <td><span className={`movement-badge ${r.movementType}`}>{r.movementType}</span></td>
                  <td>{r.recordedBy?.name}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="record-cards">
            {records.map((r) => (
              <div className="record-card" key={r.id}>
                <div>
                  <Link className="employee-name-link" to={`/employee-details?employeeId=${r.employeeId}&date=${date}`}>
                    <strong>{r.employee?.employeeName}</strong>
                  </Link>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    {new Date(r.movementAt).toLocaleString('en-IN')}
                    {r.recordedOffline && <OfflineBadge />}
                  </div>
                </div>
                <span className={`movement-badge ${r.movementType}`}>{r.movementType}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {!recordsLoading && records.length === 0 && (
        <div className="empty-state">
          <IconInbox />
          <div className="empty-title">{selectedEmployee || movementType ? 'No matches for this filter' : 'No movements recorded for this date'}</div>
          <div className="empty-hint">
            {selectedEmployee || movementType
              ? 'Try a different employee, movement type, or clear the filters above.'
              : isToday
                ? 'Nothing has been recorded yet today — check back once a guard records an entry or exit.'
                : 'Try a different date.'}
          </div>
        </div>
      )}
    </div>
  );
}
