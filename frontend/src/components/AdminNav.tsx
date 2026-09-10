import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { IconArrowLeft, IconGrid, IconUsers, IconSettings, IconEdit, IconHistory } from './icons';

// Shared cross-links for every admin/dashboard-adjacent screen. Each link
// only renders if the current user actually holds the permission its
// destination requires — this is a UX nicety (don't dangle a link to a
// page that will just redirect away), not the security boundary itself.
// The real enforcement is server-side (PermissionsGuard on every request)
// and in ProtectedRoute's redirect — see docs/decisions.md, 2026-09-04.
export function AdminNav() {
  const { hasPermission } = useAuth();

  return (
    <div className="nav-links">
      <Link to="/">
        <IconArrowLeft />
        Record Movement
      </Link>
      {hasPermission('VIEW_DASHBOARD') && (
        <Link to="/dashboard">
          <IconGrid />
          Dashboard
        </Link>
      )}
      {hasPermission('MANAGE_EMPLOYEES') && (
        <Link to="/employees">
          <IconUsers />
          Employees
        </Link>
      )}
      {hasPermission('MANAGE_USERS') && (
        <Link to="/users">
          <IconUsers />
          Users
        </Link>
      )}
      {hasPermission('CORRECT_RECORDS') && (
        <Link to="/corrections">
          <IconEdit />
          Corrections
        </Link>
      )}
      {hasPermission('MANAGE_SETTINGS') && (
        <Link to="/audit-log">
          <IconHistory />
          Audit Log
        </Link>
      )}
      {hasPermission('MANAGE_SETTINGS') && (
        <Link to="/settings">
          <IconSettings />
          Settings
        </Link>
      )}
    </div>
  );
}
