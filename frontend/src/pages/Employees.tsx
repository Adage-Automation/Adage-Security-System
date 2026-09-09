import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Employee } from '../types';
import { IconUsers, IconSearch, IconInbox } from '../components/icons';
import { AdminNav } from '../components/AdminNav';

const PAGE_SIZE = 50;

export function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ employeeCode: '', employeeName: '', email: '' });
  const [error, setError] = useState<string | null>(null);

  function load(reset: boolean) {
    setLoading(true);
    const nextSkip = reset ? 0 : skip;
    const params = new URLSearchParams({ skip: String(nextSkip), take: String(PAGE_SIZE) });
    if (query.trim()) params.set('q', query.trim());

    api
      .get<{ rows: Employee[]; total: number }>(`/employees?${params.toString()}`)
      .then((res) => {
        setEmployees(reset ? res.rows : [...employees, ...res.rows]);
        setTotal(res.total);
        setSkip(nextSkip + res.rows.length);
      })
      .catch(() => {
        if (reset) setEmployees([]);
      })
      .finally(() => setLoading(false));
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
    setError(null);
    try {
      // Email is optional (2026-09-09, to support employees whose address
      // isn't known yet) — but the backend's @IsEmail() rejects an empty
      // string outright (only @IsOptional() skips undefined/null), so a
      // blank field must be omitted from the payload, not sent as "".
      await api.post('/employees', { ...form, email: form.email.trim() || undefined });
      setForm({ employeeCode: '', employeeName: '', email: '' });
      load(true);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create employee.');
    }
  }

  async function toggleActive(emp: Employee) {
    const path = emp.isActive ? 'deactivate' : 'reactivate';
    try {
      await api.patch(`/employees/${emp.id}/${path}`);
      load(true);
    } catch (err: any) {
      setError(err?.message ?? `Failed to ${path} employee.`);
    }
  }

  const hasMore = employees.length < total;

  return (
    <div className="page-wide">
      <AdminNav />

      <div className="page-heading">
        <IconUsers />
        Employee Management
      </div>

      <div className="section-card">
        <h3>Add Employee</h3>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>Employee Code</label>
            <input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} required />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>Name</label>
            <input value={form.employeeName} onChange={(e) => setForm({ ...form, employeeName: e.target.value })} required />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>Email (optional)</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Leave blank if not known yet" />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="submit" className="primary-button" style={{ width: 'auto', padding: '12px 20px' }}>
              Add Employee
            </button>
          </div>
        </form>
        {error && <div className="error-text">{error}</div>}
      </div>

      <div className="filters-bar">
        <div className="field" style={{ position: 'relative', marginBottom: 0 }}>
          <label>Search (name, code, or email)</label>
          <div style={{ position: 'relative' }}>
            <IconSearch className="search-icon" style={{ left: 12, width: 16, height: 16 }} />
            <input
              style={{ paddingLeft: 36 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`All ${total || ''} employees`}
            />
          </div>
        </div>
      </div>

      {employees.length > 0 && (
        <>
          <table className="records-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Email</th>
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
                  <td>
                    <span className={`status-pill ${emp.isActive ? 'active' : 'inactive'}`}>
                      {emp.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button className="table-action-btn" onClick={() => toggleActive(emp)}>
                      {emp.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

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
    </div>
  );
}
