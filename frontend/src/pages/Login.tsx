import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { ApiError } from '../api/client';
import { PasswordInput } from '../components/PasswordInput';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordResetSuccess = Boolean((location.state as { passwordResetSuccess?: boolean } | null)?.passwordResetSuccess);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const loggedInUser = await login(username, password);
      // HR doesn't have the Security recording screen — send them straight
      // to the Dashboard. Everyone else (SECURITY, ADMIN) lands on the
      // recording screen as before.
      navigate(loggedInUser.role === 'HR' ? '/dashboard' : '/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid username or password.');
      } else if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts. Please wait a moment and try again.');
      } else {
        setError('Unable to sign in. Please check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/logo.png" alt="Adage" className="login-logo-img" />
        <div className="subtitle">Security System</div>

        {passwordResetSuccess && (
          <div className="status-banner success" style={{ marginBottom: 16 }} aria-live="polite">
            Password updated. You can now log in with your new password.
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <PasswordInput
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </div>
          {error && (
            <div id="login-error" className="error-text" role="alert" aria-live="assertive">
              {error}
            </div>
          )}
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting && <span className="spinner" />}
            {submitting ? 'Signing in…' : 'Login'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '14px' }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
      </div>
    </div>
  );
}
