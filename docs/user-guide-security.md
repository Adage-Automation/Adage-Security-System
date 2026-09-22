# User Guide — Security

This is the guide for security guards recording employee entry and exit at the gate.

## Logging in

1. Open the app (on your phone: tap the Adage icon if you've installed it; otherwise open the link in your browser).
2. Enter your username (or email) and password.
3. Tap **Login**.

Your name and role ("Security") appear at the top of the screen once logged in.

## Recording an entry or exit

This is the only thing you need to do most of the time:

1. Tap the search box — a list of employees appears right away, even before you type anything. Start typing a name (or ID, or email) to narrow it down.
2. Tap the correct employee from the list. Tapping anywhere outside the box closes it without picking anyone.
3. Their name and Employee ID appear on screen — check it's the right person.
4. Tap **ENTRY** if they're coming in, or **EXIT** if they're leaving.
5. You'll see a green confirmation: "✓ Entry Recorded" (or Exit) with the exact time.
6. The screen automatically clears — you're ready for the next person.

**You never need to type a date or time.** The system records the exact moment you tap the button.

## If you tap ENTRY/EXIT and someone is already marked in/out

If an employee was already marked as **inside** and you tap ENTRY again, you'll see a warning:

> "This employee was already marked as inside. Do you want to record another ENTRY?"

This isn't necessarily wrong — sometimes it's legitimate (e.g. they went out for something informal without you noticing an EXIT was recorded). If you're sure, tap **Confirm** and it will record. If it's a mistake, tap **Cancel**.

## An employee can go in and out many times a day

There's no limit. A normal day might look like:

```
09:10 AM   ENTRY
01:05 PM   EXIT     (lunch)
01:48 PM   ENTRY
06:32 PM   EXIT     (end of day)
```

Every tap is recorded separately — you don't need to do anything special for repeat visits.

## If your connection drops

If you're offline or the network fails when you tap ENTRY/EXIT, you'll see **"Queued: pending sync"** instead of a green confirmation. This means the record is saved on your device and will be sent automatically as soon as you're back online — you don't need to tap it again. Never assume a record was saved unless you see the green "Recorded" confirmation or the "pending sync" message; if you see a red error, try again.

**If a queued record has a conflict**: occasionally, when the app syncs a queued movement it finds that the same employee already has a more recent record of the same type — for example, another device also recorded an ENTRY while you were offline. Instead of auto-recording a duplicate, the app flags it with a red banner: **"X offline movements need review because a newer record exists."** Tap **Record anyway** to confirm you still want to record it, or tap **Dismiss** if the queued item no longer needs action. This only ever happens after a reconnect, never immediately when you tap.

## Viewing records (Dashboard)

Tap **DASHBOARD** at the bottom of the main screen to look up past records — for example if an employee asks you to check when they came in yesterday. See [user-guide-hr.md](./user-guide-hr.md#dashboard) for how to use the filters; the dashboard works the same way for every role.

## Emailing an employee their record

If an employee asks for their entry/exit history for a specific day (e.g. for a leave application), see [user-guide-hr.md](./user-guide-hr.md#emailing-a-record) — the process is identical regardless of your role.

## Logging out

Tap **Logout** in the top-right corner when you finish your shift, especially on a shared device.
