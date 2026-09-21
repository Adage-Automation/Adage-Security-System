import { CSSProperties, useEffect, useState } from 'react';
import { api } from '../api/client';
import { IconHistory, IconInbox } from '../components/icons';
import { AdminNav } from '../components/AdminNav';
import { TableSkeleton } from '../components/TableSkeleton';

interface AuditLogRow {
  id: number;
  userId: number | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  ipAddress: string | null;
  createdAt: string;
  user?: { id: number; name: string } | null;
}

interface UserOption {
  id: number;
  name: string;
}

const ENTITY_TYPES = ['MovementRecord', 'Employee', 'User', 'Setting', 'EmailLog'];
const PAGE_SIZE = 50;

function actionTone(action: string): 'success' | 'error' | 'pending' | 'neutral' {
  if (action.includes('FAILED')) return 'error';
  if (action.includes('DEACTIVATED') || action.includes('DISABLED') || action.includes('LOGOUT')) return 'pending';
  if (action.includes('CORRECTED') || action.includes('MISSING')) return 'pending';
  return 'success';
}

export function AuditLog() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [entityType, setEntityType] = useState('');
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get<UserOption[]>('/users').then(setUsers).catch(() => setUsers([]));
  }, []);

  function load(reset: boolean) {
    setLoading(true);
    const nextSkip = reset ? 0 : skip;
    const params = new URLSearchParams({ skip: String(nextSkip), take: String(PAGE_SIZE) });
    if (entityType) params.set('entityType', entityType);
    if (userId) params.set('userId', userId);

    api
      .get<AuditLogRow[]>(`/audit-logs?${params.toString()}`)
      .then((res) => {
        setRows(reset ? res : [...rows, ...res]);
        setHasMore(res.length === PAGE_SIZE);
        setSkip(nextSkip + res.length);
      })
      .catch(() => {
        if (reset) setRows([]);
        setHasMore(false);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, userId]);

  return (
    <div className="page-wide">
      <AdminNav />

      <div className="page-heading">
        <IconHistory />
        Audit Log
      </div>

      <div className="filters-bar">
        <div className="field">
          <label>
            Entity Type
            <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              <option value="">All</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="field">
          <label>
            Performed By
            <select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">All Users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading && rows.length === 0 && <TableSkeleton columns={5} />}

      {rows.length > 0 && (
        <>
          <table className="records-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Performed By</th>
                <th>IP Address</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(row.createdAt).toLocaleString('en-IN')}</td>
                  <td>
                    <span className="status-pill" style={actionToneStyle(actionTone(row.action))}>
                      {row.action.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td>{row.entityType ?? '—'}{row.entityId ? ` #${row.entityId}` : ''}</td>
                  <td>{row.user?.name ?? '—'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{row.ipAddress ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {hasMore && (
            <div className="action-row">
              <button onClick={() => load(false)} disabled={loading}>
                {loading && <span className="spinner dark" />}
                {loading ? 'Loading…' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}

      {rows.length === 0 && !loading && (
        <div className="empty-state">
          <IconInbox />
          <div className="empty-title">No audit log entries</div>
          <div className="empty-hint">Try a different entity type or user filter.</div>
        </div>
      )}
    </div>
  );
}

function actionToneStyle(tone: 'success' | 'error' | 'pending' | 'neutral'): CSSProperties {
  switch (tone) {
    case 'error':
      return { background: 'var(--exit-tint)', color: 'var(--exit-red)' };
    case 'pending':
      return { background: 'var(--pending-tint)', color: 'var(--pending-amber)' };
    case 'success':
      return { background: 'var(--entry-tint)', color: 'var(--entry-green)' };
    default:
      return { background: '#eef1f0', color: 'var(--text-muted)' };
  }
}
