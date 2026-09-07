import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Employee, MovementRecord } from '../types';
import { IconArrowLeft, IconMail, IconCheckCircle, IconXCircle, IconInbox } from '../components/icons';
import { todayIso } from '../utils/date';

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function EmployeeDetails() {
  const [params] = useSearchParams();
  const employeeId = params.get('employeeId');
  const date = params.get('date') ?? todayIso();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [records, setRecords] = useState<MovementRecord[]>([]);
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    api.get<Employee>(`/employees/${employeeId}`).then(setEmployee).catch(() => setEmployee(null));
    api
      .get<MovementRecord[]>(`/movements/employee/${employeeId}?date=${date}`)
      .then(setRecords)
      .catch(() => setRecords([]));
  }, [employeeId, date]);

  const dateLabel = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(date));

  // EMAIL DETAILS only appears once employee + date + loaded records are
  // all present (spec §30) — email is strictly on-demand, never automatic.
  const canEmail = employee && records.length > 0;

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

      {records.length === 0 && (
        <div className="empty-state">
          <IconInbox />
          <div className="empty-title">No movement records</div>
          <div className="empty-hint">Nothing recorded for {employee?.employeeName ?? 'this employee'} on {dateLabel}.</div>
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
