import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { IconSettings as IconSettingsGear, IconCheckCircle } from '../components/icons';
import { AdminNav } from '../components/AdminNav';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Field {
  key: string;
  label: string;
  required: boolean;
  validate?: (value: string) => string | null;
}

const FIELDS: Field[] = [
  { key: 'COMPANY_NAME', label: 'Company Name', required: true },
  { key: 'TIMEZONE', label: 'Timezone', required: true },
  {
    key: 'SECURITY_EMAIL',
    label: 'Security Email (CC on all employee record emails)',
    required: false,
    validate: (value) => (value.trim() && !EMAIL_PATTERN.test(value.trim()) ? 'Enter a valid email address' : null),
  },
  { key: 'EMAIL_SENDER_NAME', label: 'Email Sender Name', required: true },
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

  useEffect(() => {
    api
      .get<Record<string, string>>('/settings')
      .then((res) => {
        setSaved(res);
        setDraft(res);
      })
      .catch(() => {
        setSaved({});
        setDraft({});
      })
      .finally(() => setLoading(false));
  }, []);

  const isDirty = FIELDS.some((f) => (draft[f.key] ?? '') !== (saved[f.key] ?? ''));

  function setValue(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: '' }));
  }

  function validateAll(): boolean {
    const nextErrors: Record<string, string> = {};
    for (const f of FIELDS) {
      const value = (draft[f.key] ?? '').trim();
      if (f.required && !value) {
        nextErrors[f.key] = `${f.label.split(' (')[0]} is required`;
        continue;
      }
      const customError = f.validate?.(draft[f.key] ?? '');
      if (customError) nextErrors[f.key] = customError;
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function saveAll() {
    if (!validateAll()) {
      setConfirmation({ kind: 'error', message: 'Fix the highlighted fields before saving.' });
      setTimeout(() => setConfirmation(null), 2500);
      return;
    }
    const changed = FIELDS.filter((f) => (draft[f.key] ?? '') !== (saved[f.key] ?? ''));
    if (changed.length === 0) return;

    setSaving(true);
    try {
      await Promise.all(changed.map((f) => api.put(`/settings/${f.key}`, { value: draft[f.key] ?? '' })));
      setSaved((s) => ({ ...s, ...Object.fromEntries(changed.map((f) => [f.key, draft[f.key] ?? ''])) }));
      setConfirmation({ kind: 'success', message: `Saved ${changed.length} change${changed.length === 1 ? '' : 's'}` });
    } catch {
      setConfirmation({ kind: 'error', message: 'Unable to save changes. Please try again.' });
    } finally {
      setSaving(false);
      setTimeout(() => setConfirmation(null), 2500);
    }
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
