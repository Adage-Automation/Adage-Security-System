import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Employee, MovementRecord } from '../types';
import { IconArrowLeft, IconMail, IconCheckCircle, IconXCircle, IconInbox, IconClock } from '../components/icons';
import { TableSkeleton } from '../components/TableSkeleton';
import { OfflineBadge } from '../components/OfflineBadge';
import { AddedBadge } from '../components/AddedBadge';
import { todayIso, formatTime, localDateFromIso, localIso } from '../utils/date';

// The calendar day after `dateIso` — same helper as Corrections.tsx's
// nextDayLabel.
function nextDayIso(dateIso: string): string {
  const d = localDateFromIso(dateIso);
  d.setDate(d.getDate() + 1);
  return localIso(d);
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

const VALID_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Calculates total working hours for the day from a sorted list of movement
 * records. Uses the first ENTRY and last EXIT of the day to compute the
 * same-day span, plus (if the day ends on a still-open ENTRY) an overnight
 * credit from that open entry to `overnightExit` — mirrors exactly what
 * Insights' stitchOvernightSessions and Corrections' missingInRange credit
 * to this day, so this page's total stays consistent with those. Returns a
 * human-readable string like "7h 45m", or null if there's no hours at all.
 */
export function calcWorkingHours(records: import('../types').MovementRecord[], overnightExit?: import('../types').MovementRecord | null): string | null {
  const firstEntry = records.find((r) => r.movementType === 'ENTRY');
  const lastExit = [...records].reverse().find((r) => r.movementType === 'EXIT');

  let totalMs = 0;
  if (firstEntry && lastExit) {
    const ms = new Date(lastExit.movementAt).getTime() - new Date(firstEntry.movementAt).getTime();
    if (ms > 0) totalMs += ms;
  }

  // The day's actual LAST record (chronological, not just "has an ENTRY
  // somewhere") must be the dangling open entry — same rule as every other
  // isMissingExit/lastMovementType check in the app.
  const lastRecord = records[records.length - 1];
  if (overnightExit && lastRecord?.movementType === 'ENTRY') {
    const ms = new Date(overnightExit.movementAt).getTime() - new Date(lastRecord.movementAt).getTime();
    if (ms > 0) totalMs += ms;
  }

  if (totalMs <= 0) return null;

  // Round, don't floor: real tap timestamps rarely land on an exact
  // whole minute, so a span a few seconds under a clean hour (e.g.
  // 10:00:00 to 18:59:58) would otherwise read as "8h 59m" instead of "9h".
  const totalMinutes = Math.round(totalMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function EmployeeDetails() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const employeeId = params.get('employeeId');
  const rawDate = params.get('date');
  // A malformed/hand-edited/stale-bookmarked `date` param (e.g. from a
  // saved link) used to crash the whole page with a RangeError from
  // Intl.DateTimeFormat further down — found in the 2026-09-10 audit.
  // Falls back to today rather than rendering a blank/broken page.
  const date = rawDate && VALID_DATE_RE.test(rawDate) && !Number.isNaN(new Date(rawDate).getTime()) ? rawDate : todayIso();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [records, setRecords] = useState<MovementRecord[]>([]);
  // The next calendar day's orphan leading EXIT, when this day ends on a
  // dangling open ENTRY and that's what actually closes it — an overnight
  // shift crossing midnight, same rule stitchOvernightSessions/
  // missingInRange already use. Without this, this page showed no exit and
  // no working hours for a day that Insights already credits in full,
  // since the exit record's own calendarDate is genuinely the next day, not
  // this one — it was never missing, just invisible from here. null means
  // "not applicable or none found", not "still loading". Added 2026-10-30.
  const [overnightExit, setOvernightExit] = useState<MovementRecord | null>(null);
  // Distinguishes "haven't heard back yet" from "heard back, genuinely
  // empty" — without this, the empty state briefly flashes on every
  // navigation before the fetch resolves (found in the 2026-09-09 audit).
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [emailError, setEmailError] = useState<string | null>(null);
  // Discards a response that lands after a newer fetch has already started
  // — without this, rapidly opening employee A's page and then B's (e.g.
  // from two different Dashboard drill-down rows) could let A's slower
  // response land last and overwrite B's data on screen.
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    if (!employeeId) return;
    const seq = ++fetchSeqRef.current;
    setRecordsLoading(true);
    // Whatever was emailed (or failed to email) for the previous
    // employee/date has no bearing on this one — without resetting these,
    // the "Details emailed successfully" banner (or a stale "already
    // emailed, send again?" confirm) could bleed across navigations within
    // this same mounted page.
    setEmailState('idle');
    setEmailError(null);
    api
      .get<Employee>(`/employees/${employeeId}`)
      .then((emp) => {
        if (seq === fetchSeqRef.current) setEmployee(emp);
      })
      .catch(() => {
        if (seq === fetchSeqRef.current) setEmployee(null);
      });
    setOvernightExit(null);
    api
      .get<MovementRecord[]>(`/movements/employee/${employeeId}?date=${date}`)
      .then((recs) => {
        if (seq !== fetchSeqRef.current) return;
        setRecords(recs);
        // Only worth a second request when this day actually ends on a
        // dangling open ENTRY — the one shape an overnight exit could
        // apply to. Fetches the next day's own records and checks the
        // same rule stitchOvernightSessions uses: that day's FIRST record
        // is an EXIT (an orphan leading exit, nothing explains it there).
        if (recs.length > 0 && recs[recs.length - 1].movementType === 'ENTRY') {
          api
            .get<MovementRecord[]>(`/movements/employee/${employeeId}?date=${nextDayIso(date)}`)
            .then((nextRecs) => {
              if (seq === fetchSeqRef.current && nextRecs[0]?.movementType === 'EXIT') setOvernightExit(nextRecs[0]);
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        if (seq === fetchSeqRef.current) setRecords([]);
      })
      .finally(() => {
        if (seq === fetchSeqRef.current) setRecordsLoading(false);
      });
  }, [employeeId, date]);

  const dateLabel = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(date));
  const overnightExitDateLabel = overnightExit
    ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(nextDayIso(date)))
    : null;

  // EMAIL DETAILS only appears once employee + date + loaded records are
  // all present (spec §30) — email is strictly on-demand, never automatic.
  // Also requires the employee to actually have a registered email — since
  // email became optional (2026-09-09, to allow importing employees whose
  // address isn't known yet), clicking this without one would otherwise
  // just round-trip to the server for a "no registered email" error.
  const canEmail = employee && !!employee.email && records.length > 0;

  // Derived from the already-loaded records — no extra fetch needed.
  // null means we can't compute a span (e.g. employee only has entries, no exit yet).
  const workingHours = calcWorkingHours(records, overnightExit);

  async function sendEmail() {
    if (!employeeId) return;
    // Duplicate-send protection (§38): warn, don't block — the employee
    // may genuinely be asking for the record again.
    if (emailState === 'sent' && !window.confirm('Details were already emailed for this date. Send again?')) {
      return;
    }
    setEmailState('sending');
    setEmailError(null);
    try {
      await api.post(`/reports/email?employeeId=${employeeId}&date=${date}`);
      setEmailState('sent');
    } catch (err: any) {
      setEmailState('error');
      setEmailError(err?.message ?? 'Failed to send email.');
    }
  }

  // Goes back to wherever this page was opened from (Dashboard, Insights,
  // etc.) via real browser history instead of a hardcoded destination —
  // so "back" actually returns to the same place, filters and all. Falls
  // back to Dashboard only if there's no app history to go back to (e.g.
  // a bookmarked/directly-opened link).
  function goBack() {
    if (window.history.length > 1) navigate(-1);
    else navigate('/dashboard');
  }

  if (!employeeId) {
    return (
      <div className="page">
        <div className="nav-links">
          <button type="button" className="link-button" onClick={goBack}>
            <IconArrowLeft />
            Back
          </button>
        </div>

        <div className="empty-state">
          <IconInbox />
          <div className="empty-title">No employee selected</div>
          <div className="empty-hint">Pick an employee from the dashboard to view their movement details.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="nav-links">
        <button type="button" className="link-button" onClick={goBack}>
          <IconArrowLeft />
          Back
        </button>
      </div>

      <div className="page-heading" style={{ justifyContent: 'center' }}>
        Employee Movement Details
      </div>

      {employee && (
        <div className="selected-employee-card">
          <div className="avatar">{initials(employee.employeeName)}</div>
          <div className="name">{employee.employeeName}</div>
          <div className="code">Employee ID: {employee.employeeCode}</div>
          {employee.email && <div className="code">Email: {employee.email}</div>}
          {employee.carNumber && <div className="code">Car Number: {employee.carNumber}</div>}
          <div className="code">Date: {dateLabel}</div>
        </div>
      )}

      {recordsLoading && records.length === 0 && <TableSkeleton columns={2} />}

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
              <div className="record-card" key={r.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    {formatTime(r.movementAt)}
                    {r.recordedOffline && <OfflineBadge />}
                    <AddedBadge record={r} />
                  </span>
                  <span className={`movement-badge ${r.movementType}`}>{r.movementType}</span>
                </div>
                {r.recordedBy?.name && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Recorded by: {r.recordedBy.name}</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {!recordsLoading && records.length === 0 && (
        <div className="empty-state">
          <IconInbox />
          <div className="empty-title">No movement records</div>
          <div className="empty-hint">Nothing recorded for {employee?.employeeName ?? 'this employee'} on {dateLabel}.</div>
        </div>
      )}

      {/* The day's own record list correctly has no EXIT here — this one's
          own timestamp genuinely falls on the NEXT calendar day, same as
          every other date-scoped view in the app. Shown separately, not
          appended into `records` above, so it's never mistaken for one of
          this day's own taps. Added 2026-10-30, by request — without this,
          a day Insights already credits in full looked, from here, like
          the employee simply never left. */}
      {overnightExit && (
        <button
          type="button"
          className="link-button"
          style={{ display: 'block', width: '100%', textAlign: 'left', margin: '12px 0' }}
          onClick={() => navigate(`/employee-details?employeeId=${employeeId}&date=${nextDayIso(date)}`)}
        >
          <IconClock /> Shift continued overnight — exited at {formatTime(overnightExit.movementAt)} on {overnightExitDateLabel} (view that day →)
        </button>
      )}

      {workingHours && (
        <div className="working-hours-banner" role="status" aria-live="polite">
          <IconClock />
          <span>
            Total working hours: <strong>{workingHours}</strong>
          </span>
        </div>
      )}

      {canEmail && (
        <div className="action-row">
          <button onClick={sendEmail} disabled={emailState === 'sending'}>
            {emailState === 'sending' ? <span className="spinner dark" /> : <IconMail />}
            {emailState === 'sending' ? 'Sending…' : 'EMAIL DETAILS'}
          </button>
        </div>
      )}

      {employee && !employee.email && records.length > 0 && (
        <div className="status-banner pending" role="status" aria-live="polite">
          <IconMail />
          No email on file for {employee.employeeName} — add one via Employees before details can be sent.
        </div>
      )}

      {emailState === 'sent' && (
        <div className="status-banner success" role="status" aria-live="polite">
          <IconCheckCircle />
          Details emailed successfully
        </div>
      )}
      {emailState === 'error' && (
        <div className="status-banner error" role="alert" aria-live="assertive">
          <IconXCircle />
          {emailError}
        </div>
      )}
    </div>
  );
}
