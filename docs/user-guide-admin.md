# User Guide — Admin

Covers everything in the [Security](./user-guide-security.md) and [HR](./user-guide-hr.md) guides, plus the screens only Admin can reach: Users, Corrections, Audit Log, and Settings. (Employees is shared with HR, not Admin-only — see the [HR guide](./user-guide-hr.md) if that's what you're looking for.)

## Employee management

Navigate to **Employees** (also available to HR, not Admin-only).

- **Add employee**: fill in Employee Code (must be unique), Name, and Email, then **Add Employee**. The email you enter here is where their movement-record emails will be sent — double check it. (Department/Designation aren't collected — they turned out to be unused anywhere in the system and were dropped from this form by request.)
- **Deactivate**: marks an employee inactive instead of deleting them. They stop appearing in the Security search box, but every historical movement record stays fully intact and visible on the Dashboard. Use this when someone leaves the company — never delete an employee outright.
- **Reactivate**: brings a deactivated employee back into the Security search box.

Deactivated employees still appear when correcting historical records (see below), since you may need to fix history for someone who has since left.

## User management

Navigate to **Users**.

- **Add user**: Name, Email, Username, temporary Password, and Role (SECURITY / HR / ADMIN). The role determines what they can access: Security gets the recording workflow plus Dashboard; HR additionally gets Employees; only Admin gets Users, Corrections, Audit Log, and Settings. Choose carefully — it's not just a label.
- **Disable / Enable**: disabling a user immediately blocks login (even an existing open session is re-checked on the next request and will be logged out) — use this rather than deleting a user, since audit history references them.
- **Reset password**: sets a new password for a user who's lost theirs. There's no self-service "forgot password" flow yet — a user has to ask an Admin.

## Settings

Navigate to **Settings**. These values are used throughout the system instead of anything being hard-coded:

- **Company Name** — appears on generated reports.
- **Timezone** — should stay `Asia/Kolkata` unless the company's operating region changes; movement timestamps are computed against this.
- **Security Email** — automatically CC'd on every employee record email that's sent (no one has to type it manually).
- **Email Sender Name** — the "from" display name on outgoing emails.

## Correcting a movement record

Mistakes happen — a guard taps EXIT when they meant ENTRY, or forgets to record a movement at all. Corrections require the `CORRECT_RECORDS` permission — currently Admin only.

**Important: a correction never erases the original record.** The system marks the original as "superseded" and creates a new corrected record linked to it — the full history, including the mistake, is always preserved and visible in the audit log. This is by design, so movement history can never be silently altered.

Navigate to **Corrections**. Search for the employee (this search includes inactive/deactivated employees too, so you can still fix history for someone who has since left) and pick the date. Their movements for that day appear in a table — tap **Correct** next to the record that's wrong, or **Add Missing Record** if a movement was never captured at all. Either way you'll be asked for the corrected movement type, time, and a **reason** — the reason is required and is stored in the audit trail alongside the correction.

## Audit log

Every login/logout, every ENTRY/EXIT, every correction, every employee/user change, every settings change, and every email attempt (sent or failed) is recorded in the audit log with who did it and when. Navigate to **Audit Log** to browse it — filter by entity type or by who performed the action, and use **Load More** to page through older history. Nothing is ever silently lost.

## Things that are intentionally not built

- **No working-hours calculation anywhere** — the system is a movement register, not a timesheet.
- **No automatic or scheduled emails** — every email requires someone to explicitly click EMAIL DETAILS.
- **No keyboard shortcuts** for ENTRY/EXIT or any other state-changing action, anywhere in the app — this is deliberate, to prevent an accidental keypress from recording the wrong thing.
