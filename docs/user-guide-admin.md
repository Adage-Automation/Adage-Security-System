# User Guide — Admin

Covers everything in the [Security](./user-guide-security.md) and [HR](./user-guide-hr.md) guides, plus the screens only Admin can reach: Users, Corrections, Audit Log, and Settings. (Employees is shared with HR, not Admin-only — see the [HR guide](./user-guide-hr.md) if that's what you're looking for.)

## Employee management

Navigate to **Employees** (also available to HR, not Admin-only).

- **Add employee**: fill in Employee Code (must be unique) and Name; Email and Car Number are optional — leave either blank if you don't have it yet, and use **Edit** on the same screen once you do. The email you enter is where their movement-record emails will be sent — double check it. An employee with no email on file simply can't be sent EMAIL DETAILS until one is added (shown clearly on their details page).
- **Search**: the list is the full employee roster (200+ people), so use the search box (matches name, code, email, or car number) rather than scrolling — results load a page at a time with a **Load More** button.
- **Edit**: update an employee's name, optional email, or optional car number without changing the employee code.
- **Deactivate**: marks an employee inactive instead of deleting them. They stop appearing in the Security search box, but every historical movement record stays fully intact and visible on the Dashboard. Use this when someone leaves the company — never delete an employee outright.
- **Reactivate**: brings a deactivated employee back into the Security search box.

Deactivated employees still appear when correcting historical records (see below), since you may need to fix history for someone who has since left.

## User management

Navigate to **Users**.

- **Add user**: Name, Email, Username, temporary Password, and Role (SECURITY / HR / ADMIN). The role determines what they can access: Security gets the recording workflow plus Dashboard; HR gets Dashboard plus Employees (no recording — HR lands on the Dashboard after login, not the recording screen); only Admin gets Users, Corrections, Audit Log, and Settings. Choose carefully — it's not just a label.
- **Disable / Enable**: disabling a user immediately blocks login (even an existing open session is re-checked on the next request and will be logged out) — use this rather than deleting a user, since audit history references them.
- **Reset password**: sets a new password for a user who's lost theirs. Users can also use the self-service **Forgot password?** link on the login screen; it sends a single-use reset link to the registered email address.

## Settings

Navigate to **Settings**. These values are used throughout the system instead of anything being hard-coded:

- **Company Name** — appears on generated reports.
- **Timezone** — should stay `Asia/Kolkata` unless the company's operating region changes; movement timestamps are computed against this.
- **Security Email** — automatically CC'd on every employee record email that's sent (no one has to type it manually).
- **Email Sender Name** — the "from" display name on outgoing emails.

Edit as many fields as you need, then click **Save all changes** once — it's greyed out until something's actually changed, and shows an "Unsaved changes" note while you're mid-edit so you don't lose track of what you've touched. Only the fields you actually changed are saved.

## Correcting a movement record

Mistakes happen — a guard taps EXIT when they meant ENTRY, or forgets to record a movement at all. Corrections require the `CORRECT_RECORDS` permission — currently Admin only.

**Important: a correction never erases the original record.** The system marks the original as "superseded" and creates a new corrected record linked to it — the full history, including the mistake, is always preserved and visible in the audit log. This is by design, so movement history can never be silently altered.

Navigate to **Corrections**. Search for the employee (this search includes inactive/deactivated employees too, so you can still fix history for someone who has since left) and pick the date. Their movements for that day appear in a table — tap **Correct** next to the record that's wrong, or **Add Missing Record** if a movement was never captured at all. Either way you'll be asked for the corrected movement type, time, and a **reason** — the reason is required and is stored in the audit trail alongside the correction.

## Audit log

Every login/logout, every ENTRY/EXIT, every correction, every employee/user change, every settings change, and every email attempt (sent or failed) is recorded in the audit log with who did it and when. Navigate to **Audit Log** to browse it — filter by entity type, by who performed the action, or by a date range, and search by keyword across the action, entity, user, and IP address to narrow down an investigation. Results are always shown newest-first; use **Load More** to page through older history. Nothing is ever silently lost.

## Things that are intentionally not built

- **No working-hours timesheet roll-up** — the day view shows a total (first entry to last exit) as a convenience, but there is no daily/weekly timesheet, no per-gap breakdown, and no payroll export. The system is a movement register, not a timesheet.
- **No automatic or scheduled emails** — every email requires someone to explicitly click EMAIL DETAILS.
- **No keyboard shortcuts** for ENTRY/EXIT or any other state-changing action, anywhere in the app — this is deliberate, to prevent an accidental keypress from recording the wrong thing.
