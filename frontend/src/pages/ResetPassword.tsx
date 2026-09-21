import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { PasswordInput } from '../components/PasswordInput';

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword });
      navigate('/login', { state: { passwordResetSuccess: true } });
    } catch (err: any) {
      if (err?.status === 429) {
        setError('Too many attempts. Please wait a moment and try again.');
      } else {
        // The backend returns a clean 400 with this exact message for an
        // invalid/expired/already-used token — pass it straight through.
        setError(err?.message ?? 'Unable to reset your password. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="login-page">
        <div className="login-card">
          <img src="/logo.png" alt="Adage" className="login-logo-img" />
          <div className="subtitle">Reset Password</div>
          <p style={{ textAlign: 'center' }}>
            This link is missing its reset token. Please use the link from your password reset email, or request a
            new one.
          </p>
          <p style={{ textAlign: 'center', marginTop: 16 }}>
            <Link to="/forgot-password">Request a new link</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/logo.png" alt="Adage" className="login-logo-img" />
        <div className="subtitle">Choose a New Password</div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="newPassword">New Password</label>
            <PasswordInput
              id="newPassword"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">Confirm New Password</label>
            <PasswordInput
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          {error && (
            <div className="error-text" role="alert">
              {error}
              {error.toLowerCase().includes('expired') || error.toLowerCase().includes('invalid') ? (
                <>
                  {' '}
                  <Link to="/forgot-password">Request a new link</Link>
                </>
              ) : null}
            </div>
          )}
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting && <span className="spinner" />}
            {submitting ? 'Saving…' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
