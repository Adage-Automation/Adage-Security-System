import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { IconSettings as IconSettingsGear, IconCheckCircle } from '../components/icons';
import { AdminNav } from '../components/AdminNav';

interface Field {
  key: string;
  label: string;
  required: boolean;
  validate?: (value: string) => string | null;
}

// No security-email field here — with multiple security units (each a
// shared login, 2026-09-25), CC is the sending account's own login email,
// not a single global setting. See Users screen / docs/decisions.md.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const FIELDS: Field[] = [
  { key: 'COMPANY_NAME', label: 'Company Name', required: true },
  { key: 'TIMEZONE', label: 'Timezone', required: true },
  { key: 'EMAIL_SENDER_NAME', label: 'Email Sender Name', required: true },
  // Reference-only window for the Insights hours-shortfall metric — the
  // office uses flexible timing, so these are never used to flag someone
  // as "late," only shown as a reference band on charts. The only real
  // compliance check is EXPECTED_DAILY_HOURS. Added 2026-10-05.
  {
    key: 'SHIFT_REFERENCE_START',
    label: 'Shift Reference Start (HH:MM, informational only)',
    required: true,
    validate: (v) => (TIME_RE.test(v.trim()) ? null : 'Use 24-hour HH:MM, e.g. 09:30'),
  },
  {
    key: 'SHIFT_REFERENCE_END',
    label: 'Shift Reference End (HH:MM, informational only)',
    required: true,
    validate: (v) => (TIME_RE.test(v.trim()) ? null : 'Use 24-hour HH:MM, e.g. 18:30'),
  },
  {
    key: 'EXPECTED_DAILY_HOURS',
    label: 'Expected Daily Hours',
    required: true,
    validate: (v) => {
      const n = Number(v.trim());
      return Number.isFinite(n) && n > 0 && n <= 24 ? null : 'Enter a number of hours between 0 and 24';
    },
  },
];

// Single "Save all changes" form, not a per-field save button each — the
// per-field pattern felt unpolished next to every other form in the app,
// which already saves as one action (found in the 2026-09-22 UX audit).
export function Settings() {
  // `saved` is the last-known-persisted values (what the server has);
  // `draft` is what's currently in the inputs. Comparing the two is how
  // the "unsaved changes" indicator and the save button's enabled state
  // are derived — no separate "dirty" flag to keep in sync by hand.
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  // Without this, a failed initial load rendered the same blank form (every
  // field empty, flagged invalid only once Save was clicked) as a genuinely
  // unseeded one — nothing told the admin the fetch itself had failed.
  // Found in the 2026-10 audit.
  const [loadError, setLoadError] = useState(false);

  function load() {
    setLoading(true);
    setLoadError(false);
    api
      .get<Record<string, string>>('/settings')
      .then((res) => {
        setSaved(res);
        setDraft(res);
      })
      .catch(() => {
        setSaved({});
        setDraft({});
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const isDirty = FIELDS.some((f) => (draft[f.key] ?? '') !== (saved[f.key] ?? ''));

  function setValue(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: '' }));
  }

  // Only validates the fields actually being saved — an unseeded/invalid
  // field the admin isn't touching right now shouldn't block an unrelated,
  // possibly urgent, fix to a different field. Found in the 2026-10 audit.
  function validateChanged(changed: Field[]): boolean {
    const nextErrors: Record<string, string> = {};
    for (const f of changed) {
      const value = (draft[f.key] ?? '').trim();
      if (f.required && !value) {
        nextErrors[f.key] = `${f.label.split(' (')[0]} is required`;
        continue;
      }
      const customError = f.validate?.(draft[f.key] ?? '');
      if (customError) nextErrors[f.key] = customError;
    }
    setErrors((e) => ({ ...e, ...nextErrors }));
    return Object.keys(nextErrors).length === 0;
  }

  async function saveAll() {
    const changed = FIELDS.filter((f) => (draft[f.key] ?? '') !== (saved[f.key] ?? ''));
    if (changed.length === 0) return;
    if (!validateChanged(changed)) {
      setConfirmation({ kind: 'error', message: 'Fix the highlighted fields before saving.' });
      setTimeout(() => setConfirmation(null), 2500);
      return;
    }

    setSaving(true);
    // Promise.allSettled, not Promise.all — a mid-batch failure with
    // Promise.all used to reject immediately, skipping the setSaved below
    // entirely even for fields that *did* persist server-side. Those
    // fields then stayed marked "unsaved" client-side (and would be
    // silently re-sent next time) while the error message implied nothing
    // saved at all. Found in the 2026-09-25 audit.
    const results = await Promise.allSettled(
      changed.map((f) => api.put(`/settings/${f.key}`, { value: draft[f.key] ?? '' }).then(() => f.key)),
    );
    const succeededKeys = results.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled').map((r) => r.value);
    const failedCount = results.length - succeededKeys.length;
    if (succeededKeys.length > 0) {
      setSaved((s) => ({ ...s, ...Object.fromEntries(succeededKeys.map((key) => [key, draft[key] ?? ''])) }));
    }
    if (failedCount === 0) {
      setConfirmation({ kind: 'success', message: `Saved ${succeededKeys.length} change${succeededKeys.length === 1 ? '' : 's'}` });
    } else if (succeededKeys.length > 0) {
      setConfirmation({ kind: 'error', message: `Saved ${succeededKeys.length}, but ${failedCount} failed. Please try again.` });
    } else {
      setConfirmation({ kind: 'error', message: 'Unable to save changes. Please try again.' });
    }
    setSaving(false);
    setTimeout(() => setConfirmation(null), 2500);
  }

  return (
    <div className="page-wide">
      <AdminNav />

      <div className="page-heading">
        <IconSettingsGear />
        System Settings
      </div>

      {confirmation && (
        <div
          className={`status-banner ${confirmation.kind}`}
          role="status"
          aria-live="polite"
          style={{ justifyContent: 'center', textAlign: 'center' }}
        >
          {confirmation.kind === 'success' && <IconCheckCircle />}
          {confirmation.message}
        </div>
      )}

      {/* Every other admin screen (Employees, Users, Audit Log) shows a
          skeleton while its data loads — this form fetched silently and
          just left a blank card until it resolved, looking frozen on a
          slow connection. Found in the 2026-09-28 admin-page audit.
          TableSkeleton isn't a fit here (this is a field list, not a
          table), so a small field-shaped placeholder is used instead. */}
      {!loading && loadError && (
        <div className="status-banner error" role="alert">
          Failed to load settings.{' '}
          <button type="button" onClick={load} style={{ textDecoration: 'underline', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, font: 'inherit' }}>
            Retry
          </button>
        </div>
      )}

      {loading && (
        <div className="section-card" aria-hidden="true">
          {FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <div className="skeleton skeleton-text" style={{ width: '30%', height: 12, marginBottom: 8 }} />
              <div className="skeleton skeleton-text" style={{ width: '100%', height: 38 }} />
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <form
          className="section-card"
          onSubmit={(e) => {
            e.preventDefault();
            void saveAll();
          }}
        >
          {FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label>
                {f.label}
                {f.required && <span className="required-mark"> *</span>}
                <input
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setValue(f.key, e.target.value)}
                  aria-invalid={Boolean(errors[f.key])}
                />
              </label>
              {errors[f.key] && <div className="error-text">{errors[f.key]}</div>}
            </div>
          ))}

          <div className="action-row" style={{ alignItems: 'center', gap: 12 }}>
            <button type="submit" disabled={!isDirty || saving}>
              {saving && <span className="spinner dark" />}
              {saving ? 'Saving…' : 'Save all changes'}
            </button>
            {isDirty && !saving && <span className="status-detail">Unsaved changes</span>}
          </div>
        </form>
      )}
    </div>
  );
}
