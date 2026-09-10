import { Navigate } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from '../auth/useAuth';

// Requires login, and optionally a specific permission. This is a UX
// convenience (redirect instead of a broken page full of failed API
// calls) — it is NOT the security boundary. The backend's PermissionsGuard
// enforces the real check on every request regardless of what this
// component does; hiding a route here is never sufficient on its own
// (spec §44 / docs/decisions.md).
export function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user, loading, hasPermission } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (permission && !hasPermission(permission)) return <Navigate to="/" replace />;

  return <>{children}</>;
}
