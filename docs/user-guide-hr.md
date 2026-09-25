# User Guide — HR

This is the guide for HR staff viewing employee movement history and sending records on request.

## What this system is for

This is a **backup/reconciliation record, not your primary attendance source.** Employees already punch their own attendance in FactoHR — that stays the system of record for payroll and attendance. This app exists because the security guard at the gate independently notes everyone's entry/exit times anyway. When an employee forgets to punch in FactoHR, or a punch looks wrong, you can look up the guard-recorded time here to resolve the discrepancy — not as a routine daily task, but as a fallback when FactoHR's own record is missing or disputed.

## Logging in

Same as any user: username (or email) + password on the login screen. After login, you land directly on the **Dashboard** — HR does not have access to the Security recording screen.

## Dashboard

This is your home screen. It shows historical entry/exit records for any date and employee.

### Today's summary

At the top you'll see three numbers for the selected date: total employees who moved, total entries, total exits. This is a count only — the system does **not** calculate working hours in the dashboard summary itself.

If you want the day's total working hours, open **View Employee Day** for that employee; the details page shows a **Total working hours** banner calculated from the first ENTRY to the last EXIT of the day (e.g. "7h 45m").

### Filters

- **Date** — pick any date, past or present, to see records for that day.
- **Employee** — search and select a specific employee, or leave blank to see everyone.
- **Movement** — filter to just ENTRY, just EXIT, or All.

The records table updates automatically as you change filters. On a phone, the table becomes a stack of cards instead of a scrolling table.

Tap any employee's name in the table (or card) to jump straight to their **View Employee Day** page for the selected date — a shortcut for the "select employee then tap the button" flow described below.

## Viewing one employee's day

1. On the Dashboard, select a **Date** and search for the **Employee**.
2. Tap **View Employee Day**.
3. You'll see that employee's full movement history for that specific date — every ENTRY and EXIT in order, with times. A **Total working hours** banner is shown below the list, calculated from the first ENTRY to the last EXIT of the day (e.g. "7h 45m"). This only appears when there is at least one ENTRY and one EXIT on record; if the employee hasn't exited yet, the banner is not shown.

## Emailing a record

Employees may occasionally ask for their entry/exit details for a particular day — for a leave application, a dispute, or their own records. **The system never emails anyone automatically** — this only happens when you explicitly send it.

1. From the Dashboard, select the **Date** and **Employee**, then tap **View Employee Day**.
2. Confirm the correct records are showing.
3. Tap **EMAIL DETAILS**.
4. Wait for "Sending…" to change to "✓ Details emailed successfully."

The email is sent automatically to the employee's registered email address (you don't type it), CC'd to whichever security unit's account is sending it. It includes a professionally formatted PNG attachment the employee can save, forward, or print.

If an employee has no email address on file, EMAIL DETAILS isn't available for them — you'll see a clear note on their details page instead. Add their email via the Employees screen first (see the [Admin guide](./user-guide-admin.md#employee-management) — this screen is also open to HR).

If you tap EMAIL DETAILS again for a record you already sent, you'll be asked to confirm before it resends — this is just a safety check, not a hard block, since the employee may genuinely be asking again.

## What you can't do (by design)

- You can see **total working hours** on the day view (first ENTRY to last EXIT), but not a breakdown of individual in/out gaps or a daily timesheet roll-up.
- You can't trigger an automatic daily email — every send is a deliberate action.
- You can't edit a movement record directly from this screen — record corrections are handled by an authorized user through the correction flow (see [user-guide-admin.md](./user-guide-admin.md#correcting-a-movement-record)).
