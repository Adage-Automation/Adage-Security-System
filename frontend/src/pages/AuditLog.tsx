import { CSSProperties, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { IconHistory, IconInbox, IconDownload, IconXCircle } from '../components/icons';
import { AdminNav } from '../components/AdminNav';
import { TableSkeleton } from '../components/TableSkeleton';
import { downloadFile } from '../utils/downloadFile';
import { todayIso } from '../utils/date';

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

// Every non-failure, non-disable action used to fall into the same
// 'success' (green) bucket — USER_LOGIN, EXIT_RECORDED, EMAIL_SENT and a
// dozen others all looked identical, defeating the point of a color badge
// for quickly scanning a long log. Split into: error (red, unchanged),
// pending (amber, unchanged — deactivation/disable/logout), account (brand
// teal — login and password-reset events), success (green — reserved for
// the actual movement-recording actions, the core operational data this
// log exists to track), neutral (grey — everything else: CRUD on
// employees/users/settings, email, report downloads). Found in the 2026-10
// UI/UX review.
function actionTone(action: string): 'success' | 'error' | 'pending' | 'account' | 'neutral' {
  if (action.includes('FAILED')) return 'error';
  if (action.includes('DEACTIVATED') || action.includes('DISABLED') || action === 'USER_LOGOUT') return 'pending';
  if (action.includes('CORRECTED') || action.includes('MISSING')) return 'pending';
  if (action === 'USER_LOGIN' || action.includes('PASSWORD_RESET')) return 'account';
  if (action === 'ENTRY_RECORDED' || action === 'EXIT_RECORDED') return 'success';
  return 'neutral';
}

export function AuditLog() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [entityType, setEntityType] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Guards against a filter reset racing a "Load More" page fetch — same
  // monotonic-sequence pattern used elsewhere in the app (Dashboard,
  // employee search). Without it, a stale page response landing after a
  // filter change could append rows from the old filter onto the new table.
  const seqRef = useRef(0);

  const hasActiveFilters = Boolean(entityType || userId || from || to || q.trim());

  useEffect(() => {
    api.get<UserOption[]>('/users').then(setUsers).catch(() => setUsers([]));
  }, []);

  function load(reset: boolean) {
    setLoading(true);
    const seq = ++seqRef.current;
    const nextSkip = reset ? 0 : skip;
    const params = new URLSearchParams({ skip: String(nextSkip), take: String(PAGE_SIZE) });
    if (entityType) params.set('entityType', entityType);
    if (userId) params.set('userId', userId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (q.trim()) params.set('q', q.trim());

    api
      .get<AuditLogRow[]>(`/audit-logs?${params.toString()}`)
      .then((res) => {
        if (seq !== seqRef.current) return;
        setRows((prev) => (reset ? res : [...prev, ...res]));
        setHasMore(res.length === PAGE_SIZE);
        setSkip(nextSkip + res.length);
      })
      .catch(() => {
        if (seq !== seqRef.current) return;
        if (reset) setRows([]);
        setHasMore(false);
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
  }

  useEffect(() => {
    // Keyword search gets a debounce (the admin is typing); the other
    // filters are discrete selections that should react immediately.
    const t = setTimeout(() => load(true), q.trim() ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, userId, from, to, q]);

  function clearFilters() {
    setEntityType('');
    setUserId('');
    setFrom('');
    setTo('');
    setQ('');
  }

  // The only major table in the app without an Export, before this — an
  // admin investigating an incident had no way to pull matching rows out
  // for a compliance/HR record short of screenshotting. Found in the
  // 2026-10-27 admin role-flow audit. Exports whatever's currently filtered
  // on screen, same params as the live list() call above.
  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const params = new URLSearchParams();
      if (entityType) params.set('entityType', entityType);
      if (userId) params.set('userId', userId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (q.trim()) params.set('q', q.trim());
      await downloadFile(`/api/audit-logs/export?${params.toString()}`, `audit-log-${todayIso()}.xlsx`);
    } catch (err: any) {
      setExportError(err?.message ?? 'Failed to export audit log.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="page-wide">
      <AdminNav />

      <div className="page-heading">
        <IconHistory />
        Audit Log
      </div>

      {exportError && (
        <div className="status-banner error" role="alert">
          <IconXCircle />
          {exportError}
        </div>
      )}

      {/* minWidth overrides below are scoped to this page's fields, not
          `.filters-bar` itself (its 180px/260px defaults are shared by five
          other pages) — this row has six items (five fields + Export) and
          reads cramped/congested at the global default on a laptop-width
          screen. From/To were briefly given their own bordered grouping box
          (2026-10-27 design audit); dropped same day since five plain
          fields in a row read cleaner than four plain fields plus one
          boxed pair. */}
      <div className="filters-bar">
        <div className="field" style={{ minWidth: 130 }}>
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
        <div className="field" style={{ minWidth: 140 }}>
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
        <div className="field" style={{ minWidth: 130 }}>
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={to || undefined} />
          </label>
        </div>
        <div className="field" style={{ minWidth: 130 }}>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined} />
          </label>
        </div>
        <div className="field" style={{ minWidth: 180 }}>
          <label>
            Search
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Action, entity, user, or IP…"
              aria-label="Search audit log entries by action, entity type, user, or IP address"
            />
          </label>
        </div>
        {/* `.table-action-btn`'s own height (~36px, via its min-height) is
            shorter than a `.field` input's (~46px, from its larger padding
            and font-size) — bottom-aligning via alignSelf alone still left
            a visible top-edge mismatch against the inputs beside it.
            minHeight below matches the input so the whole button lines up,
            not just its bottom edge. Found in the 2026-10-27 UI check. */}
        {hasActiveFilters && (
          <button type="button" className="table-action-btn" style={{ alignSelf: 'flex-end', minHeight: 46 }} onClick={clearFilters}>
            Clear all filters
          </button>
        )}
        <button
          type="button"
          className="table-action-btn"
          style={{ alignSelf: 'flex-end', minHeight: 46, display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={handleExport}
          disabled={exporting || rows.length === 0}
        >
          {exporting ? <span className="spinner dark" /> : <IconDownload style={{ width: 16, height: 16 }} />}
          {exporting ? 'Exporting…' : 'Export to Excel'}
        </button>
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

          <div className="record-cards">
            {rows.map((row) => (
              <div className="record-card" key={row.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span className="status-pill" style={actionToneStyle(actionTone(row.action))}>
                    {row.action.replace(/_/g, ' ')}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(row.createdAt).toLocaleString('en-IN')}</span>
                </div>
                <div style={{ fontSize: 13 }}>
                  {row.entityType ?? '—'}{row.entityId ? ` #${row.entityId}` : ''}
                  {row.user?.name ? ` · ${row.user.name}` : ''}
                </div>
                {/* IP address omitted here (unlike the desktop table's own
                    column) — low-value for a mobile glance, and competes
                    with entity/user info for space. Still in the Excel
                    export above for a real investigation. Found in the
                    2026-10-27 design audit. */}
              </div>
            ))}
          </div>

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
          <div className="empty-title">{hasActiveFilters ? 'No matches for this filter' : 'No audit log entries yet'}</div>
          <div className="empty-hint">
            {hasActiveFilters ? 'Try a different date range, entity type, user, or search term.' : 'Entries appear here as actions are taken across the app.'}
          </div>
          {hasActiveFilters && (
            <button type="button" className="table-action-btn" onClick={clearFilters} style={{ marginTop: 12 }}>
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function actionToneStyle(tone: 'success' | 'error' | 'pending' | 'account' | 'neutral'): CSSProperties {
  switch (tone) {
    case 'error':
      return { background: 'var(--exit-tint)', color: 'var(--exit-red)' };
    case 'pending':
      return { background: 'var(--pending-tint)', color: 'var(--pending-amber)' };
    case 'account':
      return { background: 'var(--brand-tint)', color: 'var(--brand-dark)' };
    case 'success':
      return { background: 'var(--entry-tint)', color: 'var(--entry-green)' };
    default:
      return { background: '#eef1f0', color: 'var(--text-muted)' };
  }
}
