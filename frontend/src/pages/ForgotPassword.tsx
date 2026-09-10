import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Always the same message on success, regardless of whether the email
  // matched an account — the backend deliberately never reveals that
  // either (see AuthService.requestPasswordReset), so the UI can't leak
  // it back through a different message.
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err: any) {
      if (err?.status === 429) {
        setError('Too many attempts. Please wait a moment and try again.');
      } else {
        setError('Unable to send the reset link right now. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/logo.png" alt="Adage" className="login-logo-img" />
        <div className="subtitle">Reset Password</div>

        {sent ? (
          <>
            <p style={{ textAlign: 'center' }}>
              If that email address is registered, a password reset link has been sent. Check your inbox — the link
              expires in 1 hour.
            </p>
            <p style={{ textAlign: 'center', marginTop: 16 }}>
              <Link to="/login">Back to login</Link>
            </p>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
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
              {submitting ? 'Sending…' : 'Send Reset Link'}
            </button>
            <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '14px' }}>
              <Link to="/login">Back to login</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
