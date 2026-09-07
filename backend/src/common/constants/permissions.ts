export const PERMISSIONS = [
  'RECORD_ENTRY',
  'RECORD_EXIT',
  'VIEW_DASHBOARD',
  'VIEW_EMPLOYEE_HISTORY',
  'SEND_EMAIL',
  'DOWNLOAD_REPORT',
  'MANAGE_EMPLOYEES',
  'MANAGE_USERS',
  'MANAGE_SETTINGS',
  'CORRECT_RECORDS',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['SECURITY', 'HR', 'ADMIN'] as const;
export type RoleName = (typeof ROLES)[number];

// Narrowed from the original v1-flat "every role gets every permission"
// (spec §3) per explicit user request, 2026-09-04: Security gets the core
// recording workflow + Dashboard; HR additionally gets Employees; only
// Admin gets Users/Corrections/Settings (and therefore the Audit Log,
// which is gated behind MANAGE_SETTINGS). This is the exact scenario the
// permission-table/guard infrastructure was built to make cheap — no
// endpoint code changed, only this mapping.
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  SECURITY: ['RECORD_ENTRY', 'RECORD_EXIT', 'VIEW_DASHBOARD', 'VIEW_EMPLOYEE_HISTORY', 'SEND_EMAIL', 'DOWNLOAD_REPORT'],
  HR: ['RECORD_ENTRY', 'RECORD_EXIT', 'VIEW_DASHBOARD', 'VIEW_EMPLOYEE_HISTORY', 'SEND_EMAIL', 'DOWNLOAD_REPORT', 'MANAGE_EMPLOYEES'],
  ADMIN: [...PERMISSIONS],
};
