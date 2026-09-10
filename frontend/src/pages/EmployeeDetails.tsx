import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Employee, MovementRecord } from '../types';
import { IconArrowLeft, IconMail, IconCheckCircle, IconXCircle, IconInbox, IconClock } from '../components/icons';
import { todayIso } from '../utils/date';

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
 * records. Uses the first ENTRY and last EXIT of the day to compute the span.
 * Returns a human-readable string like "7h 45m", or null if there isn't at
 * least one ENTRY and one EXIT to work with.
 */
function calcWorkingHours(records: import('../types').MovementRecord[]): string | null {
  const firstEntry = records.find((r) => r.movementType === 'ENTRY');
  const lastExit = [...records].reverse().find((r) => r.movementType === 'EXIT');
  if (!firstEntry || !lastExit) return null;

  const ms = new Date(lastExit.movementAt).getTime() - new Date(firstEntry.movementAt).getTime();
  if (ms <= 0) return null;

  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function EmployeeDetails() {
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
  // Distinguishes "haven't heard back yet" from "heard back, genuinely
  // empty" — without this, the empty state briefly flashes on every
  // navigation before the fetch resolves (found in the 2026-09-09 audit).
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    setRecordsLoading(true);
    api.get<Employee>(`/employees/${employeeId}`).then(setEmployee).catch(() => setEmployee(null));
    api
      .get<MovementRecord[]>(`/movements/employee/${employeeId}?date=${date}`)
      .then(setRecords)
      .catch(() => setRecords([]))
      .finally(() => setRecordsLoading(false));
  }, [employeeId, date]);

  const dateLabel = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(date));

  // EMAIL DETAILS only appears once employee + date + loaded records are
  // all present (spec §30) — email is strictly on-demand, never automatic.
  // Also requires the employee to actually have a registered email — since
  // email became optional (2026-09-09, to allow importing employees whose
  // address isn't known yet), clicking this without one would otherwise
  // just round-trip to the server for a "no registered email" error.
  const canEmail = employee && !!employee.email && records.length > 0;

  // Derived from the already-loaded records — no extra fetch needed.
  // null means we can't compute a span (e.g. employee only has entries, no exit yet).
  const workingHours = calcWorkingHours(records);

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

  if (!employeeId) {
    return <div className="page">No employee selected.</div>;
  }

  return (
    <div className="page">
      <div className="nav-links">
        <Link to="/dashboard">
          <IconArrowLeft />
          Dashboard
        </Link>
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

      {records.length > 0 && (
        <>
          <table className="records-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Movement</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.movementAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td><span className={`movement-badge ${r.movementType}`}>{r.movementType}</span></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="record-cards">
            {records.map((r) => (
              <div className="record-card" key={r.id}>
                <span>{new Date(r.movementAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className={`movement-badge ${r.movementType}`}>{r.movementType}</span>
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

      {workingHours && (
        <div className="working-hours-banner">
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
        <div className="status-banner pending">
          <IconMail />
          No email on file for {employee.employeeName} — add one via Employees before details can be sent.
        </div>
      )}

      {emailState === 'sent' && (
        <div className="status-banner success">
          <IconCheckCircle />
          Details emailed successfully
        </div>
      )}
      {emailState === 'error' && (
        <div className="status-banner error">
          <IconXCircle />
          {emailError}
        </div>
      )}
    </div>
  );
}
