import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api/client';
import { IconUsers as IconUsersGroup, IconCheckCircle, IconInbox } from '../components/icons';
import { AdminNav } from '../components/AdminNav';
import { PasswordInput } from '../components/PasswordInput';
import { TableSkeleton } from '../components/TableSkeleton';
import { useAuth } from '../auth/useAuth';

interface UserRow {
  id: number;
  name: string;
  email: string;
  username: string;
  isActive: boolean;
  role: { id: number; name: string };
}

interface Role {
  id: number;
  name: string;
}

export function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [form, setForm] = useState({ name: '', email: '', username: '', password: '', roleId: '' });
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  // Missing from the earlier loading-skeleton pass — this page fetched
  // without ever tracking whether it was still loading, so a slow
  // connection showed a blank table area with no feedback, same class of
  // gap already fixed elsewhere. Found in the 2026-09-21 UX pass.
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    Promise.all([api.get<UserRow[]>('/users'), api.get<Role[]>('/roles')])
      .then(([userRows, roleRows]) => {
        setUsers(userRows);
        setRoles(roleRows);
      })
      .catch(() => {
        setUsers([]);
        setRoles([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await api.post<UserRow>('/users', { ...form, roleId: Number(form.roleId) });
      setForm({ name: '', email: '', username: '', password: '', roleId: '' });
      setSuccessMsg(`${created.name} added successfully.`);
      setTimeout(() => setSuccessMsg(null), 4000);
      load();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create user.');
    }
  }

  async function toggleActive(user: UserRow) {
    const path = user.isActive ? 'disable' : 'enable';
    // No server-side guard against disabling your own (possibly only)
    // Admin account — an unrecoverable lockout short of direct DB access.
    // Found in the 2026-09-04 audit; fixed here at the confirmation layer.
    if (path === 'disable' && user.id === currentUser?.id) {
      if (!window.confirm('This is your own account. Disabling it will log you out and you will not be able to log back in. Continue?')) {
        return;
      }
    }
    try {
      const updated = await api.patch<UserRow>(`/users/${user.id}/${path}`);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (err: any) {
      setError(err?.message ?? `Failed to ${path} user.`);
    }
  }

  return (
    <div className="page-wide">
      <AdminNav />

      <div className="page-heading">
        <IconUsersGroup />
        User Management
      </div>

      <div className="section-card">
        <h3>Add User</h3>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>
              Name<span className="required-mark"> *</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>
              Email<span className="required-mark"> *</span>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </label>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>
              Username<span className="required-mark"> *</span>
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
            </label>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>
              Password<span className="required-mark"> *</span>
              <PasswordInput value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </label>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>
              Role<span className="required-mark"> *</span>
              <select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} required>
                <option value="">Select role</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions" style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="submit" className="primary-button" style={{ width: 'auto', padding: '12px 20px' }}>
              Add User
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

      {loading && users.length === 0 && <TableSkeleton columns={5} />}

      {users.length > 0 && (
        <table className="records-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.username}</td>
                <td>{u.role.name}</td>
                <td>
                  <span className={`status-pill ${u.isActive ? 'active' : 'inactive'}`}>
                    {u.isActive ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td>
                  <button className="table-action-btn" onClick={() => toggleActive(u)}>
                    {u.isActive ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && users.length === 0 && (
        <div className="empty-state">
          <IconInbox />
          <div className="empty-title">No users found</div>
          <div className="empty-hint">Add one above to get started.</div>
        </div>
      )}
    </div>
  );
}
