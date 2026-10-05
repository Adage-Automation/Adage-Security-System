import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { Employee } from '../types';
import { IconUsers, IconSearch, IconInbox, IconX, IconCheckCircle, IconDownload, IconUpload } from '../components/icons';
import { AdminNav } from '../components/AdminNav';
import { TableSkeleton } from '../components/TableSkeleton';

const PAGE_SIZE = 50;

interface ImportRowResult {
  row: number;
  employeeCode: string;
  employeeName: string;
  status: 'created' | 'skipped';
  reason?: string;
}

interface ImportResult {
  created: number;
  skipped: number;
  results: ImportRowResult[];
}

export function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ employeeCode: '', employeeName: '', email: '', carNumber: '' });
  const [editing, setEditing] = useState<Employee | null>(null);
  const [editForm, setEditForm] = useState({ employeeName: '', email: '', carNumber: '' });
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const editModalRef = useRef<HTMLDivElement>(null);
  const editFirstFieldRef = useRef<HTMLInputElement>(null);
  const importModalRef = useRef<HTMLDivElement>(null);
  const importModalCloseRef = useRef<HTMLButtonElement>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const loadSeqRef = useRef(0);

  // The edit form used to render inline at the top of the page, above the
  // filters and table — invisible and unreachable without scrolling back
  // up, especially bad once the roster grew large enough to need "Load
  // More" (an admin editing the 150th row had no idea where their typing
  // was even going). A modal appears centered in the viewport regardless
  // of scroll position, so there's never a "where do I type" moment.
  // Matches the same modal pattern already used by Corrections.tsx and the
  // ENTRY/EXIT duplicate-confirm dialog. Found in the 2026-09-21 UX pass.
  useEffect(() => {
    if (editing) editFirstFieldRef.current?.focus();
    if (!editing) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditing(null);
      if (event.key === 'Tab') {
        const focusable = editModalRef.current?.querySelectorAll<HTMLElement>(
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
  }, [editing]);

  // Same modal-focus pattern as the edit modal above, for the import
  // results summary.
  useEffect(() => {
    if (importResult) importModalCloseRef.current?.focus();
    if (!importResult) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setImportResult(null);
      if (event.key === 'Tab') {
        const focusable = importModalRef.current?.querySelectorAll<HTMLElement>(
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
  }, [importResult]);

  function load(reset: boolean) {
    setLoading(true);
    const nextSkip = reset ? 0 : skip;
    const params = new URLSearchParams({ skip: String(nextSkip), take: String(PAGE_SIZE) });
    if (query.trim()) params.set('q', query.trim());

    // A slower response for an earlier query (or a stale "Load More" page)
    // landing after a newer one could otherwise overwrite the list with
    // outdated results — found in the 2026-09-25 audit.
    const seq = ++loadSeqRef.current;

    api
      .get<{ rows: Employee[]; total: number }>(`/employees?${params.toString()}`)
      .then((res) => {
        if (seq !== loadSeqRef.current) return;
        setEmployees(reset ? res.rows : [...employees, ...res.rows]);
        setTotal(res.total);
        setSkip(nextSkip + res.rows.length);
      })
      .catch(() => {
        if (seq !== loadSeqRef.current) return;
        if (reset) setEmployees([]);
      })
      .finally(() => {
        if (seq === loadSeqRef.current) setLoading(false);
      });
  }

  // Reload from the top whenever the search query changes — the roster
  // grew to 205 employees (2026-09-09), so an un-filterable, un-paginated
  // list would silently hide everyone past the first page. Debounced to
  // match the search pattern used elsewhere in the app.
  useEffect(() => {
    const t = setTimeout(() => load(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setError(null);
    setCreating(true);
    try {
      // Email is optional (2026-09-09, to support employees whose address
      // isn't known yet) — but the backend's @IsEmail() rejects an empty
      // string outright (only @IsOptional() skips undefined/null), so a
      // blank field must be omitted from the payload, not sent as "".
      const created = await api.post<Employee>('/employees', {
        employeeCode: form.employeeCode.trim(),
        employeeName: form.employeeName.trim(),
        email: form.email.trim() || undefined,
        carNumber: form.carNumber.trim() || undefined,
      });
      setForm({ employeeCode: '', employeeName: '', email: '', carNumber: '' });
      // The list resets to page 1 (sorted by name) below — with 200+
      // employees, a newly added one might not even land in the first 50
      // rows, and the form clearing silently was the only prior feedback.
      // An explicit confirmation makes it clear the add actually worked,
      // even when the new row itself isn't visible without a search.
      // Found in the 2026-09-21 UX pass.
      setSuccessMsg(`${created.employeeName} added successfully.`);
      setTimeout(() => setSuccessMsg(null), 4000);
      load(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create employee.');
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(emp: Employee) {
    const path = emp.isActive ? 'deactivate' : 'reactivate';
    try {
      const updated = await api.patch<Employee>(`/employees/${emp.id}/${path}`);
      // Patch this one row in place rather than reloading from page 1 —
      // a full reload used to silently collapse the list back to the
      // first 50 rows, discarding any "Load More" progress. An admin who
      // scrolled/loaded their way to row 150 to deactivate someone would
      // lose their place and have to redo all of it. Found in the
      // 2026-09-21 UX pass.
      setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } catch (err: any) {
      setError(err?.message ?? `Failed to ${path} employee.`);
    }
  }

  function startEditing(emp: Employee) {
    setEditing(emp);
    setEditForm({ employeeName: emp.employeeName, email: emp.email ?? '', carNumber: emp.carNumber ?? '' });
    setError(null);
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    try {
      const updated = await api.put<Employee>(`/employees/${editing.id}`, {
        employeeName: editForm.employeeName.trim(),
        email: editForm.email.trim() || undefined,
        carNumber: editForm.carNumber.trim() || undefined,
      });
      // Same reasoning as toggleActive above — patch this one row instead
      // of reloading from page 1 and losing "Load More" progress.
      setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setEditing(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update employee.');
    }
  }

  // The api client (frontend/src/api/client.ts) always parses JSON, so a
  // binary .xlsx download needs its own fetch call rather than going
  // through it — same reasoning as the PDF/PNG report downloads on the
  // backend, just triggered from here instead of a direct link so the
  // session cookie (credentials: 'include') is sent.
  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch('/api/employees/export', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to export employees.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `employees-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to export employees.');
    } finally {
      setExporting(false);
    }
  }

  async function handleDownloadTemplate() {
    setError(null);
    try {
      const res = await fetch('/api/employees/import-template', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to download import template.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'employee-import-template.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to download import template.');
    }
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same filename after fixing it
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/employees/import', { method: 'POST', credentials: 'include', body: formData });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? 'Import failed.');
      setImportResult(body);
      // Only reload the roster when something actually changed — an
      // all-skipped import shouldn't reset "Load More" progress for nothing.
      if (body.created > 0) load(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to import employees.');
    } finally {
      setImporting(false);
    }
  }

  const hasMore = employees.length < total;

  return (
    <div className="page-wide">
      <AdminNav />

      <div className="page-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconUsers />
          Employee Management
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="table-action-btn" onClick={handleDownloadTemplate} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconDownload style={{ width: 16, height: 16 }} />
            Download Import Template
          </button>
          <button
            type="button"
            className="table-action-btn"
            onClick={() => importFileInputRef.current?.click()}
            disabled={importing}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {importing && <span className="spinner" />}
            <IconUpload style={{ width: 16, height: 16 }} />
            {importing ? 'Importing…' : 'Import from Excel'}
          </button>
          <input
            ref={importFileInputRef}
            type="file"
            accept=".xlsx"
            onChange={handleImportFile}
            style={{ display: 'none' }}
          />
          <button type="button" className="table-action-btn" onClick={handleExport} disabled={exporting} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {exporting && <span className="spinner" />}
            <IconDownload style={{ width: 16, height: 16 }} />
            {exporting ? 'Exporting…' : 'Export to Excel'}
          </button>
        </div>
      </div>

      <div className="section-card">
        <h3>Add Employee</h3>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>
              Employee Code<span className="required-mark"> *</span>
              <input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} placeholder="Must be unique, e.g. EMP206" required />
            </label>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>
              Name<span className="required-mark"> *</span>
              <input value={form.employeeName} onChange={(e) => setForm({ ...form, employeeName: e.target.value })} required />
            </label>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>
              Email (optional)
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Leave blank if not known yet" />
            </label>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>
              Car Number (optional)
              <input value={form.carNumber} onChange={(e) => setForm({ ...form, carNumber: e.target.value })} placeholder="Leave blank if not known yet" />
            </label>
          </div>
          <div className="form-actions" style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="submit" className="primary-button" style={{ width: 'auto', padding: '12px 20px' }} disabled={creating}>
              {creating && <span className="spinner" />}
              {creating ? 'Adding…' : 'Add Employee'}
            </button>
          </div>
        </form>
        {successMsg && (
          <div className="status-banner success" style={{ marginTop: 12, marginBottom: 0 }} role="status" aria-live="polite">
            <IconCheckCircle />
            {successMsg}
          </div>
        )}
        {error && <div className="error-text">{error}</div>}
      </div>

      <div className="filters-bar">
        <div className="field" style={{ position: 'relative', marginBottom: 0 }}>
          <label>
            Search (name, code, email, or car number)
            <div style={{ position: 'relative' }}>
              <IconSearch className="search-icon" style={{ left: 12, width: 16, height: 16 }} />
              <input
                style={{ paddingLeft: 36, paddingRight: query ? 36 : undefined }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`All ${total || ''} employees`}
              />
              {query && (
                <button type="button" className="search-clear-btn" onClick={() => setQuery('')} aria-label="Clear search">
                  <IconX />
                </button>
              )}
            </div>
          </label>
        </div>
      </div>

      {loading && employees.length === 0 && <TableSkeleton columns={6} />}

      {employees.length > 0 && (
        <>
          <table className="records-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Email</th>
                <th>Car Number</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id}>
                  <td>{emp.employeeCode}</td>
                  <td>{emp.employeeName}</td>
                  <td>{emp.email ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td>{emp.carNumber ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td>
                    <span className={`status-pill ${emp.isActive ? 'active' : 'inactive'}`}>
                      {emp.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button className="table-action-btn" onClick={() => startEditing(emp)} style={{ marginRight: 8 }}>
                      Edit
                    </button>
                    <button className="table-action-btn" onClick={() => toggleActive(emp)}>
                      {emp.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="record-cards">
            {employees.map((emp) => (
              <div className="record-card" key={emp.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <strong>{emp.employeeName}</strong>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{emp.employeeCode}</div>
                  </div>
                  <span className={`status-pill ${emp.isActive ? 'active' : 'inactive'}`}>
                    {emp.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div style={{ fontSize: 13 }}>
                  {emp.email ?? <span style={{ color: 'var(--text-muted)' }}>No email</span>}
                  {emp.carNumber ? ` · ${emp.carNumber}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="table-action-btn" onClick={() => startEditing(emp)} style={{ flex: 1 }}>
                    Edit
                  </button>
                  <button className="table-action-btn" onClick={() => toggleActive(emp)} style={{ flex: 1 }}>
                    {emp.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Showing {employees.length} of {total}
            </span>
            {hasMore && (
              <button className="table-action-btn" onClick={() => load(false)} disabled={loading}>
                {loading ? 'Loading…' : 'Load More'}
              </button>
            )}
          </div>
        </>
      )}

      {employees.length === 0 && !loading && (
        <div className="empty-state">
          <IconInbox />
          <div className="empty-title">No employees found</div>
          <div className="empty-hint">Try a different search, or add one above.</div>
        </div>
      )}

      {editing && (
        <div className="modal-overlay" role="presentation">
          <div
            ref={editModalRef}
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-employee-title"
            style={{ textAlign: 'left', maxWidth: 440 }}
          >
            <h3 id="edit-employee-title" style={{ marginTop: 0, textAlign: 'center' }}>
              Edit Employee: {editing.employeeCode}
            </h3>
            <form onSubmit={saveEdit}>
              <div className="field">
                <label>
                  Name<span className="required-mark"> *</span>
                  <input
                    ref={editFirstFieldRef}
                    value={editForm.employeeName}
                    onChange={(e) => setEditForm({ ...editForm, employeeName: e.target.value })}
                    required
                  />
                </label>
              </div>
              <div className="field">
                <label>
                  Email (optional)
                  <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                </label>
              </div>
              <div className="field">
                <label>
                  Car Number (optional)
                  <input value={editForm.carNumber} onChange={(e) => setEditForm({ ...editForm, carNumber: e.target.value })} />
                </label>
              </div>
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button type="submit" className="confirm-btn">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {importResult && (
        <div className="modal-overlay" role="presentation">
          <div
            ref={importModalRef}
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-result-title"
            style={{ textAlign: 'left', maxWidth: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
          >
            <h3 id="import-result-title" style={{ marginTop: 0, textAlign: 'center' }}>
              Import complete
            </h3>
            <div className={`status-banner ${importResult.skipped > 0 ? 'pending' : 'success'}`} style={{ marginBottom: 12 }} role="status" aria-live="polite">
              {importResult.created > 0 && <IconCheckCircle />}
              {importResult.created} added, {importResult.skipped} skipped.
            </div>

            {importResult.skipped > 0 && (
              <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {importResult.results
                  .filter((r) => r.status === 'skipped')
                  .map((r) => (
                    <div key={r.row} style={{ padding: '8px 10px', borderRadius: 8, background: '#f4f7f6' }}>
                      <div style={{ fontWeight: 600 }}>
                        Row {r.row}: {r.employeeCode || '(blank)'} {r.employeeName && `· ${r.employeeName}`}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.reason}</div>
                    </div>
                  ))}
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button ref={importModalCloseRef} type="button" className="cancel-btn" onClick={() => setImportResult(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
