import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Employee, MovementRecord, MovementType } from '../types';
import { IconGrid, IconUsers, IconEntry, IconExit, IconInbox, IconChevronRight, IconDoorOpen, IconX } from '../components/icons';
import { AdminNav } from '../components/AdminNav';
import { todayIso, isoDaysAgo } from '../utils/date';

export function Dashboard() {
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

  const isToday = date === todayIso();

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

  useEffect(() => {
    if (!employeeQuery.trim()) {
      setEmployeeResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.get<Employee[]>(`/employees/search?q=${encodeURIComponent(employeeQuery)}`).then(setEmployeeResults).catch(() => setEmployeeResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [employeeQuery]);

  return (
    <div className="page-wide">
      <AdminNav />

      <div className="page-heading">
        <IconGrid />
        Dashboard
      </div>

      {summary && (
        <div className="summary-cards summary-cards-4">
          <div className="summary-card">
            <IconUsers />
            <div className="value">{summary.totalEmployees}</div>
            <div className="label">Total Employees</div>
          </div>
          <div className="summary-card">
            <IconEntry style={{ color: 'var(--entry-green)' }} />
            <div className="value">{summary.totalEntries}</div>
            <div className="label">Total Entries</div>
          </div>
          <div className="summary-card">
            <IconExit style={{ color: 'var(--exit-red)' }} />
            <div className="value">{summary.totalExits}</div>
            <div className="label">Total Exits</div>
          </div>
          <div className="summary-card highlight">
            <IconDoorOpen style={{ color: 'var(--brand)' }} />
            <div className="value">{summary.currentlyInside}</div>
            <div className="label">{isToday ? 'Currently Inside' : 'Not Exited By End Of Day'}</div>
          </div>
        </div>
      )}

      <div className="filters-bar">
        <div className="field">
          <label>Date</label>
          <div className="date-quick-row">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <button type="button" className={`quick-date-btn ${date === todayIso() ? 'active' : ''}`} onClick={() => setDate(todayIso())}>
              Today
            </button>
            <button type="button" className={`quick-date-btn ${date === isoDaysAgo(1) ? 'active' : ''}`} onClick={() => setDate(isoDaysAgo(1))}>
              Yesterday
            </button>
          </div>
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
            <input
              aria-label="Search dashboard employees by name, employee code, email, or car number"
              placeholder="All Employees"
              value={employeeQuery}
              onChange={(e) => setEmployeeQuery(e.target.value)}
            />
          )}
          {employeeResults.length > 0 && (
            <div className="search-results">
              {employeeResults.map((emp) => (
                <button
                  key={emp.id}
                  onClick={() => {
                    setSelectedEmployee(emp);
                    setEmployeeQuery('');
                    setEmployeeResults([]);
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
        <div className="field">
          <label>Movement</label>
          <select value={movementType} onChange={(e) => setMovementType(e.target.value as any)}>
            <option value="">All</option>
            <option value="ENTRY">ENTRY</option>
            <option value="EXIT">EXIT</option>
          </select>
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
                  <td>{r.employee?.employeeName}</td>
                  <td>{new Date(r.movementAt).toLocaleDateString('en-IN')}</td>
                  <td>{new Date(r.movementAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
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
                  <strong>{r.employee?.employeeName}</strong>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    {new Date(r.movementAt).toLocaleString('en-IN')}
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
          <div className="empty-title">No records found</div>
          <div className="empty-hint">Try a different date, employee, or movement type.</div>
        </div>
      )}
    </div>
  );
}
