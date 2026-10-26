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
  // Gates the HR/Admin Insights dashboard (attendance trends, working-hours
  // distribution, unit/team breakdowns). Deliberately separate from
  // VIEW_DASHBOARD — this is aggregated data about the whole workforce,
  // more sensitive than the per-day table Security already sees, so it
  // gets its own real permission rather than reusing an existing one or a
  // UI-only role check. Added 2026-10-05.
  'VIEW_REPORTS',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['SECURITY', 'HR', 'ADMIN'] as const;
export type RoleName = (typeof ROLES)[number];

// Narrowed from the original v1-flat "every role gets every permission"
// (spec §3) per explicit user request, 2026-09-04: Security gets the core
// recording workflow + Dashboard; HR gets Dashboard + Employees (no
// recording — HR logs in to the Dashboard directly, not the recording
// screen); only Admin gets Users/Missing Movements/Settings (and
// therefore the Audit Log, which is gated behind MANAGE_SETTINGS). This
// is the exact scenario the permission-table/guard infrastructure was
// built to make cheap — no endpoint code changed, only this mapping.
//
// CORRECT_RECORDS added to SECURITY 2026-10-26, by request — a guard is
// often the one who'd actually know a tap was missed that shift, and the
// page (renamed from "Corrections" the same day, since nothing on it
// edits an existing record anymore — only fills in a genuine gap) is now
// safe for Security specifically because it never lets anyone touch a
// record that already has a real value, only add one that's missing.
// Still deliberately NOT given VIEW_REPORTS — the separate, broader
// HR/Admin workforce-analytics dashboard stays off-limits; this page's
// own "who's missing a movement" list (MovementsService.missingInRange)
// was built scoped to CORRECT_RECORDS specifically so it doesn't need
// VIEW_REPORTS either. Changing this constant alone does NOT update an
// already-seeded production database — see decisions.md.
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  SECURITY: ['RECORD_ENTRY', 'RECORD_EXIT', 'VIEW_DASHBOARD', 'VIEW_EMPLOYEE_HISTORY', 'SEND_EMAIL', 'DOWNLOAD_REPORT', 'CORRECT_RECORDS'],
  HR: ['VIEW_DASHBOARD', 'VIEW_EMPLOYEE_HISTORY', 'SEND_EMAIL', 'DOWNLOAD_REPORT', 'MANAGE_EMPLOYEES', 'VIEW_REPORTS'],
  ADMIN: [...PERMISSIONS],
};
