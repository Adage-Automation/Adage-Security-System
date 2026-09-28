import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { IconArrowLeft, IconGrid, IconUsers, IconSettings, IconEdit, IconHistory } from './icons';

// Shared cross-links for every admin/dashboard-adjacent screen. Each link
// only renders if the current user actually holds the permission its
// destination requires — this is a UX nicety (don't dangle a link to a
// page that will just redirect away), not the security boundary itself.
// The real enforcement is server-side (PermissionsGuard on every request)
// and in ProtectedRoute's redirect — see docs/decisions.md, 2026-09-04.
//
// NavLink (not Link) so react-router adds an `active` class to whichever
// link matches the current route — styled in global.css so it's obvious
// at a glance which tab you're on (2026-09-28 UX request).
export function AdminNav() {
  const { hasPermission } = useAuth();

  return (
    <div className="nav-links">
      {hasPermission('RECORD_ENTRY') && (
        <NavLink to="/" end>
          <IconArrowLeft />
          Record Movement
        </NavLink>
      )}
      {hasPermission('VIEW_DASHBOARD') && (
        <NavLink to="/dashboard">
          <IconGrid />
          Dashboard
        </NavLink>
      )}
      {hasPermission('MANAGE_EMPLOYEES') && (
        <NavLink to="/employees">
          <IconUsers />
          Employees
        </NavLink>
      )}
      {hasPermission('MANAGE_USERS') && (
        <NavLink to="/users">
          <IconUsers />
          Users
        </NavLink>
      )}
      {hasPermission('CORRECT_RECORDS') && (
        <NavLink to="/corrections">
          <IconEdit />
          Corrections
        </NavLink>
      )}
      {hasPermission('MANAGE_SETTINGS') && (
        <NavLink to="/audit-log">
          <IconHistory />
          Audit Log
        </NavLink>
      )}
      {hasPermission('MANAGE_SETTINGS') && (
        <NavLink to="/settings">
          <IconSettings />
          Settings
        </NavLink>
      )}
    </div>
  );
}
