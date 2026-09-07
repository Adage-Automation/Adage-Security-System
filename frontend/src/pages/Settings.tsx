import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { IconSettings as IconSettingsGear, IconCheckCircle } from '../components/icons';
import { AdminNav } from '../components/AdminNav';

export function Settings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<Record<string, string>>('/settings').then(setSettings).catch(() => setSettings({}));
  }, []);

  async function save(key: string) {
    await api.put(`/settings/${key}`, { value: settings[key] });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const fields: Array<{ key: string; label: string }> = [
    { key: 'COMPANY_NAME', label: 'Company Name' },
    { key: 'TIMEZONE', label: 'Timezone' },
    { key: 'SECURITY_EMAIL', label: 'Security Email (CC on all employee record emails)' },
    { key: 'EMAIL_SENDER_NAME', label: 'Email Sender Name' },
  ];

  return (
    <div className="page">
      <AdminNav />

      <div className="page-heading">
        <IconSettingsGear />
        System Settings
      </div>
      {saved && (
        <div className="status-banner success">
          <IconCheckCircle />
          Saved
        </div>
      )}

      <div className="section-card">
        {fields.map((f) => (
          <div className="field" key={f.key}>
            <label>{f.label}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={settings[f.key] ?? ''}
                onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })}
                style={{ flex: 1 }}
              />
              <button className="table-action-btn" style={{ padding: '0 16px' }} onClick={() => save(f.key)}>
                Save
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
