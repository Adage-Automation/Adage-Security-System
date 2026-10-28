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
  // 'missingBoth' — an orphan EXIT at the start of the day AND a still-
  // open session at the end are two independent gaps, not one; the
  // backend used to report only one of them (fixed 2026-10-28).
  status: 'missingExit' | 'missingEntry' | 'missingBoth';
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
  // Time is the one field almost every add actually needs changed (it
  // always starts at the "09:00" placeholder) — focusing it on open saves
  // a guard the extra tap into the field before they can start typing.
  // Added 2026-10-26, by request.
  const timeInputRef = useRef<HTMLInputElement>(null);
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
  // Where the page was scrolled to in the missing-list view right before
  // selecting an employee out of it — restored when coming back (clicking
  // the X on the employee chip) so working through a long Attendance Month
  // list doesn't keep bouncing back to the top. Added 2026-10-26, by request.
  const listScrollRef = useRef(0);
  // Which path opened the current `edit` modal — 'list' (quickAdd, straight
  // off the missing-list) vs 'review' (openMissing, from someone's own day
  // after a direct search) vs 'employeeCycle' (quickAdd from inside one
  // employee's own Attendance Month pills, below). A guard working through
  // a whole shift's worth of gaps via the main list wants to land back on
  // it after each Add, not get stranded on the one employee they just
  // fixed; someone reviewing one employee's whole cycle wants to stay on
  // THAT employee's remaining days instead, not get bounced out to the
  // full list; someone who deliberately chose to review a single day
  // wants to see the result there. A ref, not state — nothing needs to
  // re-render off it. Added 2026-10-26, by request.
  const editOriginRef = useRef<'list' | 'review' | 'employeeCycle'>('review');

  function backToList() {
    setSelected(null);
    requestAnimationFrame(() => window.scrollTo(0, listScrollRef.current));
  }

  // Groups the flat (date, employee) rows by employee — so someone missing
  // 5 days in an Attendance Month cycle shows as one employee with 5
  // day-pills, instead of 5 separate rows scattered across the list by
  // date. Grouping always (not just in Attendance Month view) means the
  // plain single-date view — where this is a no-op, one pill per group —
  // can share the exact same render instead of needing its own near-
  // identical copy. Added 2026-10-26, by request.
  const groupedMissingRows = useMemo(() => {
    const map = new Map<number, { employeeName: string; employeeCode: string; team: string | null; rows: MissingRow[] }>();
    for (const row of missingRows) {
      const g = map.get(row.employeeId);
      if (g) g.rows.push(row);
      else map.set(row.employeeId, { employeeName: row.employeeName, employeeCode: row.employeeCode, team: row.team, rows: [row] });
    }
    return [...map.values()];
  }, [missingRows]);

  // Searching for a specific employee while Attendance Month is active
  // used to still only show their single pinned `date` field's one day of
  // records — meaningless in a multi-day cycle, since nothing says which
  // day that pinned value even is. Filtering the cycle's own missing list
  // (already fetched for the whole range) down to just this employee
  // gives their every missing day in the cycle instead, the same pill
  // shape the full list uses. Only applies in Attendance Month view — the
  // plain single-date view still shows that one day's actual records
  // table, which is the more useful view for a single day. Added
  // 2026-10-26, by request.
  const employeeCycleMissingRows = useMemo(() => {
    if (!selected || attendanceMonthOffset === null) return null;
    return missingRows.filter((r) => r.employeeId === selected.id);
  }, [selected, attendanceMonthOffset, missingRows]);

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

  // One tap straight to the "Add Missing" form for a row already known to
  // be missing exactly one type — skips the "select, wait for their table
  // to load, then find the Add button below it" detour entirely. Each
  // pill in the missing list is now a single button that only does this —
  // no separate "tap elsewhere on the pill to review the day first"
  // behavior, which used to live on the pill's own click handler
  // alongside this. That dual-purpose click (most of the pill = review,
  // a small nested button inside it = add) was easy to miss-tap on a
  // phone, landing on an unfamiliar review screen instead of just fixing
  // the gap — removed 2026-10-26, by request, for a guard who just wants
  // to tap and fix. Reviewing someone's day first is still possible, just
  // via the search box above instead of from the list.
  //
  // `fromEmployeeCycleView`: true when this pill came from one employee's
  // own Attendance Month cycle view (employeeCycleMissingRows) rather than
  // the full list — already fetched one employee at the time, so re-
  // fetching it here is a harmless no-op, but the origin tag matters:
  // submitEdit uses it to decide whether to bounce back to the full list
  // (wrong here — would lose the employee-scoped view mid-way through
  // fixing their several missing days) or just stay put and let the
  // (already-happening) loadMissing() refresh shrink their remaining
  // pills in place. Added 2026-10-26, by request.
  // `movementType` is now an explicit param rather than derived from
  // `row.status` — a 'missingBoth' row needs two separate pills (one per
  // gap), each calling this with its own type; deriving from status alone
  // couldn't tell them apart.
  function quickAdd(row: MissingRow, movementType: MovementType, fromEmployeeCycleView = false) {
    listScrollRef.current = window.scrollY;
    editOriginRef.current = fromEmployeeCycleView ? 'employeeCycle' : 'list';
    setSelectingId(row.employeeId);
    setError(null);
    setDate(row.date);
    api
      .get<Employee>(`/employees/${row.employeeId}`)
      .then((emp) => {
        setSelected(emp);
        setEdit({ movementType, time: '09:00', reason: '' });
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
    // These two are independent, not mutually exclusive — a day can have
    // both an orphan EXIT at the start and a still-open ENTRY at the end.
    // Previously `missingEntry` was gated on `!missingExit`, so that case
    // only ever surfaced one of the two gaps. Mirrors the same fix in
    // MovementsService.missingInRange. Found in the 2026-10-28 audit.
    const missingExit = records[records.length - 1].movementType === 'ENTRY' && date !== todayIso();
    const missingEntry = records[0].movementType === 'EXIT';
    const types: MovementType[] = [];
    if (missingEntry) types.push('ENTRY');
    if (missingExit) types.push('EXIT');
    return types;
    // `date` is read above (the today-exclusion check) but was missing from
    // this list — correct only by coincidence, since `records` always
    // changes whenever `date` does (loadRecords refetches on [selected,
    // date]). Added explicitly so it stays correct if that coupling ever
    // breaks. Found in the 2026-10-28 audit.
  }, [records, recordsLoading, date]);

  useFocusTrap(!!edit, modalRef, timeInputRef, () => {
    if (saving) return;
    setEdit(null);
    if (editOriginRef.current === 'list') backToList();
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
  // Distinguishes "still waiting on this search" from "search came back
  // with nothing" — without it there's no way to tell a guard a typo'd
  // name genuinely has no matches instead of leaving the dropdown blank
  // with no feedback either way. Added 2026-10-26, by request.
  const [searchLoading, setSearchLoading] = useState(false);

  const fetchResults = useCallback((q: string) => {
    const seq = ++searchSeqRef.current;
    setSearchLoading(true);
    api
      .get<Employee[]>(`/employees/search-all?q=${encodeURIComponent(q)}`)
      .then((res) => {
        if (seq === searchSeqRef.current) setResults(res);
      })
      .catch(() => {
        if (seq === searchSeqRef.current) setResults([]);
      })
      .finally(() => {
        if (seq === searchSeqRef.current) setSearchLoading(false);
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

  // Shared between the table and card layouts below, so the pill markup
  // exists in exactly one place instead of two near-identical copies. In
  // the plain single-date view a group always has exactly one pill, which
  // just reads as "the day" with its status next to it — `showDate` is
  // false there, since the date is already the page's own heading right
  // above ("Missing a movement on {date}") and repeating it on every pill
  // read as confusing clutter, as if it might be a different date.
  // Attendance Month mixes several dates per employee, so there it's
  // shown. Added 2026-10-26, by request.
  //
  // Each pill is a single <button> with one job: tap it, it adds the
  // fix — no separate click zone for anything else, so there's nothing to
  // miss-tap on a phone. Simplified from an earlier version with a nested
  // "Add" button inside a pill that did something else (review) when
  // tapped anywhere else on it. Removed 2026-10-26, by request, for
  // simplicity.
  function renderMissingPills(rows: MissingRow[], showDate: boolean, fromEmployeeCycleView = false) {
    // 'missingBoth' is two independent gaps on the same day (an orphan
    // EXIT at the start, a still-open ENTRY at the end) — rendered as two
    // separate pills, each adding its own type, rather than one pill that
    // could only ever fix half the day. Found in the 2026-10-28 audit.
    const typesFor = (row: MissingRow): MovementType[] =>
      row.status === 'missingBoth' ? ['ENTRY', 'EXIT'] : row.status === 'missingExit' ? ['EXIT'] : ['ENTRY'];
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {rows.flatMap((row) =>
          typesFor(row).map((movementType) => (
            <button
              key={`${row.date}|${row.employeeId}|${movementType}`}
              type="button"
              className="table-action-btn missing-pill"
              disabled={!!selectingId}
              onClick={() => quickAdd(row, movementType, fromEmployeeCycleView)}
              style={{ opacity: selectingId === row.employeeId ? 0.6 : 1 }}
            >
              {showDate && `${row.date} · `}
              Add Missing <span style={{ color: 'var(--exit-red)' }}>{movementType === 'EXIT' ? 'Exit' : 'Entry'}</span>
            </button>
          )),
        )}
      </div>
    );
  }

  function openMissing() {
    if (missingTypes.length === 0) return;
    editOriginRef.current = 'review';
    setEdit({ movementType: missingTypes[0], time: '09:00', reason: '' });
    setError(null);
  }

  async function submitEdit() {
    if (!edit || !selected || saving) return;
    // A cleared native date input sends "" — new Date("") is an Invalid
    // Date, which used to throw a raw "Invalid time value" RangeError
    // from .toISOString() below instead of a friendly message (found in
    // the 2026-09-10 audit). localDateFromIso (not new Date(date) directly)
    // avoids a separate timezone bug — see its own comment.
    const movementAt = date ? localDateFromIso(date) : new Date(NaN);
    if (!date || Number.isNaN(movementAt.getTime())) {
      setError('Please select a valid date above before adding.');
      return;
    }
    // A cleared native time input sends "" — Number("") on the split parts
    // used to produce NaN, which flowed into setHours(NaN, ...) and then
    // threw a raw "Invalid time value" RangeError out of toISOString()
    // below instead of a friendly message. Found in the 2026-09-21 audit.
    const [hours, minutes] = edit.time.split(':').map(Number);
    if (!edit.time || Number.isNaN(hours) || Number.isNaN(minutes)) {
      setError('Please enter a valid time above before adding.');
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
      // Otherwise this employee would keep showing in the "missing a
      // movement" list below until the date happened to change again —
      // stale the moment the gap it's listing was just filled. Found in
      // the 2026-10-23 dual-perspective review.
      loadMissing();
      if (editOriginRef.current === 'list') {
        // Added straight off the full list (quickAdd) — back to the list
        // itself rather than leaving the guard stranded on the one person
        // they just fixed, since the whole point of that button is working
        // through several people in a row. loadRecords() would be wasted
        // here, selected is about to go back to null anyway.
        backToList();
      } else if (editOriginRef.current === 'review') {
        loadRecords();
      }
      // 'employeeCycle': added from inside one employee's own cycle pills —
      // deliberately does neither. Staying selected keeps that employee's
      // scoped view up, and the loadMissing() above already shrinks their
      // remaining pills in place (employeeCycleMissingRows re-filters off
      // missingRows automatically) — bouncing out to the full list here
      // would undo the whole point of searching for just this one person.
      // loadRecords() would also be wasted, same reasoning as 'list'.
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to add. Please try again.');
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
              {/* The single date input and the Attendance Month cycle are
                  two different, mutually exclusive ways of picking a
                  range — showing the date input's own single day (e.g.
                  "2026-10-25") at the same time as the cycle's range text
                  below it (e.g. "26 Sep – 25 Oct 2026") looked like two
                  conflicting dates for one filter, since the pinned date
                  has no effect at all while Attendance Month is active.
                  Swapped for the cycle label instead of stacking both.
                  Found 2026-10-26, by request. */}
              {attendanceMonthOffset === null ? (
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setAttendanceMonthOffset(null);
                  }}
                  max={todayIso()}
                />
              ) : (
                <span style={{ fontSize: 14, fontWeight: 600 }}>{missingRange.label}</span>
              )}
              <button
                type="button"
                className={`quick-date-btn ${attendanceMonthOffset !== null ? 'active' : ''}`}
                // A true toggle now — tapping it again while active exits
                // back to the plain Date field, matching the pressed-look
                // "active" styling it already had (which implied a toggle
                // without actually being one before). Found 2026-10-26,
                // by request.
                onClick={() => setAttendanceMonthOffset(attendanceMonthOffset !== null ? null : 0)}
              >
                {attendanceMonthOffset !== null ? 'Exit Attendance Month' : 'Attendance Month'}
              </button>
              {attendanceMonthOffset !== null && (
                <>
                  <button
                    type="button"
                    className="quick-date-btn"
                    aria-label="Previous attendance cycle"
                    title="Previous cycle"
                    onClick={() => setAttendanceMonthOffset(attendanceMonthOffset - 1)}
                  >
                    <IconChevronRight style={{ transform: 'rotate(180deg)', width: 14, height: 14 }} />
                  </button>
                  <button
                    type="button"
                    className="quick-date-btn"
                    aria-label="Next attendance cycle"
                    title="Next cycle"
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
              <button type="button" onClick={backToList} aria-label="Clear employee">
                <IconX />
              </button>
            </div>
          ) : (
            <div style={{ position: 'relative' }} ref={searchBoxRef}>
              <input
                aria-label="Search employees including inactive employees"
                placeholder="Search by name or ID..."
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
              {dropdownOpen && !searchLoading && query.trim() !== '' && results.length === 0 && (
                <div className="search-results">
                  <div className="search-empty">No matches found.</div>
                </div>
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

      {/* Attendance Month + a directly-searched employee: their every
          missing day across the whole cycle, not one arbitrary pinned
          date. */}
      {selected && employeeCycleMissingRows && (
        <>
          <div className="date-heading" style={{ marginTop: 20, justifyContent: 'flex-start', textAlign: 'left' }}>
            Missing movements for {selected.employeeName} in {missingRange.label}
          </div>
          {missingLoading ? (
            <TableSkeleton columns={3} />
          ) : employeeCycleMissingRows.length === 0 ? (
            <div className="empty-state">
              <IconCheckCircle />
              <div className="empty-title">Nothing missing</div>
              <div className="empty-hint">
                {selected.employeeName} has both an ENTRY and an EXIT recorded for every day in {missingRange.label}.
              </div>
            </div>
          ) : (
            renderMissingPills(employeeCycleMissingRows, true, true)
          )}
        </>
      )}

      {/* Once an employee is selected (via search or quick-Add) nothing on
          screen said which date their records table below was actually
          for — the Date field is a small input easy to miss, and the only
          other place the date showed up was inside the Add-record modal's
          own "Time (on {date})" label. A guard searching someone up
          directly could easily assume this was their whole history, not
          one specific day. Added 2026-10-26, by request. Doesn't apply
          when employeeCycleMissingRows is showing instead (above). */}
      {selected && !employeeCycleMissingRows && (
        <div className="date-heading" style={{ marginTop: 20, justifyContent: 'flex-start', textAlign: 'left' }}>
          Records on {date}
        </div>
      )}

      {selected && !employeeCycleMissingRows && recordsLoading && records.length === 0 && <TableSkeleton columns={3} />}

      {selected && !employeeCycleMissingRows && (
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
          {missingLoading && <TableSkeleton columns={3} />}
          {!missingLoading && missingRows.length === 0 && (
            <div className="empty-state">
              <IconCheckCircle />
              <div className="empty-title">Nothing missing</div>
              <div className="empty-hint">
                Everyone who tapped {attendanceMonthOffset !== null ? `during ${missingRange.label}` : `on ${date}`} has both an ENTRY and an EXIT recorded. Search above to review someone's history directly.
              </div>
            </div>
          )}
          {/* One row per employee, every missing day of theirs together as
              a pill (renderMissingPills) — in the plain single-date view
              that's just one pill, the same shape Attendance Month gets
              for each of its several. Wrapped in .sticky-head-scroll so a
              long Attendance Month list keeps its column headers visible
              while scrolling instead of scrolling them away with row 1. */}
          {!missingLoading && groupedMissingRows.length > 0 && (
            <div className="sticky-head-scroll">
              <table className="records-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Team</th>
                    <th>Missing</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedMissingRows.map((g) => (
                    <tr key={g.employeeCode}>
                      <td>
                        {g.employeeName} <span style={{ color: 'var(--text-muted)' }}>({g.employeeCode})</span>
                      </td>
                      <td>{g.team ?? 'Unassigned'}</td>
                      <td>{renderMissingPills(g.rows, attendanceMonthOffset !== null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* .records-table is hidden below 640px in favor of this card
              layout (global.css) — without it, this list would silently
              show zero rows on a phone, the exact bug class the 2026-09-25
              mobile audit found and fixed across every other table in the
              app (see roadmap.md). Security, who this page now also
              serves, is the role most likely to be on a phone here. */}
          {!missingLoading && groupedMissingRows.length > 0 && (
            <div className="record-cards">
              {groupedMissingRows.map((g) => (
                <div className="record-card" key={g.employeeCode} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div>
                    {g.employeeName} <span style={{ color: 'var(--text-muted)' }}>({g.employeeCode})</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#666', marginTop: 4, marginBottom: 8 }}>{g.team ?? 'Unassigned'}</div>
                  {renderMissingPills(g.rows, attendanceMonthOffset !== null)}
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
                  <input ref={timeInputRef} type="time" value={edit.time} onChange={(e) => setEdit({ ...edit, time: e.target.value })} required />
                </label>
                {/* The backend now rejects a time that wouldn't actually close the
                    gap (e.g. an EXIT before the day's last record) — surfacing the
                    boundary here up front instead of making the admin guess after
                    an error. Found in the 2026-10-28 audit. */}
                {records.length > 0 &&
                  (edit.movementType === 'EXIT' ? (
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                      Must be after {formatTime(records[records.length - 1].movementAt)} (the day's last record)
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                      Must be before {formatTime(records[0].movementAt)} (the day's first record)
                    </div>
                  ))}
              </div>
              <div className="field">
                <label>
                  Reason (optional — kept in the audit log if you add one)
                  <input value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} placeholder="e.g. Guard forgot to tap out" />
                </label>
              </div>
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions">
                <button
                  type="button"
                  ref={modalCloseRef}
                  className="cancel-btn"
                  onClick={() => {
                    setEdit(null);
                    if (editOriginRef.current === 'list') backToList();
                  }}
                  disabled={saving}
                >
                  Cancel
                </button>
                {/* "Save" renamed to "Add" — every other label on this page
                    already says "Add" (Add Missing Exit, Add Missing
                    Record); "Save" was the one inconsistent word. Found
                    2026-10-26, by request. */}
                <button type="submit" className="confirm-btn" disabled={saving}>
                  {saving && <span className="spinner" />}
                  {saving ? 'Adding…' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
