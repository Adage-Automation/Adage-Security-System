import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { Employee, MovementRecord, MovementType } from '../types';
import { IconEdit, IconPlus, IconInbox, IconX, IconCheckCircle, IconChevronRight } from '../components/icons';
import { AdminNav } from '../components/AdminNav';
import { TableSkeleton } from '../components/TableSkeleton';
import { OfflineBadge } from '../components/OfflineBadge';
import { AddedBadge } from '../components/AddedBadge';
import { todayIso, isoDaysAgo, attendanceMonthRange, formatTime, localDateFromIso } from '../utils/date';
import { useFocusTrap } from '../hooks/useFocusTrap';

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

interface EditState {
  movementType: MovementType;
  time: string; // HH:mm
  reason: string;
}

interface MissingRow {
  date: string;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  team: string | null;
  status: 'missingExit' | 'missingEntry';
}

export function Corrections() {
  // Defaults to YESTERDAY, not today: while someone's shift is still in
  // progress, "missing EXIT" is just "hasn't left yet," not a real gap —
  // checking today would bury the genuine misses under everyone still
  // on-site. Yesterday is a settled day, so every one-sided result there
  // is an actual thing to fix. Changed 2026-10-26, by request.
  const [date, setDate] = useState(isoDaysAgo(1));
  // null = plain single-date view (the `date` field above); a number =
  // Attendance Month view, that many cycles from the current one (0 =
  // this cycle, -1 = previous, +1 = next) — same offset convention as
  // Insights' own Attendance Month preset. Picking a date directly always
  // switches this back to null. Added 2026-10-26, by request, replacing
  // the Today/Yesterday quick buttons.
  const [attendanceMonthOffset, setAttendanceMonthOffset] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [records, setRecords] = useState<MovementRecord[]>([]);
  // Distinguishes "haven't heard back yet" from "heard back, genuinely
  // empty" — without this, the empty state briefly flashes on every
  // employee/date change before the fetch resolves (found in the
  // 2026-09-09 audit).
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // See the matching comment in SecurityHome.tsx — tracks dropdown
  // visibility separately from `results` so a click outside the search box
  // can close it. Found in the 2026-09-21 audit.
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  // Guards against a slower response for an earlier-selected employee/date
  // landing after a faster one for whatever's selected now, overwriting
  // the table with the wrong day's records — same pattern as searchSeqRef
  // below. Found in the 2026-10 audit.
  const recordsSeqRef = useRef(0);

  // The date (or whole attendance cycle) actually being queried — same
  // single day repeated as both ends for the plain date view, so the
  // backend only ever needs one code path (`missingInRange`) regardless
  // of which view is active.
  const missingRange = useMemo(() => {
    if (attendanceMonthOffset !== null) {
      const r = attendanceMonthRange(attendanceMonthOffset);
      return { from: r.from, to: r.to, label: r.label };
    }
    return { from: date, to: date, label: date };
  }, [date, attendanceMonthOffset]);

  // Who's missing an ENTRY or EXIT in the selected date/cycle, so nobody's
  // stuck searching employees one at a time to find who actually needs
  // something added. `GET /movements/missing-summary` is scoped to
  // CORRECT_RECORDS specifically (not Insights' VIEW_REPORTS) — this page
  // is now open to Security too (2026-10-26, by request), who hold the
  // former but deliberately not the latter. Added 2026-10-23, by request;
  // widened from a single date to a range (for Attendance Month) the same
  // day.
  const [missingRows, setMissingRows] = useState<MissingRow[]>([]);
  const [missingLoading, setMissingLoading] = useState(true);
  const missingSeqRef = useRef(0);
  // Disables the row being selected (not every row — see the matching
  // Set-based guard in Users.tsx) while its full Employee record loads,
  // and surfaces a failure without silently doing nothing.
  const [selectingId, setSelectingId] = useState<number | null>(null);

  function loadMissing() {
    setMissingLoading(true);
    const seq = ++missingSeqRef.current;
    api
      .get<MissingRow[]>(`/movements/missing-summary?from=${missingRange.from}&to=${missingRange.to}`)
      .then((res) => {
        if (seq === missingSeqRef.current) setMissingRows(res);
      })
      .catch(() => {
        if (seq === missingSeqRef.current) setMissingRows([]);
      })
      .finally(() => {
        if (seq === missingSeqRef.current) setMissingLoading(false);
      });
  }

  useEffect(loadMissing, [missingRange.from, missingRange.to]);

  // In Attendance Month view a row's own date can be any day in the
  // cycle, not whatever the page's single `date` field happens to hold —
  // syncing it here is what makes loadRecords (below) and submitEdit both
  // operate on the right day once an employee is selected from a
  // multi-day list, with no separate "which date is this edit for" state
  // needed. Harmless in plain date-view too, since `row.date` there is
  // just `date` already. Added 2026-10-26, by request, alongside
  // Attendance Month.
  function selectFromMissingList(row: MissingRow) {
    setSelectingId(row.employeeId);
    setError(null);
    setDate(row.date);
    api
      .get<Employee>(`/employees/${row.employeeId}`)
      .then((emp) => setSelected(emp))
      .catch((err: any) => setError(err?.message ?? 'Failed to load this employee. Please try again.'))
      .finally(() => setSelectingId(null));
  }

  // One tap straight to the "Add Missing" form for a row already known to
  // be missing exactly one type — skips the "select, wait for their table
  // to load, then find the Add button below it" detour for the common
  // case where there's nothing to actually review first. Clicking the
  // rest of the row still goes through selectFromMissingList to review
  // their day before adding, for anyone who wants that. Added 2026-10-26,
  // by request.
  function quickAdd(row: MissingRow) {
    setSelectingId(row.employeeId);
    setError(null);
    setDate(row.date);
    api
      .get<Employee>(`/employees/${row.employeeId}`)
      .then((emp) => {
        setSelected(emp);
        setEdit({ movementType: row.status === 'missingExit' ? 'EXIT' : 'ENTRY', time: '09:00', reason: '' });
      })
      .catch((err: any) => setError(err?.message ?? 'Failed to load this employee. Please try again.'))
      .finally(() => setSelectingId(null));
  }

  function loadRecords() {
    if (!selected) return;
    setRecordsLoading(true);
    const seq = ++recordsSeqRef.current;
    api
      .get<MovementRecord[]>(`/movements/employee/${selected.id}?date=${date}`)
      .then((res) => {
        if (seq === recordsSeqRef.current) setRecords(res);
      })
      .catch(() => {
        if (seq === recordsSeqRef.current) setRecords([]);
      })
      .finally(() => {
        if (seq === recordsSeqRef.current) setRecordsLoading(false);
      });
  }

  useEffect(loadRecords, [selected, date]);

  // "Correct" an existing record was removed (2026-10-23, by request) — a
  // record that already has a real recorded time can never be edited,
  // only a genuine gap (no ENTRY, no EXIT, or neither, for this
  // employee/date) can be filled in. `null` while records are still
  // loading so the add-missing button doesn't flash into existence for a
  // split second based on the previous employee/date's (stale) records.
  // Order-aware, not a raw entry/exit count (mirrors the same fix in
  // MovementsService.missingInRange) — a count comparison flagged a real
  // duplicate-tap day (two ENTRYs at the same minute, then one genuine
  // EXIT) as still missing an EXIT, even though the day is actually
  // complete. Only the first and last record of the day (already
  // chronologically ordered — see listByEmployeeAndDate) matter: ending on
  // ENTRY means a session is still open; starting on EXIT without also
  // ending open means an orphan EXIT has no matching ENTRY.
  //
  // A "missing EXIT" for TODAY specifically is suppressed — the employee
  // may simply still be on-site, shift not over yet, same reasoning as
  // missingInRange's own exclusion (2026-10-26, by request) — so searching
  // for someone directly can't offer an add the list itself wouldn't have
  // surfaced either. A genuinely zero-record day is left alone regardless
  // of date (matches addMissingRecord, which still allows either type
  // first on an empty day no matter what day it is).
  const missingTypes = useMemo<MovementType[]>(() => {
    if (recordsLoading) return [];
    if (records.length === 0) return ['ENTRY', 'EXIT'];
    const missingExit = records[records.length - 1].movementType === 'ENTRY' && date !== todayIso();
    const missingEntry = !missingExit && records[0].movementType === 'EXIT';
    if (missingExit) return ['EXIT'];
    if (missingEntry) return ['ENTRY'];
    return [];
  }, [records, recordsLoading]);

  useFocusTrap(!!edit, modalRef, modalCloseRef, () => {
    if (!saving) setEdit(null);
  });

  // search-all includes inactive/deactivated employees — corrections must
  // still be possible for someone who has since left (spec §39/§42). A
  // blank query now returns a browse list (backend change, 2026-09-21)
  // instead of nothing, so the dropdown shows something on focus rather
  // than only once something's been typed.
  // Guards against a slower response for an earlier query landing after a
  // faster response for a newer one, flashing stale results. Found in the
  // 2026-09-25 audit.
  const searchSeqRef = useRef(0);

  const fetchResults = useCallback((q: string) => {
    const seq = ++searchSeqRef.current;
    api
      .get<Employee[]>(`/employees/search-all?q=${encodeURIComponent(q)}`)
      .then((res) => {
        if (seq === searchSeqRef.current) setResults(res);
      })
      .catch(() => {
        if (seq === searchSeqRef.current) setResults([]);
      });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchResults(query), query.trim() ? 250 : 0);
    return () => clearTimeout(t);
  }, [query, fetchResults]);

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

  function openMissing() {
    if (missingTypes.length === 0) return;
    setEdit({ movementType: missingTypes[0], time: '09:00', reason: '' });
    setError(null);
  }

  async function submitEdit() {
    if (!edit || !selected) return;
    // A cleared native date input sends "" — new Date("") is an Invalid
    // Date, which used to throw a raw "Invalid time value" RangeError
    // from .toISOString() below instead of a friendly message (found in
    // the 2026-09-10 audit). localDateFromIso (not new Date(date) directly)
    // avoids a separate timezone bug — see its own comment.
    const movementAt = date ? localDateFromIso(date) : new Date(NaN);
    if (!date || Number.isNaN(movementAt.getTime())) {
      setError('Please select a valid date above before saving.');
      return;
    }
    // A cleared native time input sends "" — Number("") on the split parts
    // used to produce NaN, which flowed into setHours(NaN, ...) and then
    // threw a raw "Invalid time value" RangeError out of toISOString()
    // below instead of a friendly message. Found in the 2026-09-21 audit.
    const [hours, minutes] = edit.time.split(':').map(Number);
    if (!edit.time || Number.isNaN(hours) || Number.isNaN(minutes)) {
      setError('Please enter a valid time above before saving.');
      return;
    }

    setSaving(true);
    setError(null);
    movementAt.setHours(hours, minutes, 0, 0);

    try {
      await api.post('/movements/missing', {
        employeeId: selected.id,
        movementType: edit.movementType,
        movementAt: movementAt.toISOString(),
        correctionReason: edit.reason.trim() || undefined,
      });
      setSuccessMsg('Missing record added successfully.');
      setEdit(null);
      loadRecords();
      // Otherwise this employee would keep showing in the "missing a
      // movement" list below until the date happened to change again —
      // stale the moment the gap it's listing was just filled. Found in
      // the 2026-10-23 dual-perspective review.
      loadMissing();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-wide">
      <AdminNav />

      <div className="page-heading">
        <IconEdit />
        Missing Movements
      </div>

      {successMsg && (
        <div className="status-banner success">
          <IconCheckCircle />
          {successMsg}
        </div>
      )}

      <div className="filters-bar">
        <div className="field">
          <label>
            Date
            <div className="date-quick-row">
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setAttendanceMonthOffset(null);
                }}
                max={todayIso()}
              />
              <button
                type="button"
                className={`quick-date-btn ${attendanceMonthOffset !== null ? 'active' : ''}`}
                title={attendanceMonthOffset !== null ? missingRange.label : undefined}
                onClick={() => setAttendanceMonthOffset(attendanceMonthOffset ?? 0)}
              >
                Attendance Month
              </button>
              {attendanceMonthOffset !== null && (
                <>
                  <button
                    type="button"
                    className="quick-date-btn"
                    aria-label="Previous attendance cycle"
                    onClick={() => setAttendanceMonthOffset(attendanceMonthOffset - 1)}
                  >
                    <IconChevronRight style={{ transform: 'rotate(180deg)', width: 14, height: 14 }} />
                  </button>
                  <button
                    type="button"
                    className="quick-date-btn"
                    aria-label="Next attendance cycle"
                    onClick={() => setAttendanceMonthOffset(attendanceMonthOffset + 1)}
                  >
                    <IconChevronRight style={{ width: 14, height: 14 }} />
                  </button>
                </>
              )}
            </div>
          </label>
        </div>
        <div className="field" style={{ position: 'relative' }}>
          <label>Employee</label>
          {selected ? (
            <div className="filter-chip">
              <span>
                {selected.employeeName}
                {selected.carNumber ? ` · ${selected.carNumber}` : ''}
                {!selected.isActive ? ' (inactive)' : ''}
              </span>
              <button type="button" onClick={() => setSelected(null)} aria-label="Clear employee">
                <IconX />
              </button>
            </div>
          ) : (
            <div style={{ position: 'relative' }} ref={searchBoxRef}>
              <input
                aria-label="Search employees including inactive employees"
                placeholder="Search employee (including inactive)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => {
                  setDropdownOpen(true);
                  fetchResults(query);
                }}
                style={{ paddingRight: query ? 36 : undefined }}
              />
              {query && (
                <button type="button" className="search-clear-btn" onClick={() => setQuery('')} aria-label="Clear search">
                  <IconX />
                </button>
              )}
              {dropdownOpen && results.length > 0 && (
                <div className="search-results">
                  {results.map((emp) => (
                    <button
                      key={emp.id}
                      onClick={() => {
                        setSelected(emp);
                        setQuery('');
                        setResults([]);
                        setDropdownOpen(false);
                      }}
                    >
                      <span className="result-avatar">{initials(emp.employeeName)}</span>
                      <span className="result-text">
                        <div className="result-name">
                          {emp.employeeName}
                          {!emp.isActive && <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · inactive</span>}
                        </div>
                        <div className="result-meta">
                          {emp.employeeCode}
                          {emp.carNumber ? ` · ${emp.carNumber}` : ''}
                        </div>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {selected && recordsLoading && records.length === 0 && <TableSkeleton columns={3} />}

      {selected && (
        <>
          {records.length > 0 && (
          <>
          <table className="records-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Movement</th>
                <th>Recorded By</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>
                    {formatTime(r.movementAt)}
                    {r.recordedOffline && <OfflineBadge />}
                    <AddedBadge record={r} />
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
                  <span className={`movement-badge ${r.movementType}`}>{r.movementType}</span>
                  <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                    {formatTime(r.movementAt)}
                    {r.recordedOffline && <OfflineBadge />}
                    <AddedBadge record={r} />
                  </div>
                  {r.recordedBy?.name && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Recorded by: {r.recordedBy.name}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          </>
          )}

          {!recordsLoading && records.length === 0 && (
            <div className="empty-state">
              <IconInbox />
              <div className="empty-title">No records for this date</div>
              <div className="empty-hint">If a movement was missed entirely, add it below.</div>
            </div>
          )}

          {/* A record that already has a real recorded time can no longer be
              edited (2026-10-23, by request) — only a genuine gap can be
              filled in, so this is the one remaining action on this page. */}
          {!recordsLoading && missingTypes.length > 0 && (
            <div className="action-row">
              <button onClick={openMissing}>
                <IconPlus />
                {missingTypes.length === 2 ? 'Add Missing Record' : `Add Missing ${missingTypes[0]}`}
              </button>
            </div>
          )}
          {!recordsLoading && records.length > 0 && missingTypes.length === 0 && (
            <div className="empty-hint" style={{ marginTop: 12 }}>
              Both ENTRY and EXIT are already recorded for this day — nothing to add.
            </div>
          )}
        </>
      )}

      {!selected && (
        <>
          <div className="date-heading" style={{ marginTop: 20, justifyContent: 'flex-start', textAlign: 'left' }}>
            {attendanceMonthOffset !== null ? `Missing a movement in ${missingRange.label}` : `Missing a movement on ${date}`}
          </div>
          {missingRange.from <= todayIso() && todayIso() <= missingRange.to && (
            // Someone still on-site simply hasn't tapped EXIT yet — that's
            // not a missed movement, just a shift still in progress, so the
            // backend excludes a "missing EXIT" for today specifically until
            // the day is actually over (missingInRange). An orphan EXIT with
            // no matching ENTRY is a genuine anomaly either way, so that can
            // still show up for today. Applies just as much to Attendance
            // Month when the cycle reaches today as it does to the plain
            // Today view. Backend behavior changed 2026-10-26, by request —
            // this used to just be a caveat banner, now it's an actual
            // exclusion; the banner now explains the exclusion instead.
            <div className="empty-hint" style={{ marginBottom: 12 }}>
              Today's shift is still in progress — people who simply haven't exited yet won't show up here until the day is over. Only genuine anomalies (like an exit with no recorded entry) appear for today.
            </div>
          )}
          {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
          {missingLoading && <TableSkeleton columns={attendanceMonthOffset !== null ? 5 : 4} />}
          {!missingLoading && missingRows.length === 0 && (
            <div className="empty-state">
              <IconCheckCircle />
              <div className="empty-title">Nothing missing</div>
              <div className="empty-hint">
                Everyone who tapped {attendanceMonthOffset !== null ? `during ${missingRange.label}` : `on ${date}`} has both an ENTRY and an EXIT recorded. Search above to review someone's history directly.
              </div>
            </div>
          )}
          {!missingLoading && missingRows.length > 0 && (
            <table className="records-table">
              <thead>
                <tr>
                  {attendanceMonthOffset !== null && <th>Date</th>}
                  <th>Employee</th>
                  <th>Team</th>
                  <th>Missing</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {missingRows.map((row) => (
                  <tr
                    key={`${row.date}|${row.employeeId}`}
                    onClick={() => (selectingId ? undefined : selectFromMissingList(row))}
                    style={{ cursor: selectingId ? 'default' : 'pointer', opacity: selectingId === row.employeeId ? 0.6 : 1 }}
                  >
                    {attendanceMonthOffset !== null && <td>{row.date}</td>}
                    <td>
                      {row.employeeName} <span style={{ color: 'var(--text-muted)' }}>({row.employeeCode})</span>
                    </td>
                    <td>{row.team ?? 'Unassigned'}</td>
                    <td>
                      {/* Same red/"Missing Exit"/"Missing Entry" convention as Insights' own Daily Roster modal for this exact status field. */}
                      <span style={{ color: '#c0392b', fontWeight: 600 }}>{row.status === 'missingExit' ? 'Missing Exit' : 'Missing Entry'}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="table-action-btn"
                        disabled={!!selectingId}
                        onClick={(e) => {
                          e.stopPropagation();
                          quickAdd(row);
                        }}
                      >
                        Add
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* .records-table is hidden below 640px in favor of this card
              layout (global.css) — without it, this list would silently
              show zero rows on a phone, the exact bug class the 2026-09-25
              mobile audit found and fixed across every other table in the
              app (see roadmap.md). Security, who this page now also
              serves, is the role most likely to be on a phone here. */}
          {!missingLoading && missingRows.length > 0 && (
            <div className="record-cards">
              {missingRows.map((row) => (
                <div
                  className="record-card"
                  key={`${row.date}|${row.employeeId}`}
                  onClick={() => (selectingId ? undefined : selectFromMissingList(row))}
                  style={{ opacity: selectingId === row.employeeId ? 0.6 : 1 }}
                >
                  <div>
                    <div>
                      {row.employeeName} <span style={{ color: 'var(--text-muted)' }}>({row.employeeCode})</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                      {attendanceMonthOffset !== null ? `${row.date} · ` : ''}
                      {row.team ?? 'Unassigned'}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <span style={{ color: '#c0392b', fontWeight: 600 }}>{row.status === 'missingExit' ? 'Missing Exit' : 'Missing Entry'}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="table-action-btn"
                    disabled={!!selectingId}
                    onClick={(e) => {
                      e.stopPropagation();
                      quickAdd(row);
                    }}
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {edit && (
        <div className="modal-overlay" role="presentation">
          <div ref={modalRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="correction-dialog-title" style={{ textAlign: 'left' }}>
            <h3 style={{ marginTop: 0, textAlign: 'center' }}>
              <span id="correction-dialog-title">Add Missing Record</span>
            </h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitEdit();
              }}
            >
              <div className="field">
                <label>
                  Movement Type
                  {missingTypes.length !== 2 ? (
                    // Only one type is actually missing — nothing to choose,
                    // and offering the already-recorded type here would let
                    // someone add a second, redundant one instead of fixing
                    // the real gap. The backend rejects it either way, but
                    // this keeps the form from offering a choice that can't
                    // succeed. `!== 2` (not `=== 1`) so quickAdd's already-
                    // correct, pre-set type still shows right away even in
                    // the brief instant before this employee's own records
                    // (and therefore missingTypes) have finished loading —
                    // otherwise this would flash as a dropdown with no
                    // options for a moment.
                    <input value={edit.movementType} disabled />
                  ) : (
                    <select value={edit.movementType} onChange={(e) => setEdit({ ...edit, movementType: e.target.value as MovementType })}>
                      {missingTypes.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              </div>
              <div className="field">
                <label>
                  Time (on {date})<span className="required-mark"> *</span>
                  <input type="time" value={edit.time} onChange={(e) => setEdit({ ...edit, time: e.target.value })} required />
                </label>
              </div>
              <div className="field">
                <label>
                  Reason (optional — kept in the audit log if you add one)
                  <input value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} placeholder="e.g. Guard forgot to tap out" />
                </label>
              </div>
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions">
                <button type="button" ref={modalCloseRef} className="cancel-btn" onClick={() => setEdit(null)} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="confirm-btn" disabled={saving}>
                  {saving && <span className="spinner" />}
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
