# User Guide — HR

This is the guide for HR staff viewing employee movement history and sending records on request.

## Logging in

Same as any user: username + password on the login screen.

## Dashboard

Tap **DASHBOARD** from the main screen (or navigate to it directly). This is where you look up historical entry/exit records.

### Today's summary

At the top you'll see three numbers for the selected date: total employees who moved, total entries, total exits. This is a count only — the system does **not** calculate working hours or time spent inside.

### Filters

- **Date** — pick any date, past or present, to see records for that day.
- **Employee** — search and select a specific employee, or leave blank to see everyone.
- **Movement** — filter to just ENTRY, just EXIT, or All.

The records table updates automatically as you change filters. On a phone, the table becomes a stack of cards instead of a scrolling table.

## Viewing one employee's day

1. On the Dashboard, select a **Date** and search for the **Employee**.
2. Tap **View Employee Day**.
3. You'll see that employee's full movement history for that specific date — every ENTRY and EXIT in order, with times. No working-hours total is shown; this is intentional.

## Emailing a record

Employees may occasionally ask for their entry/exit details for a particular day — for a leave application, a dispute, or their own records. **The system never emails anyone automatically** — this only happens when you explicitly send it.

1. From the Dashboard, select the **Date** and **Employee**, then tap **View Employee Day**.
2. Confirm the correct records are showing.
3. Tap **EMAIL DETAILS**.
4. Wait for "Sending…" to change to "✓ Details emailed successfully."

The email is sent automatically to the employee's registered email address (you don't type it), with the configured Security email address CC'd. It includes a professionally formatted PNG attachment the employee can save, forward, or print.

If an employee has no email address on file, EMAIL DETAILS isn't available for them — you'll see a clear note on their details page instead. Add their email via the Employees screen first (see the [Admin guide](./user-guide-admin.md#employee-management) — this screen is also open to HR).

If you tap EMAIL DETAILS again for a record you already sent, you'll be asked to confirm before it resends — this is just a safety check, not a hard block, since the employee may genuinely be asking again.

## What you can't do (by design)

- You can't see working-hours totals — the system only shows raw ENTRY/EXIT events.
- You can't trigger an automatic daily email — every send is a deliberate action.
- You can't edit a movement record directly from this screen — record corrections are handled by an authorized user through the correction flow (see [user-guide-admin.md](./user-guide-admin.md#correcting-a-movement-record)).
