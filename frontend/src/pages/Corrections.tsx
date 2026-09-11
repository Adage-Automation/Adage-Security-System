import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { Employee, MovementRecord, MovementType } from '../types';
import { IconEdit, IconPlus, IconInbox, IconX, IconCheckCircle } from '../components/icons';
import { AdminNav } from '../components/AdminNav';
import { todayIso, formatTime } from '../utils/date';

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

interface EditState {
  mode: 'correct' | 'missing';
  originalId?: number;
  movementType: MovementType;
  time: string; // HH:mm
  reason: string;
}

export function Corrections() {
  const [date, setDate] = useState(todayIso());
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
  const modalCloseRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  function loadRecords() {
    if (!selected) return;
    setRecordsLoading(true);
    api
      .get<MovementRecord[]>(`/movements/employee/${selected.id}?date=${date}`)
      .then(setRecords)
      .catch(() => setRecords([]))
      .finally(() => setRecordsLoading(false));
  }

  useEffect(loadRecords, [selected, date]);

  useEffect(() => {
    if (edit) modalCloseRef.current?.focus();
    if (!edit) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setEdit(null);
      if (event.key === 'Tab') {
        const focusable = modalRef.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
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
  }, [edit, saving]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      // search-all includes inactive/deactivated employees — corrections
      // must still be possible for someone who has since left (spec §39/§42).
      api.get<Employee[]>(`/employees/search-all?q=${encodeURIComponent(query)}`).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function openCorrect(record: MovementRecord) {
    const d = new Date(record.movementAt);
    setEdit({
      mode: 'correct',
      originalId: record.id,
      movementType: record.movementType,
      time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      reason: '',
    });
    setError(null);
  }

  function openMissing() {
    setEdit({ mode: 'missing', movementType: 'ENTRY', time: '09:00', reason: '' });
    setError(null);
  }

  async function submitEdit() {
    if (!edit || !selected) return;
    if (!edit.reason.trim()) {
      setError('A reason is required — it is recorded in the audit log.');
      return;
    }
    // A cleared native date input sends "" — new Date("") is an Invalid
    // Date, which used to throw a raw "Invalid time value" RangeError
    // from .toISOString() below instead of a friendly message (found in
    // the 2026-09-10 audit).
    const movementAt = new Date(date);
    if (!date || Number.isNaN(movementAt.getTime())) {
      setError('Please select a valid date above before saving.');
      return;
    }
    setSaving(true);
    setError(null);
    const [hours, minutes] = edit.time.split(':').map(Number);
    movementAt.setHours(hours, minutes, 0, 0);

    try {
      if (edit.mode === 'correct' && edit.originalId) {
        await api.post(`/movements/${edit.originalId}/correct`, {
          employeeId: selected.id,
          movementType: edit.movementType,
          movementAt: movementAt.toISOString(),
          correctionReason: edit.reason.trim(),
        });
        setSuccessMsg('Record corrected successfully.');
      } else {
        await api.post('/movements/missing', {
          employeeId: selected.id,
          movementType: edit.movementType,
          movementAt: movementAt.toISOString(),
          correctionReason: edit.reason.trim(),
        });
        setSuccessMsg('Missing record added successfully.');
      }
      setEdit(null);
      loadRecords();
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
        Correct Records
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
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
            <input aria-label="Search employees including inactive employees" placeholder="Search employee (including inactive)..." value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
          {results.length > 0 && (
            <div className="search-results">
              {results.map((emp) => (
                <button
                  key={emp.id}
                  onClick={() => {
                    setSelected(emp);
                    setQuery('');
                    setResults([]);
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
      </div>

      {selected && (
        <>
          <table className="records-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Movement</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>{formatTime(r.movementAt)}</td>
                  <td><span className={`movement-badge ${r.movementType}`}>{r.movementType}</span></td>
                  <td>
                    <button className="table-action-btn" onClick={() => openCorrect(r)}>
                      Correct
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!recordsLoading && records.length === 0 && (
            <div className="empty-state">
              <IconInbox />
              <div className="empty-title">No records for this date</div>
              <div className="empty-hint">If a movement was missed entirely, add it below.</div>
            </div>
          )}

          <div className="action-row">
            <button onClick={openMissing}>
              <IconPlus />
              Add Missing Record
            </button>
          </div>
        </>
      )}

      {!selected && (
        <div className="empty-state">
          <IconEdit />
          <div className="empty-title">Select a date and employee</div>
          <div className="empty-hint">Search above to view and correct their movement records.</div>
        </div>
      )}

      {edit && (
        <div className="modal-overlay" role="presentation">
          <div ref={modalRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="correction-dialog-title" style={{ textAlign: 'left' }}>
            <h3 style={{ marginTop: 0, textAlign: 'center' }}>
              <span id="correction-dialog-title">
              {edit.mode === 'correct' ? 'Correct Movement Record' : 'Add Missing Record'}
              </span>
            </h3>
            <div className="field">
              <label>
                Movement Type
                <select value={edit.movementType} onChange={(e) => setEdit({ ...edit, movementType: e.target.value as MovementType })}>
                  <option value="ENTRY">ENTRY</option>
                  <option value="EXIT">EXIT</option>
                </select>
              </label>
            </div>
            <div className="field">
              <label>
                Time (on {date})
                <input type="time" value={edit.time} onChange={(e) => setEdit({ ...edit, time: e.target.value })} />
              </label>
            </div>
            <div className="field">
              <label>
                Reason for correction (required, kept in audit log)
                <input value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} placeholder="e.g. Guard recorded wrong type by mistake" />
              </label>
            </div>
            {error && <div className="error-text">{error}</div>}
            <div className="modal-actions">
              <button ref={modalCloseRef} className="cancel-btn" onClick={() => setEdit(null)} disabled={saving}>
                Cancel
              </button>
              <button className="confirm-btn" onClick={submitEdit} disabled={saving}>
                {saving && <span className="spinner" />}
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
