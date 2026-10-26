# User Guide — Security

This is the guide for security guards recording employee entry and exit at the gate.

## Logging in

1. Open the app (on your phone: tap the Adage icon if you've installed it; otherwise open the link in your browser).
2. Enter your username (or email) and password.
3. Tap **Login**.

Your name and role ("Security") appear at the top of the screen once logged in. You'll also see a one-time "Welcome back" message with a quick reminder of what to do next — it only shows right after logging in, not on every page load.

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

If an employee was already marked as **inside** and you tap ENTRY again, you'll see a warning naming them and showing exactly when the earlier record was made:

> "[Name] was already marked as inside (last recorded: ENTRY at 4:01 PM). This would record ENTRY twice in a row for the same employee — do you want to record it anyway?"

This isn't necessarily wrong — sometimes it's legitimate (e.g. they went out for something informal without you noticing an EXIT was recorded). If you're sure, tap **Confirm anyway** and it will record. If it's a mistake, tap **Cancel**.

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

**Searching while offline**: the employee search box still works while you're offline, as long as you've opened the app at least once while connected before — the phone keeps a local copy of the employee list and refreshes it automatically whenever you're online. If you've never connected on this device (or it's brand new), search results won't appear until you connect at least once.

## Viewing records (Dashboard)

Tap **DASHBOARD** at the bottom of the main screen to look up past records — for example if an employee asks you to check when they came in yesterday. See [user-guide-hr.md](./user-guide-hr.md#dashboard) for how to use the filters; the dashboard works the same way for every role.

## Emailing an employee their record

If an employee asks for their entry/exit history for a specific day (e.g. for a leave application), see [user-guide-hr.md](./user-guide-hr.md#emailing-a-record) — the process is identical regardless of your role.

## Adding a movement someone forgot to tap (Missing Movements)

If you notice someone tapped ENTRY but never tapped EXIT (or the other way round) — maybe at the end of your shift, or an employee asks you to check — tap **Missing Movements** in the nav bar (reachable from the Dashboard screen). Added 2026-10-26, so Security can fix this directly instead of asking Admin every time.

The date defaults to **Yesterday**, not Today — while someone's shift is still going, "missing EXIT" usually just means they haven't left yet, not that anything was actually forgotten; Yesterday is a settled day, so anyone showing up there genuinely needs fixing. Pick any date directly with the calendar field, or tap **Attendance Month** to see every gap across the whole pay-cycle at once (26th-to-25th, with prev/next arrows to step between cycles — same Attendance Month filter Insights has). A "missing EXIT" for today itself doesn't show up at all until the day is over — a note explains this whenever the current view reaches today — though a genuine orphan EXIT with no matching ENTRY can still appear for today.

You'll immediately see a list of everyone missing an ENTRY or EXIT that day — based on how their day actually started and ended, not just whether both types showed up at all. Each person appears once, with every missing day of theirs shown together as its own small button (e.g. "Add Missing Exit") — so if someone's missing 5 days across an Attendance Month cycle, you see one row with all 5 together instead of hunting across the list. Tap it and that's the only thing it does: takes you straight to the form for that person and day, with the time field already focused and ready to type into. Saving drops you right back at the list in the same scroll position, so you can keep working through everyone else without losing your place. A repeated tap of the same type (two ENTRYs recorded at the same minute, a known duplicate/offline-sync pattern) is treated as one real tap, not two — it won't create a false "missing" entry on its own. Want to look at someone's day before adding anything? Search for them by name/code instead (still works even for someone who has since left) — once selected, a **Records on {date}** heading above their table confirms exactly which day you're looking at. If you search for someone while **Attendance Month** is active, you get their every missing day across the **whole cycle** instead (same buttons as the list), not just one arbitrary day — since there's no one date to pin a multi-day cycle to. Adding one of their days from here keeps you on that same person afterward, with their remaining missing days shrinking in place, instead of bouncing you back out to the full list. This page can only ever **add** a movement that's genuinely missing — it can never change a record that already has a real time on it, even if you think the type is wrong. If that person's day is already genuinely closed out, there's nothing to add and no button will show.

**Attendance Month** is a toggle, not a one-way switch — tap it again (now labeled **Exit Attendance Month**) to go back to the plain daily view. While it's on, the date field itself is replaced by the cycle's own dates (e.g. "26 Sep – 25 Oct 2026") instead of sitting there showing some unrelated single day next to it — one date shown at a time, not two conflicting ones.

Typing a name/code that doesn't match anyone now says **"No matches found"** instead of just leaving the dropdown blank with no feedback either way.

## Logging out

Tap **Logout** in the top-right corner when you finish your shift, especially on a shared device.
