import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { IconUsers as IconUsersGroup, IconCheckCircle, IconInbox, IconSearch, IconX } from '../components/icons';
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
  const [creating, setCreating] = useState(false);
  // Missing from the earlier loading-skeleton pass — this page fetched
  // without ever tracking whether it was still loading, so a slow
  // connection showed a blank table area with no feedback, same class of
  // gap already fixed elsewhere. Found in the 2026-09-21 UX pass.
  const [loading, setLoading] = useState(true);
  // No backend search param for /users (unlike Employees) — the user list
  // is small enough that filtering the already-fetched rows client-side is
  // simpler than adding pagination/search infra that isn't needed yet.
  // Found in the 2026-09-28 admin-page audit.
  const [query, setQuery] = useState('');

  // Edit and Reset Password were already fully built on the backend
  // (PUT /users/:id, PATCH /users/:id/reset-password) but had no UI at
  // all — an admin who mistyped an email, needed to change someone's
  // role, or had a locked-out user with no working reset-email path had
  // no way to fix any of it through the app. Found in the 2026-09-28
  // admin-page audit.
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', roleId: '' });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [resetForm, setResetForm] = useState({ newPassword: '', confirmPassword: '' });
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSaving, setResetSaving] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const modalFirstFieldRef = useRef<HTMLInputElement>(null);
  const activeModal = editing ? 'edit' : resetting ? 'reset' : null;

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

  // Same focus + Escape + Tab-trap pattern already used by Employees.tsx's
  // edit modal — only one of the two modals here is ever open at a time,
  // so both share this single effect.
  useEffect(() => {
    if (activeModal) modalFirstFieldRef.current?.focus();
    if (!activeModal) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (editing && !editSaving) setEditing(null);
        if (resetting && !resetSaving) setResetting(null);
      }
      if (event.key === 'Tab') {
        const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModal]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setError(null);
    setCreating(true);
    try {
      const created = await api.post<UserRow>('/users', { ...form, roleId: Number(form.roleId) });
      setForm({ name: '', email: '', username: '', password: '', roleId: '' });
      setSuccessMsg(`${created.name} added successfully.`);
      setTimeout(() => setSuccessMsg(null), 4000);
      load();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create user.');
    } finally {
      setCreating(false);
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

  function startEditing(user: UserRow) {
    setEditing(user);
    setEditForm({ name: user.name, email: user.email, roleId: String(user.role.id) });
    setEditError(null);
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditError(null);
    setEditSaving(true);
    try {
      const updated = await api.put<UserRow>(`/users/${editing.id}`, {
        name: editForm.name.trim(),
        email: editForm.email.trim(),
        roleId: Number(editForm.roleId),
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setEditing(null);
    } catch (err: any) {
      setEditError(err?.message ?? 'Failed to update user.');
    } finally {
      setEditSaving(false);
    }
  }

  function startResetting(user: UserRow) {
    setResetting(user);
    setResetForm({ newPassword: '', confirmPassword: '' });
    setResetError(null);
  }

  async function submitReset(e: FormEvent) {
    e.preventDefault();
    if (!resetting) return;
    setResetError(null);
    // Same client-side checks as the self-service Reset Password page
    // (ResetPassword.tsx) — the backend also enforces the 8-char minimum
    // (class-validator's @MinLength), but catching it here avoids a round
    // trip for the most common mistake.
    if (resetForm.newPassword.length < 8) {
      setResetError('Password must be at least 8 characters.');
      return;
    }
    if (resetForm.newPassword !== resetForm.confirmPassword) {
      setResetError('Passwords do not match.');
      return;
    }
    setResetSaving(true);
    try {
      await api.patch(`/users/${resetting.id}/reset-password`, { newPassword: resetForm.newPassword });
      setSuccessMsg(`Password reset for ${resetting.name}.`);
      setTimeout(() => setSuccessMsg(null), 4000);
      setResetting(null);
    } catch (err: any) {
      setResetError(err?.message ?? 'Failed to reset password.');
    } finally {
      setResetSaving(false);
    }
  }

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.name.toLowerCase().includes(q),
    );
  }, [users, query]);

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
            <button type="submit" className="primary-button" style={{ width: 'auto', padding: '12px 20px' }} disabled={creating}>
              {creating && <span className="spinner" />}
              {creating ? 'Adding…' : 'Add User'}
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
            Search (name, username, email, or role)
            <div style={{ position: 'relative' }}>
              <IconSearch className="search-icon" style={{ left: 12, width: 16, height: 16 }} />
              <input
                style={{ paddingLeft: 36, paddingRight: query ? 36 : undefined }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`All ${users.length || ''} users`}
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

      {loading && users.length === 0 && <TableSkeleton columns={6} />}

      {filteredUsers.length > 0 && (
        <table className="records-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.username}</td>
                <td>{u.email}</td>
                <td>{u.role.name}</td>
                <td>
                  <span className={`status-pill ${u.isActive ? 'active' : 'inactive'}`}>
                    {u.isActive ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="table-action-btn" onClick={() => startEditing(u)} style={{ marginRight: 8 }}>
                    Edit
                  </button>
                  <button className="table-action-btn" onClick={() => startResetting(u)} style={{ marginRight: 8 }}>
                    Reset Password
                  </button>
                  <button className="table-action-btn" onClick={() => toggleActive(u)}>
                    {u.isActive ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {filteredUsers.length > 0 && (
        <div className="record-cards">
          {filteredUsers.map((u) => (
            <div className="record-card" key={u.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <strong>{u.name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.username} · {u.role.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email}</div>
                </div>
                <span className={`status-pill ${u.isActive ? 'active' : 'inactive'}`}>
                  {u.isActive ? 'Active' : 'Disabled'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="table-action-btn" onClick={() => startEditing(u)} style={{ flex: 1 }}>
                  Edit
                </button>
                <button className="table-action-btn" onClick={() => startResetting(u)} style={{ flex: 1 }}>
                  Reset Password
                </button>
                <button className="table-action-btn" onClick={() => toggleActive(u)} style={{ flex: 1 }}>
                  {u.isActive ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && users.length === 0 && (
        <div className="empty-state">
          <IconInbox />
          <div className="empty-title">No users found</div>
          <div className="empty-hint">Add one above to get started.</div>
        </div>
      )}

      {!loading && users.length > 0 && filteredUsers.length === 0 && (
        <div className="empty-state">
          <IconInbox />
          <div className="empty-title">No matches for this search</div>
          <div className="empty-hint">Try a different name, username, email, or role.</div>
        </div>
      )}

      {editing && (
        <div className="modal-overlay" role="presentation">
          <div ref={modalRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-user-title" style={{ textAlign: 'left', maxWidth: 440 }}>
            <h3 id="edit-user-title" style={{ marginTop: 0, textAlign: 'center' }}>
              Edit User: {editing.username}
            </h3>
            <form onSubmit={saveEdit}>
              <div className="field">
                <label>
                  Name<span className="required-mark"> *</span>
                  <input
                    ref={modalFirstFieldRef}
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    required
                  />
                </label>
              </div>
              <div className="field">
                <label>
                  Email<span className="required-mark"> *</span>
                  <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} required />
                </label>
              </div>
              <div className="field">
                <label>
                  Role<span className="required-mark"> *</span>
                  <select value={editForm.roleId} onChange={(e) => setEditForm({ ...editForm, roleId: e.target.value })} required>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              {editError && <div className="error-text">{editError}</div>}
              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setEditing(null)} disabled={editSaving}>
                  Cancel
                </button>
                <button type="submit" className="confirm-btn" disabled={editSaving}>
                  {editSaving && <span className="spinner" />}
                  {editSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {resetting && (
        <div className="modal-overlay" role="presentation">
          <div ref={modalRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="reset-password-title" style={{ textAlign: 'left', maxWidth: 440 }}>
            <h3 id="reset-password-title" style={{ marginTop: 0, textAlign: 'center' }}>
              Reset Password: {resetting.username}
            </h3>
            <p style={{ marginTop: 0, color: 'var(--text-muted)', fontSize: 13 }}>
              Sets this user's password directly — they are not notified, so share the new password with them yourself.
            </p>
            <form onSubmit={submitReset}>
              <div className="field">
                <label>
                  New Password<span className="required-mark"> *</span>
                  <PasswordInput
                    id="new-password"
                    value={resetForm.newPassword}
                    onChange={(e) => setResetForm({ ...resetForm, newPassword: e.target.value })}
                    autoComplete="new-password"
                    required
                  />
                </label>
              </div>
              <div className="field">
                <label>
                  Confirm New Password<span className="required-mark"> *</span>
                  <PasswordInput
                    id="confirm-password"
                    value={resetForm.confirmPassword}
                    onChange={(e) => setResetForm({ ...resetForm, confirmPassword: e.target.value })}
                    autoComplete="new-password"
                    required
                  />
                </label>
              </div>
              {resetError && <div className="error-text">{resetError}</div>}
              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setResetting(null)} disabled={resetSaving}>
                  Cancel
                </button>
                <button type="submit" className="confirm-btn" disabled={resetSaving}>
                  {resetSaving && <span className="spinner" />}
                  {resetSaving ? 'Saving…' : 'Reset Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
