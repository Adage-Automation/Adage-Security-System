import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, ApiError } from '../auth/AuthContext';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      navigate('/');
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

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="username">Username or Email</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <div className="error-text" role="alert">
              {error}
            </div>
          )}
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting && <span className="spinner" />}
            {submitting ? 'Signing in…' : 'Login'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '14px' }}>
          <a href="#" onClick={(e) => e.preventDefault()}>
            Forgot password?
          </a>
        </p>
      </div>
    </div>
  );
}
