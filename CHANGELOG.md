# Changelog

## 2026-10-27 — Full click-handler/crash audit, a design pass, and three HR/Admin gaps closed

A comprehensive audit of every clickable action across every page (10 parallel reviews: 4 functional, 3 design, 3 role-flow — Admin/HR/Security), followed by fixing everything found worth fixing immediately.

**Functional bug fixes (crashes/races/stuck states):**
- `Settings.tsx` — the form stayed editable after a failed load, so an admin could save blind values over settings they'd never actually seen. Now hidden entirely until the load succeeds (or Retry does).
- `Corrections.tsx` `submitEdit` — missing re-entrancy guard; pressing Enter in the Time/Reason field bypassed the Add button's `disabled` state and could double-submit.
- `Corrections.tsx` employee-cycle view — not gated on `missingLoading`, so the Attendance Month prev/next arrows could briefly show stale/wrong-cycle pills or a false "Nothing missing" before the refetch landed. Now shows a skeleton during the refetch instead.
- `Employees.tsx` edit modal — Escape bypassed the in-flight-save guard the Cancel button already had; closing mid-save could swallow an eventual error, and (worse) opening a second employee's modal while the first save was still resolving let that first save's own success handler force-close the second, unrelated modal. Both fixed: Escape now blocked while saving, and the save's own close is now scoped to "still showing the employee I was saving."
- `EmployeeDetails.tsx` — added the sequence/race guard every other fetch in the app already has (rapidly opening two different employees' pages could let the slower response land last and show the wrong employee's data); also resets `emailState`/`emailError` on navigation, so an "already emailed" banner/confirm no longer bleeds from one employee to the next within the same mounted page.
- `Dashboard.tsx` — added the same missing sequence guard on the "Recorded By" dropdown fetch (the one fetch on this page that didn't have it).
- `ChartCanvas.tsx` (Insights) — chart `onClick` handlers close over whatever filter values were active when the Chart.js instance was last created; since the instance only recreates when the chart's *data* changes (not `options`), a filter change that happens to produce byte-identical data left the old handler bound, silently drilling into the wrong filter. Fixed once, at the shared wrapper, by always forwarding through a ref to the latest config instead of every chart config in Insights.tsx individually.
- `Insights.tsx` — the three "Export to Excel" buttons (Team Breakdown, Daily Duration, drill-down) shared one `exportingKey` string; starting a second export while the first was still running let whichever one finished first clear the guard for *both*. Switched to a `Set<string>` of independently-tracked in-flight keys.

**Design pass** (auth pages, SecurityHome, Corrections, Employees, Settings, Users, AuditLog, Insights): promoted auth-page errors from bare `.error-text` to the same `.status-banner.error` treatment used everywhere else; gave Corrections' "Add Missing" pills a distinct amber accent (they're the core action of that page) and fixed a stray hardcoded hex; added a shared `.list-row` class replacing three duplicated inline styles; bolded Settings' "Unsaved changes" indicator; marked Users' Disable action as destructive; added Users' Add-User-form emphasis and a warning icon on the Reset Password modal; split Settings' long field labels into a separate hint line; dropped IP Address from AuditLog's mobile card view; added a sticky header to the Employees roster table; gave Insights' Department Comparison section a distinct "heavy" card treatment and dimmed its two live charts during a filter-triggered refetch instead of silently showing stale data. (SecurityHome's Dashboard button was also tried as a smaller/muted link per the same design pass, then reverted back to its original prominent style by explicit request — it needs to stay easily noticeable.)

**HR/Admin gaps closed:**
- HR (and Security/Admin) can now find a deactivated/former employee via Dashboard and Insights — `/employees/search-all` was Admin/Security-only (`CORRECT_RECORDS`); re-gated to `VIEW_EMPLOYEE_HISTORY`, which all three roles already hold in production (no DB reconciliation needed — see `docs/decisions.md`). Results are marked "· inactive" to stay distinguishable from active employees with similar names.
- Admin self-role-change now confirms first, mirroring the existing self-disable confirm — previously an admin could silently demote their own account out of Users/Settings/Audit Log access.
- Settings' Timezone field now validates against real IANA zone names (feature-detected via `Intl.supportedValuesOf`, degrades gracefully on an older browser) and confirms before saving, since it affects every movement timestamp going forward.
- Audit Log gained an Export to Excel (filtered, newest-first, capped at 5,000 rows), matching every other table in the app.

**Bugs found and fixed while building the above:**
- The new AuditLog Export button's icon rendered at browser-default size (huge) — `.table-action-btn` has no SVG sizing rule, so every other icon-in-button usage in the app sizes its icon inline; this one was missed. Fixed to match convention.
- AuditLog's filter row went through three follow-up passes after first landing: a From/To grouping wrapper inherited `.filters-bar > div { flex: 1; min-width: 180px }` and clipped the To field (fixed, then the grouping box itself was dropped — five plain fields read cleaner than four plus one boxed pair); the row was also over-wide for six items on a laptop screen (each field given a page-scoped `min-width` override, without touching the shared `.filters-bar` default used by five other pages); and `.table-action-btn`'s own height (~36px) turned out shorter than a `.field` input's (~46px), so the Clear/Export buttons' *top* edge sat visibly below the inputs' even after bottom-aligning them — fixed with an explicit `minHeight: 46` match.
- `docs/user-guide-admin.md`'s Insights section listed several charts (Daily Entries/Exits/Present, Attendance Rate, Missing Movements Trend, Unit Activity) that are actually commented out of the live page (hidden 2026-10-13, predating this session) — corrected to describe what's actually shown.

**Docs updated**: `user-guide-admin.md`, `user-guide-hr.md`, `user-guide-security.md` (a wrong-person tap has no undo anywhere in the app — tell Admin/HR, don't try to balance it out yourself), `decisions.md`.

Backend: 19/19 suites, 195/195 tests pass; typecheck clean. Frontend: 6/6 suites, 22/22 tests pass; typecheck clean. `frontend/tsconfig.json` gained `ES2022.Intl` to its `lib` array (type-only — needed for `Intl.supportedValuesOf`, runtime behavior unaffected).

## 2026-10-26 (cont. 18) — Team is now actually required when adding an employee

The Add Employee form's Team dropdown has had a required-mark and `required` attribute for a while, but the backend's `CreateEmployeeDto.team` was still `@IsOptional()` — so the field only looked mandatory; a request made directly against the API (or any future frontend bug bypassing the HTML validation) could still create an employee with no team. Removed `@IsOptional()` from `CreateEmployeeDto.team`, making it a true server-side requirement; `UpdateEmployeeDto.team` is unchanged (still optional — an existing employee can stay "Not set"). The bulk-import path (`employees.service.ts`) calls `create()` directly with its own Team validation (a blank cell is allowed, just skipped per-row) rather than going through this DTO, so `create()`'s parameter type was loosened independently (`Omit<CreateEmployeeDto, 'team'> & { team?: string }`) to keep that path working without weakening the HTTP endpoint's validation.

No doc changes needed — `user-guide-admin.md` already described Team as required when adding.

Backend: 19/19 suites, 195/195 tests pass; typecheck clean. Frontend: 6/6 suites, 22/22 tests pass; typecheck clean.

## 2026-10-26 (cont. 17) — A misaligned row, and the employee-cycle view no longer bouncing you back out

- **Alignment bug, reported with a screenshot.** The Date field's cycle-range text (swapped in for the date input in cont. 16's two-dates fix) sat visibly higher than the "Exit Attendance Month" button and prev/next arrows beside it — `.date-quick-row` had no `align-items` set, so the plain text span didn't match the buttons' 36px height and stretch-aligned to the top by default. Added `align-items: center`.
- **The employee-cycle view (cont. 15) was bouncing guards back out to the full list on every add.** Tapping "Add" on one of an employee's several missing days inside their own Attendance Month cycle view triggered the same `backToList()` the main list's quick-Add uses — clearing `selected` and losing the employee-scoped view, even though they likely had more of that same person's days left to fix. `editOriginRef` gained a third value, `'employeeCycle'` (alongside `'list'` and `'review'`); `quickAdd` now takes a `fromEmployeeCycleView` flag so `renderMissingPills` can tag which case it's called from. On that origin, `submitEdit` now does neither `backToList()` nor `loadRecords()` — it stays on the same employee, and the `loadMissing()` refresh that already ran shrinks their remaining pills in place via `employeeCycleMissingRows`'s own filter.
- Leftover "save"/"saving" wording from the Save→Add rename (cont. 16) cleaned up in the two validation error messages and the generic submit-failure message — all now say "add"/"adding" consistently with the button itself.

Docs updated: `user-guide-admin.md`, `user-guide-security.md`.

Backend: 19/19 suites, 195/195 tests pass (unchanged — no backend changes this entry). Frontend: 6/6 suites, 22/22 tests pass (unchanged — UI-only change, no new test cases); typecheck clean.

## 2026-10-26 (cont. 16) — Four more small-but-real UX fixes on a final re-check

Direct request for anything else to improve, plus fixing the "two dates at once" issue flagged along the way.

- **Two dates shown at once, fixed.** With Attendance Month active, the single date input kept sitting there showing one unrelated day (e.g. "2026-10-25") right next to the cycle's own range text (e.g. "26 Sep – 25 Oct 2026") — two different dates on screen for one filter, since the pinned date has no effect in that mode at all. Now the date input is replaced by the cycle label while Attendance Month is active, instead of showing both.
- **"No matches found" added to the employee search.** Typing a name/code that matches nobody used to just leave the dropdown blank — no way to tell a typo from a slow network from a genuinely broken search. Added a `searchLoading` flag (mirrors the `recordsLoading`/`missingLoading` pattern already used elsewhere on this page) so the message only shows once a search has actually completed with zero results.
- **Search placeholder simplified.** "Search employee (including inactive)..." → "Search by name or ID..." — the "including inactive" detail is still true, just doesn't need to be said to use it (the `aria-label` for screen readers keeps the fuller description).
- **"Save" renamed to "Add."** Every other label on this page already says "Add" (Add Missing Exit, Add Missing Record) — "Save" was the one inconsistent word in the flow.

Docs updated: `user-guide-admin.md`, `user-guide-security.md`.

Frontend: 6/6 suites, 22/22 tests pass (unchanged — UI-only change, no new test cases); typecheck clean. No backend changes this entry.

## 2026-10-26 (cont. 15) — Searching an employee during Attendance Month now shows their whole cycle, not one pinned date

Direct report: searching for an employee while Attendance Month was active still only showed one single day's records table — whichever day happened to be left sitting in the page's single `date` field, meaningless in a multi-day cycle view since nothing on screen said which day that even was.

- Added `employeeCycleMissingRows` (`Corrections.tsx`) — when an employee is selected while `attendanceMonthOffset !== null`, filters the cycle's already-fetched missing list down to just that employee, instead of querying one arbitrary day's full record table.
- Renders the same per-day `renderMissingPills` buttons the main list uses (one button per missing day, e.g. "Add Missing Exit"), scoped to that one employee, under a "Missing movements for {name} in {cycle}" heading — or a clear "has both an ENTRY and an EXIT recorded for every day" empty state if they have no gaps that cycle.
- The plain single-date view is unaffected — searching there still shows that one day's actual record table (Time/Movement/Recorded By), which is still the right view for a single day.

Docs updated: `user-guide-admin.md`, `user-guide-security.md`.

Frontend: 6/6 suites, 22/22 tests pass (unchanged — UI-only change, no new test cases); typecheck clean. No backend changes this entry.

## 2026-10-26 (cont. 14) — Simplify for guards: one action per pill, a real toggle, a visible date while reviewing

Direct request to re-check the whole flow with "keep it simple for security guards" as the explicit bar, plus specifically re-verify the search box and both filters (Date, Attendance Month).

- **One tap, one action.** Each missing-list entry used to be a chip where tapping most of it opened a "review" screen while only a small nested button inside it actually added the fix — easy to miss-tap on a phone and land somewhere unexpected. Collapsed into a single `<button>` per entry (now using the app's existing 36px-min touch-target `.table-action-btn` style) labeled plainly, e.g. "Add Missing Exit" — tap it, it adds the fix, nothing else. Reviewing a day first is still possible, just via the search box instead of from the list. Removed the now-unused `selectFromMissingList`.
- **Attendance Month is now an actual toggle.** It already looked like one (pressed/"active" styling) but tapping it again while active did nothing useful — just reset to the current cycle. Now tapping it again (relabeled **Exit Attendance Month**) goes back to the plain daily view.
- **The active cycle's date range is now always visible**, not just a hover `title` on the button — which is simply invisible on a phone, since there's no hover on touch. Shown as plain text under the date field instead.
- **A missing heading, found while re-checking search.** Once an employee was selected (via search, or quick-Add before it auto-returns), nothing on screen said which date their records table was actually for — easy to mistake for their whole history rather than one specific day. Added a "Records on {date}" heading above the table.
- Added `title="Previous cycle"` / `"Next cycle"` to the prev/next arrow buttons (previously only had an `aria-label`, invisible to a sighted mouse user hovering to check what they do).

Docs updated: `user-guide-admin.md`, `user-guide-security.md`.

Frontend: 6/6 suites, 22/22 tests pass (unchanged — UI-only change, no new test cases); typecheck clean. No backend changes this entry.

## 2026-10-26 (cont. 13) — Missing Movements UX pass: grouped by employee, no lost place, faster for a guard working the whole list

Direct request to look at the page's UX end to end, for both the security guard using it and the developer maintaining it.

- **Grouped by employee, not just by date.** `groupedMissingRows` (`Corrections.tsx`) now buckets the flat `(date, employee)` rows from the backend by employee, so someone missing 5 days across an Attendance Month cycle shows as one row with 5 clickable day-pills together, instead of 5 rows scattered across the list by date. Applies uniformly (the plain single-date view just gets a group of size 1), which also meant the table/card rendering collapsed from 4 near-duplicate blocks down to 2, sharing one `renderMissingPills` helper for the pill markup — a maintainability win alongside the UX one.
- **No more losing your place.** Selecting someone off the list now records the page's scroll position (`listScrollRef`); going back (the X on the employee chip) restores it instead of jumping to the top — real friction on a long Attendance Month list.
- **Auto-return to the list after a one-tap Add.** The quick-Add button on the list previously left you stranded on that one employee's page after Save (or Cancel) — you had to manually tap back out before fixing the next person, a real per-record tax on exactly the flow meant to speed this up. Tracked via `editOriginRef` ('list' vs 'review', a ref since nothing needs to re-render off it): quickAdd's Save/Cancel/Escape now return straight to the list (at the preserved scroll position); deliberately reviewing a day first (`openMissing`) still leaves you there afterward.
- **Time field auto-focused on modal open.** It's the one field almost every add actually needs changed (always starts at the 09:00 placeholder) — saves the extra tap into the field. Swapped `useFocusTrap`'s initial-focus target from the Cancel button to the time input.
- **Sticky column headers** on the missing-list table (`.sticky-head-scroll` in `global.css`, scoped to this list only — not every `.records-table` in the app) via a capped-height internally-scrolling wrapper, so a long Attendance Month list keeps "Employee / Team / Missing" visible instead of scrolling them away with row 1.

Docs updated: `user-guide-admin.md`, `user-guide-security.md`.

Frontend: 6/6 suites, 22/22 tests pass (unchanged — UI-only change, no new test cases); typecheck clean. No backend changes this entry.

**Follow-up, same day — a re-read for plain understandability caught two things from the pass above:**
- The single-date view's pill was repeating the exact date already shown in the page's own heading ("Missing a movement on {date}") — read as confusing clutter, like it might be a different date. `renderMissingPills` now takes a `showDate` flag; only Attendance Month (which actually mixes several dates per employee) shows it.
- `TableSkeleton columns={attendanceMonthOffset !== null ? 5 : 4}` was left over from before the table collapsed to 3 columns in the grouping refactor — a stale, slightly-wrong-width loading skeleton, not a functional bug (the real table always renders 3 columns regardless of view). Fixed to `columns={3}`.

## 2026-10-26 (cont. 12) — Today's missing EXIT is now excluded outright, not just caveated

Direct request: "until a particular day is over, we are not showing in the missing movements page those days records as missing exit." Today's shift being still in progress was previously only a warning banner next to a list that still included today's open sessions as `missingExit`, button and all — someone simply still on-site looked identical to a genuinely forgotten EXIT.

- `MovementsService.missingInRange` now drops any `missingExit` bucket dated today (`todayInAppTimezone()`) from its result entirely.
- `Corrections.tsx`'s `missingTypes` gating mirrors this so the "Add EXIT" button doesn't appear for today even when searching for someone directly.
- `missingEntry` is unaffected — an orphan EXIT with no matching ENTRY is a genuine anomaly regardless of time of day.
- Banner copy updated to describe the actual exclusion instead of just a caveat.
- 4 new backend tests (`describe('excluding a still-in-progress "today"', ...)`) using `jest.useFakeTimers()` to pin "today": excludes today's missingExit, still flags yesterday's, still flags today's missingEntry, and correctly partial-excludes within an Attendance Month range spanning today.
- Docs updated: `api-reference.md`, `user-guide-admin.md`, `user-guide-security.md`, `decisions.md`.

Backend: 19/19 suites, 195/195 tests pass (+4). Frontend: 6/6 suites, 22/22 tests pass; both typechecks clean.

## 2026-10-26 (cont. 11) — Proactive fix: a tied timestamp could make the order-aware rule non-deterministic

Asked for a general "check for any other issues" pass after the order-aware fix above. Found a latent (not yet triggered, confirmed against all of production) gap in that same fix: the new first/last-movement classification only means anything if `movementAt` ordering is stable, but Postgres doesn't guarantee a consistent order for two rows sharing the exact same timestamp unless a secondary sort key is given. Not just theoretical — Add Missing Record's modal defaults its time field to `09:00`, so two separately-added records for the same employee/day could easily land on the exact same minute if nobody changes the default.

- Added `id: 'asc'` as a secondary `orderBy` key (after `movementAt: 'asc'`) to `MovementsService.missingInRange`, `addMissingRecord`'s duplicate-check query, and `listByEmployeeAndDate` (the last one because `Corrections.tsx`'s frontend `missingTypes` reads its result's first/last record directly).
- Found and fixed the identical latent issue in `InsightsService.fetchMovements`, the sibling implementation `buildEmployeeDayAggs`'s `firstEntry`/`lastExit`/`lastMovementType` depends on — same root cause, same fix, for consistency across both features that do this kind of first/last-movement classification.
- Verified via a one-off read-only script against all 7,816 production rows: zero exact-timestamp ties exist between two *different* movement types today — this was a preventive fix for a real but not-yet-triggered risk, not a currently-visible bug. Script deleted after use.
- Added `orderBy`-shape assertions to an existing `missingInRange` test and an existing `addMissingRecord` test — a mocked-Prisma test can't otherwise catch a missing tiebreak, since the mock doesn't enforce real ordering semantics either way.

Backend: 19/19 suites, 191/191 tests pass (unchanged — new assertions added to existing tests, not new test cases). Frontend: 6/6 suites, 22/22 tests pass; both typechecks clean.

## 2026-10-26 (cont. 10) — The count-based fix was itself wrong; switched to order-aware (first/last movement type)

Direct report, with a screenshot: Abhijit Chatterjee, 2026-10-06 — ENTRY 10:26am (offline), ENTRY 10:26am (duplicate, same minute), EXIT 9:51pm (already added) — was still showing an "Add Missing EXIT" button. User: "we don't have a missing exit as the entry was twice." Correct — this is a duplicate ENTRY tap (offline-sync overlap or a double-tap), not a second real session; the single EXIT already covers the one real session that day.

- **Root cause**: the count-based fix from earlier today (`entryCount`/`exitCount` comparison) reads this exact pattern as "2 entries, 1 exit" and wrongly flags `missingExit`, even though the day is genuinely complete.
- **Fix**: `MovementsService.missingInRange`, `addMissingRecord`'s duplicate-check, and `Corrections.tsx`'s `missingTypes` all switched again — from counts to **order-aware**: only the day's chronological first and last movement type decide anything. Ending on ENTRY → missingExit (a session is still open). Not ending open but starting on EXIT → missingEntry (an orphan exit). A repeated tap of either type is noise and never creates a false gap on its own. This is effectively the same rule Insights' `isMissingExit`/`isDayComplete` already used — now applied consistently across Missing Movements too.
- Still correctly catches the original entry/exit/entry report (ends on ENTRY → still flagged).
- Added `orderBy: { movementAt: 'asc' }` to both the `missingInRange` query and `addMissingRecord`'s duplicate-check query — required for first/last tracking to mean anything; wasn't needed under the count-based version.
- New/updated backend tests: duplicate-ENTRY day (the exact reported case) → not flagged; symmetric duplicate-EXIT day → not flagged; orphan leading EXIT → `missingEntry`; original entry/exit/entry case → still `missingExit`. 25/25 tests in this file now (was 21).
- **Re-verified against all 7,816 production `movement_records` rows** (not just Oct 6) with a one-off read-only script: 3,406 employee-days total. The count-based rule would have flagged 555; the order-aware rule correctly excludes 119 of those as duplicate-tap false positives (Abhijit Chatterjee's case confirmed directly, plus 118 others across Sept 28–Oct 26), flagging 463 genuine gaps. Script deleted after use.
- Updated every doc that described the count-based rule (`api-reference.md`, `user-guide-admin.md`, `user-guide-security.md`, `developer-guide.md`) to describe order-awareness instead; `decisions.md` now has the full three-iteration history (presence → counts → order-aware) in one place.

Backend: 19/19 suites, 191/191 tests pass (+4). Frontend: 6/6 suites, 22/22 tests pass; typecheck clean.

## 2026-10-26 (cont. 9) — Verified against real Oct 6 production data, and a reminder the count-based fix isn't deployed yet

Direct request to check whether the Missing Movements list for Oct 6 is showing only genuinely-missing people. Rather than trust the code review alone, ran a one-off **read-only** script (by explicit permission, no writes) against the live production database, independently re-computing the exact `entryCount`/`exitCount` rule for every employee with a movement on 2026-10-06 (IST).

- **Result: the logic itself is correct.** Of 190 employees with at least one movement that day, 75 had a genuine entry/exit count mismatch and 115 were fully balanced (correctly excluded) — matches the committed rule exactly, no false positives or false negatives found.
- **Important caveat surfaced by this check**: `git status` showed the count-based fix (this session's "cont. 6"/"cont. 7" work) is still only in the working tree, **not yet committed or deployed**. Of the 75 genuinely-missing employees, roughly 44 (~59%) have *both* an ENTRY and an EXIT recorded that day with mismatched counts (e.g. 2 entries, 1 exit) — exactly the case the old, currently-deployed presence-only logic would silently exclude. Until this is committed and deployed, the live page is undercounting real gaps for any day with this pattern, though never overcounting (the old rule's flagged set was always a subset of the correct one, confirmed by this same data).
- Deleted the one-off script after use; nothing added to the repo.

Also swept every doc describing the missing-movement rule for the same presence-vs-count staleness this fix needed fixing in code: `api-reference.md` (`/movements/missing-summary` and `/movements/missing` descriptions), `user-guide-admin.md` and `user-guide-security.md` ("tapped once but not twice" / "both an ENTRY and an EXIT already exist" — both described presence, not counts), and `developer-guide.md` ("doesn't exist yet that day" → count-based wording).

Backend: 19/19 suites, 187/187 tests pass (unchanged — no code change this entry, verification + docs only). Frontend: 6/6 suites, 22/22 tests pass; typecheck clean.

## 2026-10-26 (cont. 8) — Confirmed: an added record no longer re-appears in the missing list

Direct request to re-check that adding a missing EXIT/ENTRY makes that employee/day actually disappear from the list, not just that the add succeeds.

- Traced it end to end: `/movements/missing-summary` has no caching layer anywhere in its path (unlike Insights' `getSummary`, which does cache) and `Corrections.tsx` already calls `loadMissing()` right after a successful save (found and fixed in the 2026-10-23 review) — so the very next list fetch re-queries the database fresh and recomputes counts from the now-updated rows.
- Added an explicit end-to-end backend test (not just two separately-tested functions): seeds an entry-only day → confirms it's listed as `missingExit` → calls `addMissingRecord` to fill the EXIT → confirms a fresh `missingInRange` call on the same data now returns `[]`. This proves the write and the very-next read agree, not just that each function is individually correct.

Backend: 19/19 suites, 187/187 tests pass (+1). Frontend: 6/6 suites, 22/22 tests pass.

## 2026-10-26 (cont. 7) — Re-check found the write path still rejected the exact add the read path now asks for

"Check it all again" re-check of the previous entry's fix surfaced a real bug it introduced: `addMissingRecord`'s own duplicate-check still blocked on *any existing record of that type*, not on count. So for an entry/exit/entry day — now correctly flagged `missingExit` by `missingInRange` and offered by the modal — actually submitting the add would have hit "An EXIT is already recorded for this employee on this day — nothing missing to add", rejecting the one add the list just told the caller to make.

- **`MovementsService.addMissingRecord`**: duplicate-check switched from a single `findFirst` (any record of this exact type) to a per-day `entryCount`/`exitCount` comparison — rejects only when this type's count has already caught up to (or passed) the other type's count. A day with zero records of either type stays wide open (either type can be added first, unchanged from before).
- Caught the one subtlety this introduced before it shipped: `entryCount === 0 && exitCount === 0` must NOT reject (that's the normal "nothing recorded yet" case) — an unguarded `>=` comparison would have wrongly blocked the very first add on any empty day. Fixed with an explicit `entryCount > 0 || exitCount > 0` guard before the count comparison.
- Updated/added backend tests: the two existing duplicate-check tests now mock the new `findMany` call; added one for "second EXIT is genuinely missing on an entry/exit/entry day → allowed" and one for "entries and exits already balanced → rejected even though it's not literally a duplicate type."
- Also fixed a stale comment on `missingInRange` that still described presence-only matching and claimed it was already consistent with `addMissingRecord` — it wasn't, until this fix.

Backend: 19/19 suites, 186/186 tests pass (+2 from the previous entry). Frontend: 6/6 suites, 22/22 tests pass; typecheck clean.

## 2026-10-26 (cont. 6) — Missing-movement detection now counts, not just checks presence

Direct request: an employee with entry, exit, entry (2 entries, 1 exit) still owes a final exit, and both the missing-summary list and the per-employee modal were missing this — they only checked "does ENTRY exist and does EXIT exist," so a day with both types present looked fully covered even with a real gap.

- **`MovementsService.missingInRange`**: switched from `hasEntry`/`hasExit` booleans to `entryCount`/`exitCount`, flagging a day when the counts differ (missing EXIT when entries > exits, missing ENTRY when exits > entries) rather than when either type is simply absent.
- **`Corrections.tsx`'s `missingTypes`** (gates the per-employee "Add Missing" button and modal type selector): same fix — counts ENTRY/EXIT for the selected employee+date instead of just checking a presence `Set`, so the button now appears for an entry/exit/entry day instead of wrongly showing "nothing to add."
- New backend test: entry, exit, entry on one day now correctly reports `missingExit`. No new frontend test added, consistent with this file's existing test coverage (no test file exists for `Corrections.tsx` elsewhere in this arc either).

Backend: 19/19 suites, 184/184 tests pass. Frontend: 6/6 suites, 22/22 tests pass; typecheck clean.

## 2026-10-26 (cont. 5) — Doc sweep: a broken cross-reference and two stale schema descriptions

Requested full re-check, docs this time swept across the *entire* `docs/` tree rather than just the files already known to be touched — found three real issues outside today's usual set:

- **`user-guide-hr.md` linked to `user-guide-admin.md#correcting-a-movement-record`** — an anchor that stopped existing the moment that section got renamed to "Missing Movements" earlier today. Fixed the link and the surrounding sentence, which still described the old edit-an-existing-record behavior.
- **`README.md`** still said "only Admin gets Users/Corrections/Audit Log/Settings" — no longer true since Security was granted `CORRECT_RECORDS`.
- **`database-schema.md`** described `isSuperseded`/`correctionOfId`/`correctedByUserId`/`correctionReason` as one single "append-only correction chain" — true before 2026-10-23, but `correctedByUserId`/`correctionReason` are still very much active (every Missing Movements addition sets them) while `isSuperseded`/`correctionOfId` are now historical-only (nothing sets them on a new row since the old "correct an existing record" capability was removed). Split the description into the two distinct, now-unrelated groups so a developer reading the schema fresh doesn't think adding a record still creates a chain.
- Also tightened `security.md`'s audit-trail description ("every correction" → "every movement added via Missing Movements").

Nothing code-level changed — build/test results are identical to the prior entry (backend 19/19 suites, 183/183 tests; frontend 6/6 suites, 22/22 tests; both builds clean), re-run anyway as the final gate before committing.

## 2026-10-26 (cont. 4) — A visible "added" badge for records backfilled via Missing Movements

Direct request: is there a mark showing a record was added through Missing Movements (now reachable from a Security login, not just Admin)? There wasn't — `correctedByUserId` already distinguished a backfilled record from a real-time tap in the database, but nothing displayed it.

- **New `AddedBadge` component**, same pill styling and tooltip pattern as the existing `OfflineBadge` (a distinct blue instead of amber, so the two provenance flags read as different things at a glance). Tooltip shows who added it and their reason, if one was given.
- **Backend**: `listByEmployeeAndDate` and `listWithFilters` now also `include` the `correctedBy` relation (name), alongside the `recordedBy` they already included — the scalar `correctionReason`/`correctedByUserId` were already returned by default, just never joined to a name or exposed to the frontend type.
- **Wired in everywhere `OfflineBadge` already appears** — Dashboard, EmployeeDetails, and Corrections' own record-review table — so anyone looking at a day's records, Security included, can tell a backfilled entry from a live tap at a glance, not just via Insights' drill-down or the Audit Log (both of which Security can't see).

Build/typecheck clean. Backend: 19/19 suites, 183/183 tests pass (unchanged — no new backend test needed, since this is a straightforward Prisma `include` addition over already-existing, already-tested fields, not new logic). Frontend: 6/6 suites, 22/22 tests pass. Docs updated (`api-reference.md`, `decisions.md`).

## 2026-10-26 (cont. 3) — Reason is now optional; full flow re-verified end to end

Direct request: don't require the Reason field on Add Missing (or drop it); then re-check the entire add-a-missing-record flow.

- **`correctionReason` is optional, not removed.** `AddMissingRecordDto` dropped `@IsNotEmpty()` for `@IsOptional()`; the frontend dropped its "A reason is required" check and sends `undefined` instead of `''` when left blank. Chose "optional" over "removed outright" — a reason is still useful context when someone has one, and both places that display it (Audit Log, Insights' "corrected" drill-down) already rendered an absent reason gracefully from before this change, so there was no reason to lose the field entirely.
- **Re-traced the whole flow end to end** (list load → row click or quick-Add → employee+date sync → records review → modal → save → both the records table and the missing list refreshing afterward) for both the plain single-date view and the new Attendance Month view: correct in every case, no new issues found beyond the one already fixed in this same session (the date-sync fix for Attendance Month rows).
- Confirmed the two existing consumers of `correctionReason` (`AuditLog`'s underlying payload, Insights' "corrected" drill-down/export) needed no changes — both already null-safe (`correctionReason ?? ''`, `|| '—'`), a leftover from when a reason could already be `null` on rows predating the original 2026-09-03 design.

Build/typecheck clean. Backend: 19/19 suites, 183/183 tests pass (1 new test: adding a missing record with no reason at all). Frontend: 6/6 suites, 22/22 tests pass. Docs updated (`api-reference.md`, `decisions.md`, both user guides).

## 2026-10-26 (cont. 2) — Attendance Month filter replaces Today/Yesterday

Direct follow-up: drop the Today/Yesterday quick buttons in favor of a plain calendar input plus an Attendance Month filter (prev/next-arrow cycle stepping), matching the pattern Insights already uses.

- **New Attendance Month filter**, same `attendanceMonthRange()` helper and UI (pill + prev/next chevrons) as Insights — steps through 26th-to-25th pay cycles instead of calendar months. Picking a date directly in the calendar field always switches back out of it (value-driven, same as Insights' own presets — no separate persistent "mode" flag).
- **`GET /movements/missing-today?date=` widened into `GET /movements/missing-summary?from=&to=`** (`MovementsService.missingInRange`, replacing `missingToday`) — `from === to` for the plain single-date view, a full attendance cycle for the new filter. Evaluated independently **per calendar day** (a `(date, employeeId)` bucket, not just `employeeId`), so being complete on one day of a multi-day range never masks a gap on another day in the same range.
- **The missing-movements table/cards grow a Date column** when Attendance Month is active (hidden in the plain single-date view, where it would just repeat the same date on every row).
- **Selecting a row now syncs the page's date field to that row's own date** — a real correctness fix, not just UI polish: without it, reviewing or adding a movement for, say, the 3rd of the month while viewing a whole Attendance Month would have built the new record against whatever date was leftover in the (otherwise-unused-in-that-view) single-date field instead of the 3rd. Harmless in the plain single-date view, since every row's date there already equals the one being queried.
- The "today's rows may just be people still on-site" caveat now shows whenever the *active view's range* reaches today (checked against `from`/`to`, not just `date === todayIso()`), so it still applies correctly when Attendance Month's current cycle includes today.

Build/typecheck clean. Backend: 19/19 suites, 182/182 tests pass (3 tests for `missingInRange`, including one specifically asserting per-day evaluation — present on one day of a range must never cover a gap on another day of the same range). Frontend: 6/6 suites, 22/22 tests pass. Docs updated (`api-reference.md`, `decisions.md`, both user guides).

## 2026-10-26 (cont.) — Date field defaults to a settled day, and a one-tap Add

Direct follow-up: make the date field better for finding missing records, and make adding one faster.

- **Defaults to Yesterday, not Today.** While someone's shift is still in progress, "missing EXIT" usually just means they haven't tapped out yet — not a real gap. Defaulting to Today buried genuine misses under everyone still on-site; Yesterday is a settled day, so every one-sided result there is an actual thing to fix. Today is still one tap away via the same quick-date buttons Dashboard already has (`Today`/`Yesterday`, `max` capped at today) — added here too, since the plain date input had none.
- **A caveat banner on Today specifically**, since the list can't tell "hasn't left yet" apart from "forgot to tap" — it just says so, rather than implying everyone shown forgot something.
- **A one-tap "Add" button per row** in the missing-movements list (both the table and its mobile card layout), alongside the existing "click the row to review their records first" behavior. Jumps straight to the Add form with the correct type pre-filled, for the common case where there's nothing to actually review before adding. Fixed a related rendering hiccup: the modal's Movement Type field switched its length-check from `=== 1` to `!== 2` so the pre-filled type displays correctly immediately, instead of a split second of an empty dropdown while that employee's own records are still loading in the background.
- **Caught and fixed a real mobile-breakage bug introduced in this same change**: the missing-movements list used `className="records-table"`, which `global.css` hides entirely below 640px in favor of a `.record-cards` layout — without one, this list would have shown zero rows on a phone, the exact bug class a 2026-09-25 audit already found and fixed across every other table in the app. Security, who this page now also serves, is the role most likely to actually be on a phone here. Added the matching card markup (with its own "Add" button) before this ever shipped.

Build/typecheck clean. Frontend: 6/6 suites, 22/22 tests pass. Docs updated (`user-guide-admin.md`, `user-guide-security.md`).

## 2026-10-26 — Missing Movements opened to Security, renamed from "Corrections"

Two requests: give Security access to the (now much safer, since it can only add, never edit) page from 2026-10-23, and reconsider the name — "Corrections"/"Correct Records" no longer fits a page that corrects nothing, only fills in a genuine gap.

- **Security now holds `CORRECT_RECORDS`.** Safe specifically because of the 2026-10-23 change — this page can no longer rewrite what a guard actually tapped, only add a movement that's genuinely missing. A guard is often the one who'd actually notice a missed tap during their own shift.
- **New `GET /movements/missing-today?date=`, scoped to `CORRECT_RECORDS` (not `VIEW_REPORTS`).** The page's own "who's missing a movement today" list previously reused Insights' `/insights/daily-duration`, which needs `VIEW_REPORTS` — a permission Security deliberately doesn't have and shouldn't need just for this page. Rather than widen that broader permission to Security (which would also unlock the HR/Admin workforce-analytics dashboard), built a small, focused endpoint under the movements module instead, using simple ENTRY/EXIT presence — the exact same rule `addMissingRecord` itself enforces, so the list and the add-button gating can never disagree.
- **Renamed everywhere user-facing**: nav label, page heading, both user guides, and `api-reference.md`/`decisions.md`/`architecture.md`/`AI_AGENT_CONTEXT.md`/`developer-guide.md` now call it **Missing Movements**. The component file (`Corrections.tsx`), route (`/corrections`), and permission name (`CORRECT_RECORDS`) are unchanged — implementation details, not what anyone reads.
- **Fixed two stale references to the deleted `correctMovement` method** found while updating the docs — `developer-guide.md`'s "state-changing conventions" section still told future readers to use "the supersede-and-insert pattern in `MovementsService.correctMovement`," which hasn't existed since 2026-10-23.
- **Production permission grant**: editing `DEFAULT_ROLE_PERMISSIONS` in code doesn't retroactively update an already-seeded database, and re-running the seed script isn't safe against production (it also creates dev-only test accounts with a known password if they don't already exist there). Ran a small, scoped, idempotent script instead — read the current state first, inserted exactly the one `(SECURITY, CORRECT_RECORDS)` row, confirmed the result. Nothing else in the database was touched; confirmed Security's full permission list is exactly the expected 7, no more.

Build/typecheck clean. Backend: 19/19 suites, 181/181 tests pass (2 new tests for `missingToday`'s presence-only classification). Frontend: 6/6 suites, 22/22 tests pass. Docs updated across the board.

## 2026-10-23 (cont. 3) — Dual-perspective review of today's Corrections changes: a race and a stale list

A requested "check as a user and as a developer" pass over today's Corrections changes. Found two real issues, both fixed:

- **Developer-side: `addMissingRecord`'s duplicate-type check and its insert weren't locked together.** A guard's live tap for the exact same employee/type/day could land in the gap between the check and the create, recreating the duplicate the check exists to prevent. Wrapped both in the same per-employee `pg_advisory_xact_lock` pattern `createMovement` already uses for an equivalent race (2026-09-22) — the window is narrow in practice (an admin filling a form is far slower than a guard's tap), but the lock is nearly free and the pattern already exists in this codebase.
- **User-side: after successfully adding a missing record, the "who's missing a movement today" list didn't refresh.** The employee just fixed kept showing as missing until the date happened to change. `submitEdit`'s success path now also reloads that list.

Everything else held up: no schema/migration changes, all data writes remain plain inserts (no update/delete anywhere left in the file), no other code anywhere still references the removed `correctMovement`/`/movements/:id/correct`/`CorrectMovementDto`, and the permission chain (`CORRECT_RECORDS` is Admin-only; Admin holds every permission, including the `VIEW_REPORTS`/`VIEW_EMPLOYEE_HISTORY` the new list and its row-click both need) has no app-level way to diverge from that (no permissions-editing UI exists).

Build/typecheck clean. Backend: 19/19 suites, 179/179 tests pass (1 new test asserting the advisory-lock key). Frontend: 6/6 suites, 22/22 tests pass. Docs updated (`decisions.md`).

## 2026-10-23 (cont. 2) — Corrections now leads with who's actually missing a movement

Direct follow-up request: "maybe whichever day we select will get a list who has a missed entry or exit." Previously, after the same-day change that restricted Corrections to only filling genuine gaps, an admin still had to search employees one at a time hoping to find someone with a gap — nothing on the page pointed at who actually needed it.

- **Corrections.tsx**: picking a date (even before selecting anyone) now shows a clickable list of everyone missing an ENTRY or EXIT that day, each labeled "Missing Exit" or "Missing Entry." Clicking a row loads that employee's full record (`GET /employees/:id`) and selects them, dropping straight into the existing records table + "Add Missing" flow. Reuses the already-existing `GET /insights/daily-duration?date=` endpoint (same per-day status classification that backs the Daily Roster modal) rather than adding new backend logic — filtered to `status !== 'complete'`, which already excludes anyone with zero taps that day (shown separately there as `noMovement`, since a tap-free day just as easily means leave/holiday/remote work as a missed tap — not the "tapped once, not twice" population this list is for). No backend changes; this endpoint was already reachable by every role that can reach Corrections (`CORRECT_RECORDS` is Admin-only, and Admin holds every permission including `VIEW_REPORTS`/`VIEW_EMPLOYEE_HISTORY`).
- When nothing's missing that day, the list shows a clear "Nothing missing on this date" state instead of just silently being empty.

Build/typecheck clean. Frontend: 6/6 suites, 22/22 tests pass (no new backend logic, so the backend's own 19/19 suites are unaffected and weren't re-verified beyond the earlier same-day run). Docs updated (`user-guide-admin.md`).

## 2026-10-23 (cont.) — Corrections no longer edits existing records, by request

Direct request: "correction are to be only allowed in cases where the employee had a missed entry or exit for that day or both maybe — it can not correct some time that already exist." Removed the "Correct an existing record" capability entirely, superseding the two gaps fixed in it earlier today (cross-employee reassignment, missing audit-log entry) — the whole code path that made both of them possible is gone now, not just patched.

- **`correctMovement`, its `/movements/:id/correct` endpoint, and `CorrectMovementDto` are all deleted.** A record that already has a real recorded time — even a wrong one (guard tapped EXIT meaning ENTRY) — can no longer be changed by anyone, through any path. Only `addMissingRecord` remains.
- **`addMissingRecord` now enforces "genuinely missing" itself, server-side.** It rejects with a clean 400 if a non-superseded record of that exact `movementType` already exists for the employee on that calendar day (app-timezone) — so the restriction holds against a stale client or a direct API call, not just whatever the frontend happens to offer.
- **Corrections.tsx**: removed the per-row "Correct" button/column from both the table and card views entirely (`openCorrect`, the `edit.mode` discriminator, `originalId` — all gone). The one remaining action, "Add Missing ENTRY" / "Add Missing EXIT" / "Add Missing Record", only appears when something is actually missing for the selected employee+date — labeled for whichever type(s) are absent, computed from the already-loaded records (no extra request). If both ENTRY and EXIT are already recorded, no button shows at all; a note explains there's nothing to add. The modal's Movement Type field is now constrained to the actually-missing type(s) too (a fixed read-only value when only one is missing, a dropdown of both only when neither is recorded yet).
- Confirmed via a direct, read-only production query (requested separately) that this doesn't orphan anything: historical corrected/superseded rows from before this change keep meaning exactly what they always did; Insights' "corrected" drill-down reads `movement_records` directly and is unaffected either way.

Build/typecheck clean. Backend: 19/19 suites, 178/178 tests pass (the old 'MovementsService corrections' describe block was replaced with `MovementsService.addMissingRecord` tests covering the new same-day-same-type rejection). Frontend: 6/6 suites, 22/22 tests pass. Docs updated (`user-guide-admin.md`, `api-reference.md`, `decisions.md`).

## 2026-10-23 — Corrections flow audit: a missing audit trail and a cross-employee reassignment gap

A focused review of the Correct Records flow end to end (frontend form, controller, service, permissions, Insights' separate "corrected" drill-down), prompted by a direct request to check it properly. Found two real gaps in `MovementsService.correctMovement`/`addMissingRecord`, both backend-only — the frontend already only ever sends consistent data, so neither was reachable through normal use, but both were real holes in what the backend itself enforces:

- **Corrections and missing-record additions never appeared in the Audit Log at all.** `correctMovement`/`addMissingRecord` never called `AuditLogService.record()` — despite the `CorrectMovementDto`'s own comment citing "spec §42: every correction is accountable in the audit log," `docs/user-guide-admin.md` documenting that the correction reason "is stored in the audit trail," and the frontend's `AuditLog.tsx` `actionTone()` already special-casing action names containing `CORRECTED`/`MISSING` — a backend event that never actually existed. A correction's reason/who/when was only ever visible as fields on the `movement_records` row itself (via Insights' separate "corrected" drill-down, unaffected by this fix) or via `git`/database access — never through the Audit Log screen the docs and code comments both claimed covered it. Both now call `auditLog.record()` (`MOVEMENT_CORRECTED` / `MISSING_MOVEMENT_ADDED`), matching every other mutating action in the app.
- **A correction could silently reassign a movement record to a different employee than the one it was correcting.** `correctMovement` validated that `dto.employeeId` was *some* real employee, but never checked it matched `original.employeeId` — so a stale client state or a crafted request body could supersede employee A's record while creating the "corrected" replacement under employee B's identity, splitting one person's attendance history across two people with no error. Now rejected with a clean 400 ("A correction cannot change which employee a record belongs to") before the employee lookup even runs.

Also confirmed clean, no changes needed: `CORRECT_RECORDS` is Admin-only in `DEFAULT_ROLE_PERMISSIONS` (matching the docs); the modal overlay's full-screen fixed backdrop makes the underlying employee-search impossible to touch while a correction is open, so the frontend itself can never trigger the cross-employee case above; `localDateFromIso`/time-input validation (fixed in an earlier pass this session) hold up; Insights' "corrected" drill-down reads `movement_records` directly and is entirely unaffected by the new audit-log calls — no double-counting.

Build/typecheck clean. Backend: 19/19 suites, 179/179 tests pass (2 new tests: the cross-employee rejection, and the audit-log call on both corrected flows; 2 existing tests updated to match). Frontend: 6/6 suites, 22/22 tests pass. No data or database changes — read-only investigation plus code-only fixes, per the standing production-safety constraint.

## 2026-10-21 (cont. 2) — 8 more real bugs: a reset-token replay window, an Insights trend-axis gap, mangled Excel hyperlink cells, and more

A second round of pasted findings (correctness-review style, not user-reported), each verified against the real code before fixing:

- **Admin password reset left a just-requested forgot-password link usable.** `UsersService.resetPassword` set the new `passwordHash` but never cleared `resetTokenHash`/`resetTokenExpiresAt`, unlike `AuthService.completePasswordReset`, which clears both precisely so a link can't be replayed. A forgot-password link requested just before an admin reset the same account stayed valid for the rest of its hour, letting whoever had that link set a third password the admin wouldn't know about. Now cleared on every admin-initiated reset too.
- **Insights' duration/shortfall/missing-movements trend charts silently dropped days under a `movementType` filter.** `sortedDates` (the trend lines' x-axis) was derived only from `attendanceByDate`, which only gets a key when the movement's type matches the filter — but `avgDurationTrend`/`hoursShortfall.trend`/`hoursLongDuration.trend`/`missingExits.trend` are built from the *unfiltered* day-aggregates. Filtering to ENTRY on a day whose only movement was an overnight EXIT made that day vanish from the missing-movements trend line while `exceptions.missingEntries` above it still counted it — chart and KPI disagreed. Trend lines for those four now use a date axis built from their own (unfiltered) aggregates instead. See `docs/api-reference.md`.
- **Insights showed a blank average for a departed (inactive) employee's own detail view, despite drawing their real daily-hours chart right above it.** `employeeAvgHours`/`employeeDurationBucket` in `getEmployeeDetail` were read out of `hoursByEmployee`, which is deliberately active-only (it also backs the company-wide comparison histogram) — so an inactive employee, reachable via Team Breakdown's drill-down, had no entry there and both came back `null` while "How This Employee Compares" claimed a point was highlighted. Now computed directly from that employee's own day-aggregates, independent of the active-only comparison population (which still correctly excludes them from everyone else's comparison).
- **Excel import mangled hyperlinked or rich-text cells into the literal string `[object Object]`.** `cellText()` read `cell.value`, which is a plain string only for a plain cell — exceljs returns `{ text, hyperlink }` for a cell Excel auto-linkified (e.g. typing an email address, which Excel turns into a `mailto:` link on blur, no deliberate action needed) and `{ richText: [...] }` for mixed-formatting text (e.g. pasted from another document). Both silently produced `[object Object]textual data` on import — an email read that way failed validation and skipped the row with a correct-looking address on screen; a name read that way created a real employee literally named `[object Object]`. Switched to `.text`, exceljs's display-text accessor, which flattens both shapes. Added a regression test with a hyperlink cell.
- **Dashboard fired two byte-identical `/movements?date=X` requests on every date change** when no Employee/Movement/Recorded-By filter was active — one from `fetchRecords`, one from the "Recorded By" dropdown-options effect, which always re-fetched unfiltered regardless. The options effect now only fires its own request while a filter is actually active (when its unfiltered fetch would differ from `fetchRecords`'); otherwise it reuses `fetchRecords`' own response. One fewer request per date change on the common case, on the same Supabase connection pool that's already been traced to real "Request timed out" errors under concurrent load.
- **Three Excel export filenames used the UTC calendar date**, not the app's Asia/Kolkata date — `employees.controller.ts`, `insights.controller.ts`, and `Employees.tsx`'s own `handleExport` all used `new Date().toISOString().slice(0, 10)`, the exact anti-pattern `todayIso()`/`todayInAppTimezone()` were written to eliminate elsewhere. Between 00:00 and 05:30 IST, an export downloaded stamped with yesterday's date — cosmetic (filename only, no data affected) but misleading to whoever files it. Switched all three to the app-timezone helpers.
- **`PUT /settings/:key` had no body validation.** `@Body('value') value: string` with no DTO meant the global `ValidationPipe` had nothing to check — a request with a missing or non-string `value` reached `prisma.setting.upsert` directly and surfaced as a raw 500 instead of a clean 400, the exact class of gap the key whitelist two lines above it was added to close. Added a `SetSettingDto` with `@IsString()`. See `docs/architecture.md`.
- **`useScrollRestoration` was the one storage access in the app without a try/catch.** Every other `sessionStorage`/`localStorage` access in the codebase (`clockOffset.ts`, `employeeCache.ts`, `AuthContext.tsx`, `sessionState.ts`) is wrapped defensively, with the existing rationale that losing restored state is harmless and never worth crashing the page over. A browser with site data blocked (Chrome's "block third-party cookies and site data," Safari private mode, a locked-down device profile) throws on access — which propagated out of the restore effect on Dashboard/Insights (the two pages HR uses most) straight to the top-level `ErrorBoundary`, blanking the page, with the scroll listener then throwing on every subsequent scroll event too. Both read and write now wrapped in try/catch.

Build/typecheck clean. Backend: 19/19 suites, 178/178 tests pass (6 new/changed this round — the hyperlink-import regression test, the Insights trend-axis gap, and the inactive-employee average, including one proving they still don't leak into the active-only comparison histogram). Frontend: 6/6 suites, 22/22 tests pass. No data or database changes — every fix is code-only, verified read-only against the live production data per the standing safety constraint.

## 2026-10-21 (cont.) — Dashboard/Employees alignment fixes, a stale-data flash on date change, and Insights' Clear button

A handful of UI issues reported directly by the user after the full-app audit below, each chased down to a real root cause rather than patched locally:

- **Dashboard's Employee field sat visibly higher than Team/Unit/Recorded By in the filter row.** Root cause: Dashboard/Corrections' Employee field uses a standalone `<label>Employee</label>` followed by a *sibling* div (the search box or selected-employee chip), not the usual `<label>Text<input/></label>` nesting every other field uses — so when the Insights filter-bar's trapped-margin fix (2026-10-19) zeroed out `.filters-bar .field label`'s margin-bottom, it also zeroed out this field's *only* source of label-to-control spacing, since it has no nested-control margin-top to fall back on. Added a scoped `.filters-bar .field > label + div { margin-top: 6px }` rule to restore it without reopening the original bug for the wrapped-label fields.
- **Add Employee's submit button sat ~6px below the Team dropdown beside it.** Same root cause as the Insights "Clear" button misalignment, one level more general: `.field label`'s own `margin-bottom: 6px` gets trapped inside the field's box whenever `.field` is a flex item (any `display:flex` row, not just `.filters-bar`), inflating the field's height past its visible control — which then inflates anything stretched to match it, like a sibling submit button. The 2026-10-19 fix only scoped this to `.filters-bar`, missing Add Employee's own flex row. Generalized the rule to plain `.field label` — confirmed a no-op in every block-stacked form (Login, modals), since `.field`'s own `margin-bottom: 16px` already dominated there; the label's redundant margin only ever mattered once something stretched to match a flex sibling's height.
- **Today → Yesterday (and any other date/filter change) briefly showed the OLD date's table while the new one loaded**, actively misleading on a date-filtered dashboard, not just a stale-looking flash. Root cause: the skeleton only showed when `records.length === 0`, which was false the moment any previous date had data — so a user-driven date change left the stale table rendered underneath until the fetch resolved. Gated the table render on `!recordsLoading` too (a silent 30s background poll never sets `recordsLoading`, so it still updates with no flicker; any user-driven reload now shows the skeleton instead of stale data).
- **Add Employee form placeholders were too wordy** ("Must be unique, e.g. EMP206", "Leave blank if not known yet", "...— leave blank if not known") — trimmed to just the example value, since the "optional"/uniqueness context is already in the field's own label.
- **Insights' "Clear" button didn't visibly do anything** when drilling into an employee from Team Breakdown, then opening Filters and clicking Clear. Root cause: clicking a team in Team Breakdown never sets the page's top-level Team filter (it only scopes that one drill-down modal's fetch) — so by the time a user reaches an employee's detail charts, Team/Unit/Movement/Days are usually already at their defaults, leaving Clear nothing to do. On top of that, Clear deliberately skipped the selected Employee (its own separate ✕ on the chip) even though it's visually grouped with Team/Unit/Movement/Days in the same row — confirmed via a user screenshot showing all four filters already at default while an employee was still selected. Clear now also resets the selected Employee, and the "Filters" badge count includes it. See `docs/user-guide-admin.md`.

Build/typecheck clean, 22/22 frontend tests pass. The Dashboard/Add-Employee alignment fixes were verified pixel-exact via a standalone Playwright measurement against the real `global.css` (same methodology as the 2026-10-19 filter-bar fix), since direct login verification isn't available in this environment.

## 2026-10-21 — Full-app audit: fixed 16 real bugs across data-consistency, double-submit, and UX gaps

A full-application audit (every page, every role's POV, dev-correctness and user-POV) requested directly by the user, run as five parallel scoped reviews (auth flows, backend, reporting pages, admin CRUD, core recording/offline flow) read-only against the current code, then fixed as one batch. Grouped by what each fix actually prevents:

**Stale/out-of-order responses silently showing wrong data** (the same monotonic-sequence-ref pattern already used elsewhere in the app, applied to four places that were missing it):
- `AuditLog.tsx`'s `load()` had no guard at all — changing a filter right after clicking **Load More** could let the old page's response land after the filter reset and append rows from the old filter onto the new table.
- `Corrections.tsx`'s `loadRecords()` had no guard — switching date/employee quickly could leave the table showing the wrong day's records, on exactly the screen where an admin needs to be looking at the right record before correcting it.
- `Dashboard.tsx`'s `fetchRecords`/`fetchSummary` had no guard (its own summary-modal fetch already did) — fast filter/date switching on a slow connection could leave stale data on screen with no indication.

**Double-submit — a fast double-click firing two requests for the same row:**
- `Users.tsx`'s `toggleActive` had no guard at all (Employees.tsx's equivalent already did) — fixed with a `Set<number>` of in-flight ids, not a single id, so toggling one row doesn't also block a concurrent toggle on a *different* row (caught in self-review before this was done).
- `Employees.tsx`'s Edit modal Save button had no saving/disabled state (Add Employee's did) — a double-click could fire two concurrent `PUT`s.

**A stale timer silently undoing a newer action:**
- `SecurityHome.tsx`'s 800ms auto-reset-after-success timer wasn't cancelable — tap ENTRY → Cancel → quickly select someone new, all within 800ms, and the old timer fired and wiped the new selection back to the search screen. Now tracked via a ref and cancelled on any new selection, explicit Cancel, or a fresh auto-reset schedule. A comment on `AUTO_RESET_DELAY_MS` claiming the guard could search the next employee *during* the success banner was also corrected — the search box is actually hidden until this timer fires.

**A real (if rare) cross-timezone / malformed-response correctness bug:**
- `Corrections.tsx` built the correction's `movementAt` with `new Date(dateString)`, which parses as UTC midnight — for any browser west of UTC that's the *previous* local day, so `.setHours()` afterward lands the correction on the wrong calendar day. Cancelled out for Asia/Kolkata (east of UTC), which is why it went unnoticed. New `localDateFromIso()` (`frontend/src/utils/date.ts`) parses the components directly instead.
- `SecurityHome.tsx`'s success path did `res.record!.movementAt` — a malformed success response with no `record` threw a `TypeError`, which the surrounding catch (not an `ApiError`) treated as a network failure and queued an offline duplicate of a request that may have already succeeded server-side. Now checked explicitly before use.

**UX gaps:**
- `Employees.tsx`: a sort (e.g. by Status) stayed visually "active" across a search but silently reverted to sorting only the loaded page — re-opening the exact bug a 2026-10-16 fix had already closed for the no-search case. The query-change effect now keeps loading every matching page while a sort is active, same as clicking a header already did.
- `Users.tsx`: Edit and Reset Password shared one modal ref and one first-field ref — Reset Password's first field was never auto-focused (the shared ref was only ever wired to Edit's), and the two modals being open simultaneously was prevented only by convention, not anything enforced. Split into separate refs per modal and made `startEditing`/`startResetting` close the other one explicitly. `PasswordInput` needed `forwardRef` for the Reset Password field's autofocus to reach its underlying `<input>`.
- `Users.tsx`: the success banner (next to Add User, at the top) could land off-screen for a Disable/Reset Password action taken on a row further down — now scrolls to top when it fires.
- `Settings.tsx`: a failed initial load rendered the same blank form as a genuinely unseeded one, with no banner — added a retry banner. Also: validation ran against *every* field on every save, so one unseeded/invalid field could block an unrelated urgent fix to a different field — now validates only the fields actually being saved.
- `Employees.tsx`: a non-JSON error response from a bad Excel import (e.g. a proxy/500 HTML page) threw a raw `SyntaxError` instead of "Failed to import employees."
- `AuthContext.tsx`: `logout()`'s only caller doesn't catch — if `/auth/logout` rejected (e.g. offline), the UI silently stayed "logged in" with no feedback. Local state now clears regardless of whether the server call succeeds.
- `Dashboard.tsx`: the date filter had no upper bound — picking a future date produced an unexplained empty state. Added `max={todayIso()}`.
- `reports.service.ts`: an email-send failure (Puppeteer/Graph/storage/network) returned an identical, unhelpful "Internal server error" regardless of cause. The real cause is still persisted on the `email_logs` row's `errorMessage` (visible via Email Logs) — the client now gets a message pointing there instead. See `docs/api-reference.md`.

Explicitly left alone (flagged in the audit but not fixed here — see conversation for the full reasoning): `ProtectedRoute`'s hardcoded `/dashboard` escape hatch (safe today, every role holds dashboard access), two Insights drill-down gaps considered likely intentional or currently harmless, Audit Log's `GET` permission gating (a policy-owner decision, not a code fix), and Corrections' concurrent-edit handling on the backend (not verified in-session).

Typecheck/build clean on both workspaces, 22/22 frontend tests pass, 175/175 backend tests pass (one assertion updated in `reports.service.spec.ts` for the new wrapped error message — the FAILED row's `errorMessage` assertion, which still carries the real cause, is unchanged).

## 2026-10-19 — Insights: fixed a real flex layout bug in the filter bar, plus a sizing pass

A follow-up to the 2026-10-16 filter-bar redesign below, after the collapsed row was reported as having an "unnecessary gap" between the date-pill row and the expanded Team/Unit/Movement/Days row.

- **Real bug, not a style nit**: the two stacked rows inside `.filters-bar` (now `flex-direction: column`) are themselves flex items with no explicit `width`, relying on `align-items: stretch` for sizing. That meant each row's own internal `flex-wrap` line-breaking ran before a width was resolved, which made Chromium miscompute a phantom empty wrapped line — inflating the row's auto height (e.g. 89px → 177px) even though every item visibly rendered on one line. Reproduced standalone (static HTML against the real `global.css`, measured via Playwright) before touching anything live, since the first fix attempt (`flex: 'none'`) didn't address the real cause and the second (adding `width: '100%'` to both rows) did — confirmed at both desktop (no phantom line) and mobile widths (still wraps into real multi-line rows correctly).
- **From/To redesigned**: dropped the separate "From"/"To" text labels (`aria-label` now carries the accessible name) and put the two date inputs inline with the pills, separated by a "–", matching an agreed mockup — previously the labels sat above the inputs, making this row visibly taller than the rest of the bar.
- **New funnel icon** (`IconFilter`, `frontend/src/components/icons.tsx`) on the Filters toggle button, next to its existing count badge.
- **Quick-date pills were only 18px tall** (`.quick-date-btn` had horizontal padding only, no vertical padding/min-height) against 47px date inputs and the 36px `.table-action-btn` touch-target standard right next to them — gave them the same `min-height: 36px` the rest of the row's buttons already use.
- **"Clear" button was visibly shorter than the dropdowns beside it**, for two compounding reasons: `.table-action-btn`'s own sizing (36px, meant for the toolbar row above) is shorter than a `.field` input/select (47px); and `.field label`'s `margin-bottom: 6px` (meant to space a label from a *sibling* control) had nowhere to collapse to when the control is nested inside the label instead, so it stayed trapped inside each field's box as a flex item — a new `.filters-bar .field label { margin-bottom: 0 }` rule fixes that generally, and Clear's own padding was tuned to the same 47px without changing its font-size (so its text still matches its Filters/View Daily Roster siblings, not the bigger field text).
- **Team/Unit/Movement/Days dropdown buttons were set to 16px** (copied from `.field input`'s iOS-zoom-prevention sizing) despite being custom toggle buttons, not editable text inputs that iOS actually auto-zooms on — shrunk to 13px with compensating padding to hold the same ~47px height, so they read consistent with the 12-12.5px pills/buttons sharing the row instead of oversized. `MultiSelect` (used only in separate modals, not this row) was left untouched — different context, not part of the reported mismatch.

All of this was verified against the real `frontend/src/styles/global.css` via standalone Playwright repros (pixel measurements + screenshots) before and after each change, since the live app's seed credentials didn't work against this environment's backend and login wasn't pursued further rather than risk the real account's rate limiter.

## 2026-10-16 (cont.) — Insights: redesigned filter bar — compact at rest, filters collapse behind a toggle

Iterated through several mockups (published as an Artifact for review) before landing on this: the filter card used to always show three full rows (date presets, 6 fields, Employee+button) totaling ~140px. Now:

- **"Last 30 Days" preset removed** — This Month and All Time already cover that range, and it was visually indistinguishable from This Month at a glance.
- **One compact row at rest** (~90px total): date presets, From/To, a "Filters" button, and View Daily Roster. The Filters button is badged with a live count of non-default filters (`activeFilterCount`, new derived value) so it's clear at a glance whether anything's active without opening it.
- **Team/Unit/Movement/Days/Employee collapse behind the Filters toggle**, new `filtersOpen` state. Clicking it expands a second row **inside the same card** (not a floating popover) — same width, divided by a thin rule, with the button staying visually pressed (tinted, chevron flipped) while open. A "Clear" button resets Team/Unit/Movement/Days to defaults.
- Employee search moved from the always-visible row into this second row, alongside the four filters.

New CSS: `.filters-toggle-btn.open`, `.filter-count-badge` (`frontend/src/styles/global.css`). Typecheck/build clean, 22/22 frontend tests pass, verified live (toggle cycles open/close/open correctly via `aria-expanded`, badge count updates when a filter changes, Last 30 Days confirmed gone from the rendered pills).

## 2026-10-16 (cont.) — Insights: fixed an odd gap in the filter bar's Employee/View Daily Roster row

The Employee search box and "View Daily Roster" button were each a separate `flex: 1` column (half the row width), with the button justified to the far right of its own half — on a wide screen that left a visibly odd empty gap between a search box that didn't stretch to fill its half and a small button stranded at the far edge. Merged into one flex row: the search box now grows to fill the available space, and the button sits at its natural width immediately next to it. Typecheck/build clean, 22/22 frontend tests pass, verified live via screenshot.

## 2026-10-16 (cont.) — Employees: sortable table headers, and a real bug found while testing them

Made all six table headers (Code, Name, Email, Car Number, Team, Status) click-to-sort, ported from the same pattern already used throughout Insights.tsx (`frontend/src/components/SortableTh.tsx` + `frontend/src/utils/sort.ts`, new shared files — Insights.tsx keeps its own local copy rather than being refactored to share this, not worth the risk to an already-working file for a reuse-only change).

Asked directly whether inactive employees are in the list and whether sorting would surface them on top — they are (backend's list endpoint has never filtered by `isActive`), but testing surfaced a real bug: sorting only reordered whatever page was already loaded (the roster loads 50 at a time), so with only 2 inactive employees out of 209 — neither in the first 50 alphabetically — sorting by Status silently showed zero of them. Fixed: clicking any header now fetches every remaining page first (`loadAllThenSort`, paginating past the backend's 200-row cap when needed) before sorting, so a sort always reflects the complete roster. Verified live: Status sort correctly loads all 209 and puts both inactive employees on top.

22/22 frontend tests pass, typecheck/build clean.

## 2026-10-16 (cont.) — Employees: fixed the collapsed Add Employee button looking orphaned, made Team required

The collapsed "Add Employee" toggle from the previous entry still sat alone inside its own full-width white card — a small button floating in a mostly-empty box, flagged as looking "a little odd." Moved it into the header's action-button row, alongside Download Import Template/Import from Excel/Export to Excel, and the form's card now only renders at all when expanded — no empty card in the collapsed state.

While touching the form, reviewed all five fields' placeholders: Name had none (added "e.g. Priya Sharma", matching Employee Code's existing "e.g." pattern); Car Number's "Leave blank if not known yet" didn't show what a car number actually looks like (added "e.g. GA06 F 6026 — leave blank if not known"). Also made **Team required** (was optional) — label, `required` attribute, and the blank option changed from "Not set" to a disabled "Select team" placeholder, so the browser blocks submission until a team is chosen.

Typecheck/build clean, 22/22 frontend tests pass, verified live: header layout confirmed via screenshot, form validity confirmed via `checkValidity()` (false with Team unselected, true once a team is picked).

## 2026-10-16 — Full-app UI/UX review: three fixes

Screenshotted every page (Dashboard, Employees, Insights, Corrections, Users, Settings, Audit Log, SecurityHome, Login) at desktop and mobile widths, as Admin and as a real Security account, and ran through the core flows. Most of the app held up well — fixed three real findings:

1. **Employees' "Add Employee" form now collapses behind a button** (`+ Add Employee` / `Hide Add Employee`), matching the already-planned fix from the 2026-10 deferred-items list. It was always open, pushing the search box and the 209-employee list down a full screen — on mobile the entire first view was nav buttons + 3 action buttons + a 5-field form, with zero employees visible without scrolling. First field auto-focuses when expanded.
2. **Insights' Team Breakdown table (8 columns) gets a mobile-only "Scroll sideways for more columns →" hint.** The table already scrolled horizontally on narrow screens, but most phone browsers hide the scrollbar entirely, so it looked simply cut off with no indication there was more. The hint (`.scroll-hint` CSS class, shown only under the existing 640px breakpoint) is invisible on desktop.
3. **Audit Log action badges now use distinct colors by category**, not one color for almost everything. Previously only FAILED (red) and DEACTIVATED/DISABLED/LOGOUT (amber) stood out — USER_LOGIN, ENTRY/EXIT_RECORDED, EMAIL_SENT, and a dozen CRUD actions all showed identical green badges. Now: red (failures), amber (deactivate/disable/logout, unchanged), brand teal (login/password-reset — new "account" category), green (reserved for the actual movement-recording actions, the core data this log exists to track), grey (everything else — CRUD on employees/users/settings, email, report downloads).

22/22 frontend tests pass, typecheck/build clean, verified live (Puppeteer: form starts collapsed and expands with focus on click, scroll hint confirmed `display: block` on mobile / `none` on desktop, badge colors confirmed via computed styles — USER LOGIN teal, ENTRY/EXIT RECORDED green).

## 2026-10-15 (cont.) — Insights: bucket click-through now matches other modals, shows exact duration

The "How This Employee Compares" click-through (the list of who's in a bucket) was a plain name list in a bare modal, unlike every other modal in the app (drill-down, Daily Roster), which use a consistent `role="dialog"`/focus-trap/table pattern. Rebuilt it to match: a real `<table>` with Employee/Avg Duration columns (not just names), the viewed employee's own row bolded, and the same focus-trap/Escape/Tab behavior as the other modals (`useFocusTrap`). Backend's `durationDistribution[].employees` changed from `string[]` to `{ name, hours }[]` so the exact (1-decimal) duration is available per person, not just which quarter-hour bucket they're in. 175/175 backend, 22/22 frontend tests pass, verified live: selected a real employee, located the chart's highlighted point by scanning canvas pixels for its accent color (Chart.js isn't reachable from the page for a scripted click), clicked it, and confirmed the modal renders a real table with correct exact-duration values for each person in that bucket.

## 2026-10-15 (cont.) — Insights: quarter-hour buckets, nav cleanup, scroll-to-top

Took "How This Employee Compares" one step further from the half-hour fix (previous entry): after showing a scatter-plot mockup (one dot per employee at their exact average, no bucketing at all) alongside the histogram for comparison, decided to keep the histogram but tighten it to quarter-hour (15min) buckets instead of half-hour — e.g. 9h15m now shows at its own 9.25h spot instead of being grouped with 9h30m averages. Also added `employeeDurationBucket` to the API response (`backend/src/insights/insights.service.ts`) — the viewed employee's own bucket, computed with the exact same rounding as the histogram itself — and switched the frontend's self-highlight logic to compare against that instead of re-rounding the already-rounded `employeeAvgHours` display value, which could land on the wrong quarter-hour bucket right at a rounding boundary. New backend tests for the quarter-hour case and the boundary fix; 175/175 backend, 22/22 frontend tests pass.

Removed the "Jump to: Per-Employee Detail / Duration Exceptions / Department Comparison / Team Breakdown" quick-nav bar (added 2026-10-14) and added the same `BackToTop` scroll-to-top button already used on the Employees page (`frontend/src/components/BackToTop.tsx`) instead. Verified live with Puppeteer: the button is absent from the DOM until scrolled past the threshold, then renders in the bottom-right corner and returns to `scrollY: 0` on click.

## 2026-10-15 (cont.) — Insights: two more performance/correctness fixes on "How This Employee Compares"

Cached the `Intl.DateTimeFormat` instances `formatDateInAppTimezone`/`getMinuteOfDayInAppTimezone` were constructing fresh on every call — both are called per movement in every Insights aggregation loop. Benchmarked: 10,000 calls took 644ms rebuilding the formatter each time vs. 59ms reusing one cached instance. Same query, same data, locally: 4.5s -> 2.1s, over 2x faster, with zero behavior change (174/174 backend tests pass unchanged, since they assert exact output values).

Separately, fixed a real display bug on "How This Employee Compares": `durationDistribution` bucketed every employee's average duration to the nearest *whole* hour, so e.g. an employee averaging 9h30m was shown in the "10h" bucket — including the employee's own highlighted point snapping to the wrong spot on the curve. Changed to half-hour buckets (`backend/src/insights/insights.service.ts`'s `getEmployeeDetail`, and `frontend/src/pages/Insights.tsx`'s self-highlight logic) — 9h30m now correctly shows at its own 9.5h spot. New backend test covering the half-hour case; 175/175 backend tests pass, 22/22 frontend, both typechecks and builds clean, verified live against real production-shaped data (a real employee's 9.3h average correctly falls in the 9h bucket among finer-grained half-hour buckets ranging 4.5h-12h).

## 2026-10-15 — Insights: cached the summary endpoint to ease the free tier's CPU limit

Production's `connection_limit=20` change (previous entry) didn't fully resolve "Request timed out" on wide-range Insights pages. Timing `/api/insights/summary` directly against production showed computation time scaling with range width (1 day ~3.2s, a full month ~15.3s) — traced to Render's compute plan being the **Free tier, 0.1 vCPU**, and `getSummary`'s aggregation being plain JS over a fetched array (a deliberate tradeoff since 2026-10-05, now hitting its documented limit). Added a small in-memory TTL cache (`backend/src/common/utils/ttl-cache.ts`) in front of `getSummary`, keyed by the exact filter combination — 30 minutes for a historical range, 60 seconds for a range touching today. Directly helps the page's own Department Comparison, which fires a second, overlapping `/insights/summary` fetch alongside the main one. Doesn't fix the underlying CPU constraint (the first request for any filter combo still pays full price) — that's a plan-upgrade/SQL-aggregation decision left open, see `docs/roadmap.md`. 174/174 backend tests pass (2 new, covering cache-hit and cross-filter cache-miss behavior), typecheck and build clean; verified live locally (first request ~4.5s, identical repeat ~0.6s, a different filter combo recomputes). Full writeup: `docs/decisions.md`.

## 2026-10-14 (cont.) — Fixed a real production crash: unhandled DB errors in session deserialization

Switched production's `DATABASE_URL` to Supabase's transaction-mode pooler (validated locally earlier the same day — see the entry below). Shortly after, a real crash occurred in production: Prisma's connection pool timed out under load (`connection_limit: 8`, its default — never set explicitly on the new pooled URL), and while one instance of that error was handled cleanly (a normal 500 via `AllExceptionsFilter`), the same error inside `SessionSerializer.deserializeUser` was not — Passport's session middleware calls this on every authenticated request, outside Nest's request pipeline entirely, so the unhandled rejection crashed the whole process (Render auto-restarted it ~12s later). Fixed: `deserializeUser` now wraps the DB call in try/catch and passes any error to Passport's `done(err)` instead of throwing, so a DB hiccup there becomes one failed, retry-able request instead of taking the entire backend down. Checked `LocalStrategy.validate()` for the same gap — not affected, it runs through `AuthGuard`'s normal Nest pipeline. New test coverage in `session.serializer.spec.ts`; 172/172 backend tests pass, build clean. Full writeup: `docs/decisions.md`.

## 2026-10-14 — Insights: Department Comparison, a day-scope filter, and a loading/UI pass

**Department Comparison** — three independent bar charts (Median Duration, Short-Duration %, Overtime %), each with its own sort toggle and a department shortlist filter. Deliberately ignores the page's top Team filter (single-select, page-wide — using it here would collapse the chart to one department, leaving nothing to compare) via its own independent `/insights/summary` fetch; a note appears when the top filter is active so it isn't silently ignored. A metric show/hide filter was built and removed the same day — once the three charts were fully split apart there was nothing left to declutter. Found and fixed in the same area: this independent fetch could time out under concurrent load and previously failed silently (the section just vanished, no error, no spinner); now shows a visible error + Retry, plus a loading spinner/skeleton.

**"How This Employee Compares"** — new chart on Per-Employee Detail: every active employee's own average duration this range, bucketed to the nearest hour, this employee's bucket highlighted. Clicking a bucket lists who's in it. The Daily Duration chart was simplified to drop its Entries/Exits bars, keeping just the duration line.

**Day scope filter** — a new **Days** filter (Without weekends / With weekends / Just weekends, `dayScope` param) now controls which calendar days count toward every rate/average/trend/no-movement-flag across Insights, defaulting to weekdays-only (the analytics were already implicitly assuming a Mon-Fri week — a rare Saturday tap could previously skew an average or get wrongly flagged as a shortfall day). Raw record views (Corrections, Dashboard, movement history, and the raw `attendance`/`unit`/`hour`/`corrected` drill-downs) are never affected — only computed stats are scoped. A caveat note appears on Duration Exceptions/Department Comparison when viewing weekend-only data, since the 9h/10h thresholds assume a standard working day.

**Loading/UI pass**: a full-screen overlay now blocks the page during any filter-driven fetch (previously you could click around mid-load against data about to be replaced); skeleton placeholders show in place of blank space on first load. Team/Unit/Movement/Days converted from native `<select>` elements to the same checkbox-style checklist dropdown already used by the department filter, for visual consistency. Added a clear visual boundary (colored banner + the employee's name in the card heading) between Per-Employee Detail and the organization-wide sections below it — scrolling past it used to still read as employee-scoped. Department Comparison's bars narrowed and its team-name labels bolded/enlarged for a less bulky, more legible chart.

169/169 backend, 22/22 frontend tests pass, both typechecks and builds clean, verified live against real production data throughout (including a direct reproduction of the connection-pool contention: a query taking ~2.5-3.7s alone took 10-11.5s under 4 concurrent identical requests — see `docs/roadmap.md`'s open connection-limit item).

## 2026-10-13 — Insights: two real calculation bugs fixed, plus a full UI/clarity audit

Asked directly to check Insights for anything confusing or misleading, across every chart. Found two real bugs — both passed every existing unit test (the arithmetic was correct, just divided by the wrong denominator):

1. **Daily Attendance Rate's roster denominator included inactive employees**, disagreeing with its own "see who had no movement" click-through (which already excludes them, per an earlier fix this session). The % could never reach 100%, and the tooltip's count didn't match the drill-through's row count. Fixed: `totalRosterSize` is now active employees only. Team Breakdown's "Team Size" (`employeeCount`) deliberately keeps including inactive employees — a separate, unrelated decision for team-size comparison — not touched.
2. **Team Breakdown's Avg Duration and Short-Duration % were both divided by "Days Present"** (every tap-day, including missing-exit days with no measurable duration), diluting both numbers for any team with missing exits. Added `daysWithHoursTracked` (complete days only) and rated both against it instead. Verified against real data: several teams' displayed shortfall rate moved up noticeably (one went from a shown 7% to the correct 11%).

**Also fixed**: the employee dropdown in Insights' Team filter was silently dropping real team members — `/employees/search` caps at 10 results, and the dependent filter was narrowing those 10 client-side instead of scoping the query itself. Fixed by adding a `team` param to the search endpoint, applied before the cap. A team with 9 members went from showing 2 to showing all 9.

**Chart clarity pass** (not bugs, but "confusing on a single read"): merged Daily Entries/Exits/Employees Present onto one shared axis (the three series were comparable ranges, so a second axis just added a mental step); labeled every axis with what it counts; renamed "Unique Employees Entering" → "Employees Present"; colored the Avg Duration chart's Hours axis to match its line; fixed two mislabeled bar-count axes that said "Days"/"Flagged Days" when each bar was already scoped to one date via the x-axis (so the real unit is "Employees"); trimmed several chart hints that had become redundant with the legend/axis titles; Unit Activity now sorts alphabetically instead of insertion order (Security Unit 1 left, Security Unit 2 right).

**UI consistency**: fixed one unstyled search box (Insights' drill-down modal wasn't wrapped in the shared `.field` class other inputs use); widened the main page container (1100px → 1440px) and the drill-down modal (680px → 820px) to use more of the screen on desktop; fixed Insights' Employee filter being visibly taller than Team/Unit/Movement beside it (it used the larger `.search-box` hero-search style meant for a page's one big search, not the compact filter-row style) — which also surfaced and fixed a **pre-existing, unrelated bug**: the search icon's CSS was scoped to `.search-box .search-icon` only, so every other page using the same icon standalone (Employees, in a compact `.field`) had it rendering inline above the input instead of positioned inside it. Made `.search-icon` a standalone rule, fixing both.

**Also found on a full modal re-check** (same fix class as the Team Breakdown bug): the 'team' drill-down modal's per-employee "Short-Duration Days" column was a bare count with no denominator — an employee with 1 short day out of 1 tracked day looked identical to one with 1 out of 20. Added `daysWithHoursTracked` per employee (backend + Excel export) and now shows "N (X%)", matching Team Breakdown's own format.

158/158 backend, 22/22 frontend tests pass (new regression tests added for every calculation fix), both typechecks and builds clean, verified live against real production data throughout.

## 2026-10-06 (cont. 2) — Removed two Insights charts that didn't earn their place

Asked directly whether Peak Entry/Exit Hours and Email Reports Sent were actually useful, after being asked to re-explain them in plain terms. Honest answer: no, for this audience. **Removed both**, not just hidden:
- **Peak Entry/Exit Hours** — a facilities/security-staffing chart, not an HR-attendance one; nothing a manager would act on.
- **Email Reports Sent** — operational metadata about an unrelated feature (EMAIL DETAILS usage), already tracked in the Audit Log, the more sensible home for it.

Kept **Working Hours Distribution** — genuinely attendance-related even if it overlaps somewhat with the stat cards. Backend: deleted the now-dead `getHourInAppTimezone`/`getEmailStats` methods and the `peakHours`/`emailStats` fields from the summary response entirely, not just stopped rendering them. Insights now has 6 charts instead of 8. 126/126 backend, 21/21 frontend tests still pass (no test referenced the removed fields), both builds clean, verified live (canvas count dropped from 8 to 6, everything else unaffected).

## 2026-10-06 (cont.) — "Employee-day" clarified, plus a new per-employee trend view

**Clarified confusing terminology**: "Employee-Days" appeared twice in the Insights UI meaning two different things (any day present vs. a day with both entry and exit recorded). Renamed to distinct plain-language labels — **"Days Present"** (Team Breakdown table) and **"Days With Hours Tracked"** (top stat card) — with a one-line caption spelling out the difference.

**New Per-Employee Detail section**: a search box (same pattern as the Dashboard's employee search) picks any employee and shows their own trend for the selected date range — average arrival time, average departure time, a daily-hours line chart (with the expected-hours line shown for reference, `spanGaps` so a day with no complete span doesn't break the line), and a daily entry/exit-count bar chart. New `GET /insights/employee-detail` endpoint, sharing the same `fetchMovements`/`buildEmployeeDayAggs` helpers as the rest of the module. Average arrival/departure is a plain arithmetic mean of minutes-since-midnight — correct for real office hours, deliberately not circular-time statistics (would be solving a near-midnight problem that doesn't occur here).

22 Insights backend tests (up from 18) — 126/126 backend, 21/21 frontend tests pass, both typechecks and builds clean. Verified live against real data (avg arrival 09:36 / avg departure 18:46 for a real employee, both charts populated correctly).

## 2026-10-06 — Insights: clickable drill-down, chart captions, a rounding bug, and a local-dev connection-pool fix

**Clickable drill-down** added to 5 of the 8 Insights charts — Team Breakdown, Attendance/Hours-Shortfall/Missing-Exits trend bars, and Unit Activity. Clicking a bar opens a modal with the underlying rows (e.g. click "Production" → every employee on that team; click a shortfall bar → who fell short that day). New `GET /insights/drill-down?metric=...` endpoint, built by extracting `fetchMovements`/`buildEmployeeDayAggs` as shared helpers so a drill-down's numbers can never disagree with the chart that opened it. Deliberately **not** made clickable: Working Hours Distribution and Peak Entry/Exit Hours — these are histograms mixing every employee-day across the whole range, so "who's in this bucket" would be a large, unfocused list rather than something actionable; kept as display-only charts instead.

**Short one-line captions** added under each non-obvious chart explaining what it shows (e.g. "An entry recorded with no matching exit that day — usually a missed tap worth following up").

**Fixed**: Team Breakdown chart/table was in arbitrary (insertion) order — now sorted alphabetically, easier to scan across 24+ teams.

**Fixed a real rounding bug**, found via an actual browser screenshot review with real data: the shortfall drill-down rounded hours with `Math.round`, so an employee at e.g. 8.96h (genuinely under the 9h threshold) displayed as "9h" in a list titled "Under 9h" — reads as a contradiction even though the comparison itself was correct. Changed to `Math.floor` so a displayed value can never reach the cutoff it's supposed to be under. Regression test added.

**Fixed a runaway canvas-growth bug** (also found via real browser testing, not just unit tests): `ChartCanvas`'s `<canvas>` had only a `height` HTML attribute, not a CSS-height-constrained parent. With `responsive: true, maintainAspectRatio: false`, Chart.js resizes the canvas via `ResizeObserver` to fill its parent — without a stable parent height, that's a feedback loop (parent sizes to canvas, canvas sizes to parent) that grows the canvas taller every cycle; one reached several thousand px within seconds. Fixed by wrapping the canvas in a `<div>` with an explicit CSS height.

**Found and fixed a local-dev-only database stability issue**: the shared Supabase pooler caps session-mode connections at 15 total, shared between local dev and the live production backend. `PrismaService` defaults to `connection_limit=8` when not set — one local dev instance alone claiming 8 of 15 left dangerously little headroom, and combined with a few concurrent one-off debugging scripts, caused two real `EMAXCONNSESSION` crashes of the **local dev backend** this session (production itself stayed healthy throughout, confirmed via its `/api/health` endpoint each time). Fixed by adding `connection_limit=3` to the local `backend/.env`'s `DATABASE_URL` (gitignored, never committed — does not touch the deployed Render backend's own environment configuration). **Worth checking**: whether Render's production `DATABASE_URL` also omits `connection_limit` and is therefore also defaulting to 8 — not changed here, flagged for the user to verify separately since it's a live deployment setting.

Also cleaned up: multiple duplicate `npm run dev` process trees had accumulated from repeated background-launch attempts earlier in the session (each its own NestJS instance + Prisma pool) — identified via `Get-CimInstance Win32_Process` and killed down to exactly one clean instance.

18 Insights backend tests (up from 17), all passing; 122/122 backend tests, 21/21 frontend tests, both typechecks, both builds — all clean. Verified end-to-end in a real headless-browser session against live production data (208 employees, real movement history) — not just unit tests.

## 2026-10-05 (cont. 9) — Insights visually verified in a real browser; fixed a runaway canvas-growth bug

Verified the Insights dashboard in an actual headless-browser session (logged in as HR, against the live database — read-only, no data written) rather than just typecheck/tests. Found a real rendering bug: each chart's `<canvas>` had only a `height` HTML attribute, not a CSS-height-constrained parent — with `responsive: true, maintainAspectRatio: false`, Chart.js resizes the canvas to fill its parent via a `ResizeObserver`, and without a stable parent height that becomes a feedback loop (parent sizes to canvas, canvas sizes to parent) that grows the canvas taller on every cycle. Confirmed directly: one canvas reached several thousand pixels tall within seconds of mounting.

Fixed in `ChartCanvas.tsx` by wrapping the canvas in a `<div>` with an explicit CSS `height`, giving Chart.js a stable box to measure against instead of the canvas's own attribute. Re-verified: canvas size sampled three times over 3 seconds stayed exactly 488×260 (no growth). All 8 charts, the 4 summary stat cards, and the team-breakdown detail table confirmed rendering correctly against real production data (208 employees, real movement history) — including a peak-hours chart that correctly shows entry/exit clusters around 8–10am and 6–8pm, a good sanity check that the hour-bucketing logic is right. The "Team Breakdown" chart correctly collapses to a single "Unassigned" bar (no employee has a `team` set yet) and "Email Reports Sent" correctly renders its empty state (zero sends in range) without erroring.

## 2026-10-05 (cont. 8) — HR/Admin Insights dashboard

New read-only, HR/Admin-only (`VIEW_REPORTS`) Insights screen: attendance trends, working-hours distribution, an **hours-shortfall** metric, missing-exit counts, Unit 1/Unit 2 (security-account) activity, a team-wise breakdown, peak entry/exit hours, and email-report send stats — all computed live from `movement_records`/`employees`/`email_logs` via one new `GET /insights/summary` endpoint, strictly `SELECT`-only (no `create`/`update`/`delete` anywhere in `InsightsService`).

**Mid-design correction**: the first pass assumed a clock-based "late arrival" metric (e.g. flagged after 09:30). The office actually uses flexible timing — no fixed clock-in deadline, just "complete 9 hours in office" — so a clock-based cutoff would've misrepresented real policy. Reworked to track **hours shortfall** instead: `(last exit − first entry) < EXPECTED_DAILY_HOURS` for each employee-day. The 09:30–18:30 reference window is shown on charts purely as context, never used to flag anyone.

Schema: one new nullable `Employee.team` column (`ADD COLUMN`, metadata-only in Postgres — no existing row rewritten, every employee starts at `team = NULL`), validated against a fixed 25-item list (`backend/src/common/constants/teams.ts`, given by the user, Title-cased with real acronyms like APM/CEO/TM/WPS/AI kept uppercase) rather than free text, so team-wise charts can't fragment into near-duplicate labels. Three new `settings` rows (`SHIFT_REFERENCE_START`/`END`, `EXPECTED_DAILY_HOURS`), inserted via the same safe `upsert({update: {}, create: {...}})` pattern already used for `COMPANY_NAME` etc. New permission `VIEW_REPORTS`, granted to HR and Admin only — not Security, since this is aggregated workforce-wide data, more sensitive than the per-day table Security already sees.

Employees screen: added a "Team" dropdown to Add/Edit (optional, fetched from `GET /employees/teams` rather than a second hardcoded copy of the list), a Team column, and Team support in Export/Import (import matches case-insensitively and resolves to the canonical casing; an unrecognized value is skipped with a reason, same row-by-row behavior as every other import validation).

Frontend: new `/insights` page, gated in both the nav and the route by `VIEW_REPORTS`. Charting via `chart.js` (the only new dependency — no `react-chartjs-2` wrapper layer; a small `ChartCanvas` component manages the create/destroy lifecycle directly).

8 new backend tests for `InsightsService` (including an explicit "never calls create/update/delete" check) plus 5 more for the `team` field across create/update/import — 112/112 backend tests pass; frontend typecheck and build clean. Docs updated: `database-schema.md`, `api-reference.md`, `decisions.md`, `security.md`, `roadmap.md`, `user-guide-admin.md`, `README.md`.

**Not yet run against the real database**: the `Employee.team` migration and the new `settings` seed rows still need `npx prisma migrate dev` / the seed script run against the live (shared dev=prod) Supabase instance — deliberately held until explicit confirmation, per standing instruction, even though both are provably additive-only.

## 2026-10-05 (cont. 7) — Add Employee directly: a new employee could vanish behind an active search filter

Asked specifically to re-check adding a new employee directly (not via import). Backend `create()` was already solid (trims input, case-insensitive duplicate check, audit log — confirmed again). Found one real frontend gap: if HR had an active search filter in the box (e.g. reviewing employees matching "John") and added a brand-new employee who doesn't match that filter (e.g. "Priya"), the success message said "Priya added successfully" but the reloaded list stayed filtered to "John" — Priya was nowhere in the list, with no visible explanation why. Fixed: a successful add now clears the search filter if one was active, so the new employee is actually visible in the reloaded list.

## 2026-10-05 (cont. 6) — Edit/Deactivate audit: clearing Email/Car Number never actually worked, plus two smaller UI fixes

Asked specifically to check Edit and Deactivate on the Employees page for bugs. Found a real one: clearing the Email or Car Number field in the Edit modal and clicking Save returned `200 OK` with no error, but silently had **no effect** — the old value stayed in the database. Root cause: the frontend collapsed a blank input to `undefined` (to avoid the backend's `@IsEmail()` rejecting an empty string), and `EmployeesService.update` then passed that `undefined` straight into Prisma's `data`, which Prisma treats as "field not provided, leave it alone" — exactly the opposite of what "I cleared this field and hit Save" means. Fixed by having `UpdateEmployeeDto.email`/`carNumber` accept `string | null`, with `null` now meaning "clear it" and the key being omitted meaning "leave it alone"; the Edit form sends `null` (not `undefined`) when blank. See `docs/decisions.md`.

Two smaller fixes found in the same pass:
- **Stale error bleed**: closing the Edit modal via Cancel or Escape after a failed save (e.g. a duplicate-email rejection) didn't clear the error message — it kept showing under the Add Employee form on the main page after the modal closed, with no visible connection to what caused it. Both close paths now clear it.
- **Double-click audit noise**: clicking Deactivate/Reactivate twice quickly (before the first request's response updated the row) fired the PATCH twice — harmless to the data (idempotent) but wrote a redundant audit-log entry for the same action. The button now disables itself (shows "Working…") for that row while its own request is in flight.

3 new backend tests (employees module now 27/27) — 99/99 backend and 21/21 frontend tests pass; both builds clean.

## 2026-10-05 (cont. 5) — Back-to-top button on Employees

With 200+ employees and "Load More" pagination, scrolling through a large result and then needing to get back to the search/filter bar meant a long manual scroll back up. Added a floating "Back to top" button (`frontend/src/components/BackToTop.tsx`) that appears once scrolled down ~400px and smooth-scrolls to the top on click — a small, reusable component, not Employees-specific, so any other page that grows long enough can use it the same way.

## 2026-10-05 (cont. 4) — Session-expiry redirect: closed the same gap for Export/Import and confirmed it covers every role

Follow-up to the previous entry, after being asked to re-check the session-expiry fix across all roles: the fix in `request()` covers every page for every role (Security, HR, Admin) since there's only one shared API client — but three raw-`fetch` calls in `Employees.tsx` (`/employees/export`, `/employees/import-template`, `/employees/import`, used by HR and Admin) bypass `request()` entirely for blob/FormData handling, so they'd quietly missed the fix. Exported `redirectOnSessionExpired` from `client.ts` for `request()` and these three call sites to share, rather than duplicating the redirect logic. 3 new tests for the exported helper (21/21 frontend tests total).

Also made explicit (with a comment, not a behavior change) why `frontend/src/offline/employeeCache.ts`'s background roster-refresh poll is deliberately excluded: it's a silent background sync for Security's offline search fallback, not a user-initiated action, and forcing a redirect there would yank a guard away from a mid-tap recording screen over a background refresh failure rather than their own actual action.

## 2026-10-05 (cont. 3) — Full HR-flow audit: session expiry now redirects to login instead of failing silently

Audited the entire HR-visible flow end to end (login → Dashboard → Employees → logout) for errors, crashes, and edge cases. Found one real gap: `frontend/src/api/client.ts` had no handling at all for a `401` response outside of login/the initial session check — if a user's 12-hour session cookie expired while they had a page open (mid Add-Employee form, mid bulk import, Dashboard left open overnight), every subsequent action just showed that page's own generic "Failed to ..." error, with no indication the real cause was an expired session, and no way out except manually navigating back to `/login`.

Fixed at the shared `request()` function every API call already goes through: a 401 from any endpoint other than `/auth/login` (which needs its own "Invalid username or password" message) or `/auth/me` (already handled by `AuthContext`/`ProtectedRoute`) now redirects the page to `/login`. See `docs/decisions.md`. 4 new tests in a new `frontend/src/api/client.spec.ts` (redirects on an ordinary 401, doesn't redirect on `/auth/login` or `/auth/me`, doesn't redirect on a non-401 error) — 18/18 frontend tests and 96/96 backend tests pass, both builds clean.

Everything else checked in this pass (routing/nav visibility per role, Dashboard filters and summary-card drill-down, Employees CRUD/export/import, EmployeeDetails email flow, modal focus-trap/Escape behavior, malformed-date handling) was already correct — the backend's existing `dayRange()` validation (`docs/decisions.md`) already turns a cleared/invalid date filter into a clean `400` before it can reach any client-side `Intl.DateTimeFormat` call, so that particular crash risk I suspected doesn't actually reach the frontend.

## 2026-10-05 (cont. 2) — Bulk employee import from Excel

HR can now add several new joiners at once instead of one-by-one. Two new `MANAGE_EMPLOYEES` endpoints on `EmployeesController`: `GET /employees/import-template` (a blank, headers-only `.xlsx` — Employee Code, Name, Email, Car Number — plus a separate "Instructions" sheet with the format and one reference example row that lives off the data sheet so it can never accidentally get imported as a real employee) and `POST /employees/import` (multipart upload via `FileInterceptor`, 2MB cap).

`EmployeesService.importFromExcel` parses the sheet by header name (not fixed column position) and processes rows one at a time — a bad row (missing code/name, invalid email, a code that's already taken) is recorded as skipped with a reason and the rest of the file still imports, rather than one typo blocking the whole batch. Each row reuses the exact same `create()` path as the single Add Employee form (same trimming, same case-insensitive duplicate check, same `EMPLOYEE_CREATED` audit-log entry) — this is a second caller of the existing logic, not a parallel implementation. Fully blank rows are ignored silently rather than reported as "skipped."

Frontend (`Employees.tsx`): "Download Import Template" and "Import from Excel" buttons next to the existing "Export to Excel"; the upload drives a results modal showing `N added, M skipped` plus the reason for every skipped row, matching the app's existing modal pattern (focus trap, Escape to close). The template-download button was initially labeled "Import Template" with a download-arrow icon — contradictory, since it downloads rather than imports — renamed to match the icon.

Also fixed, while building this: `EmployeesService.create`/`update` didn't trim `employeeCode`/`employeeName`/`email`/`carNumber` before the case-insensitive duplicate check — a stray trailing space (e.g. a pasted code) could silently defeat it, creating a second, visually-identical employee. Fixed at the shared service methods so every caller (single-add form and the new bulk import) benefits.

9 new backend tests (employees module now 24/24: header validation, per-row skip reasons for missing fields/invalid email/duplicate code, blank-row handling, the trim fix, both new controller endpoints) — 96/96 backend tests and 14/14 frontend tests pass; both builds clean. No database write made outside of this feature's own normal operation (tested only against mocked Prisma).

## 2026-10-05 — Full audit: "Recorded By" gap on two pages, a real timer leak, an uncommitted test file

**`EmployeeDetails.tsx` and `Corrections.tsx` were missing "Recorded By"** — who recorded a movement (e.g. `securityunit1`/`securityunit2`) already showed on the Dashboard (table and the summary-card drill-down modal) but not on the other two internal pages that list movement records. The backend's `GET /movements/employee/:id` already included `recordedBy` in its response — this was a frontend display gap only, not a data gap. Both pages now show it (a table column, plus the mobile card view). The emailed/downloaded PNG/PDF report was deliberately left alone — that document goes to the employee themselves, not internal staff, so naming which security unit recorded it doesn't belong there.

**Fixed a real timer leak in `report-generator.service.ts`** — `renderWithPuppeteer`'s `Promise.race` against a 30-second timeout never cleared that timeout's `setTimeout` when the real render won the race (the common, fast case) — every successful PNG/PDF report generation left an uncleared 30s timer running in the background for no reason. Found via Jest's own test run refusing to exit cleanly ("did not exit one second after..."), traced to this, and fixed by capturing and clearing the timeout handle in the `finally` block regardless of outcome. Confirmed fixed: the Jest warning is gone on repeated runs, all 87 backend tests still pass.

**`frontend/src/pages/Dashboard.spec.ts` had never been committed** — a prior session wrote real, passing test coverage for `getSummaryModalRows` (the summary-card drill-down logic from the previous entry) but the file was never `git add`ed, so it existed only in the working tree. Added to this commit so it isn't silently lost.

**Dead code cleanup in `Dashboard.tsx`** — the inline `computeCurrentlyInside`/`uniqueEmployeesFromRecords` closures this component used before `getSummaryModalRows` was extracted into a standalone, tested function were left behind, unused. Removed. Also dropped `getSummaryModalRows`'s `isToday` parameter — it was accepted but never read inside the function; the today-vs-past-date label logic lives separately in `summaryModalConfig`.

## 2026-09-28 (cont. 8) — Dashboard summary cards are now clickable (HR/Admin only)

The four Dashboard summary cards (Total Employees, Total Entries, Total Exits, Currently Inside) now open a modal listing exactly who's counted in that number for the selected date, on click — reuses the existing `GET /movements?date=` endpoint (no new backend route). Restricted to HR and Admin (`frontend/src/pages/Dashboard.tsx`'s `canViewSummaryDetails`) — Security sees the cards as plain, non-interactive (same as before) even though it technically already has access to the same underlying data in the records table further down the same page; this is a deliberate UI simplification for the guard-facing view, not a data-access boundary, by explicit request.

Self-audited before commit and fixed one real issue found: the modal's fetch had no guard against a slower response for an earlier-clicked card landing after a faster one for a card clicked right after it, which would show the wrong list — added the same monotonic-sequence guard used by every other debounced/async fetch in this app.

Also fixed a stale doc: `docs/user-guide-hr.md` said the dashboard summary shows "three numbers" — it's actually four and has been since Currently Inside was added.

## 2026-09-28 (cont. 7) — Admin-page usability pass: Users edit/reset-password/search, Settings skeleton, Corrections Enter-to-submit, test data cleared

**Users screen** (`frontend/src/pages/Users.tsx`) — added Edit and Reset Password, both wired to backend endpoints (`PUT /users/:id`, `PATCH /users/:id/reset-password`) that already existed but had no UI at all; an admin previously had no way to fix a mistyped email, change a role, or reset a locked-out user's password through the app. Also added an email column to the table/cards and a client-side search box (name/username/email/role) — no backend search param needed given the small user count.

**Settings screen** — added a loading skeleton matching every other admin screen instead of a blank flash while its fields load.

**Corrections modal** (`frontend/src/pages/Corrections.tsx`) — was the one form in the app not wrapped in a `<form onSubmit>`, so pressing Enter after typing a correction reason did nothing; now behaves like every other modal in the app.

**Considered and explicitly declined**: a "Delete user" option — real hard-delete would violate the foreign keys `movement_records` and `audit_logs` hold on `users` (recordedByUserId/correctedByUserId/userId), either failing outright or cascading away real movement/audit history. Disable remains the only removal action, same as Employee deactivation.

**Test data cleared for launch** — new `backend/scripts/clear-test-data.ts` (`npm run clear:test-data -w backend`, requires `--confirm`, dry-run by default) deleted all movement records (86), email logs (27), and their related audit-log entries (140: `ENTRY_RECORDED`/`EXIT_RECORDED`/`RECORD_CORRECTED`/`MISSING_RECORD_ADDED`/`EMAIL_SENT`/`EMAIL_FAILED`/`REPORT_DOWNLOADED`) accumulated during testing, leaving all 208 employees and 5 user accounts untouched. S3/R2-stored report files for those deleted email logs are not removed — harmless orphaned objects, not a data-integrity concern.

**Audit log wiped except today** — a follow-up request: after the above, 541 audit-log rows remained (logins, employee edits, settings changes, password resets — all deliberately outside the first cleanup's scope). Per explicit instruction, a one-off script deleted every row created before 2026-09-28 (IST calendar day), leaving 134 rows from today only. No other table touched.

**Audit log fully cleared** — a further follow-up request the same day: `audit_logs` emptied completely (`deleteMany({})`, 138 rows at the time — the 134 kept above plus 4 more from continued same-day activity). `audit_logs` now has 0 rows. No other table touched; see `docs/security.md`'s "Audit trail" section for the updated record of all three purges.

**Full data-state check + remaining movements cleared** — a full row-count check across every table, at the user's request, surfaced two things: (1) `movement_records` had 2 fresh rows again (real taps recorded after the cleanup above); (2) `users` had dropped from 5 to 4 — rows for user IDs 3 and 4 no longer exist. The app has no delete path for users at all (hard-delete was explicitly declined earlier this session, see above). Both confirmed by the user as intentional — they deleted the 2 movement rows and the 2 user rows directly against the database themselves, outside the app and outside any script run in this session; not a lost account or a bug. Final confirmed state: 208 employees, 4 users (`admin`, `hr`, `securityunit1`, `securityunit2` — all active), 0 movement records, 0 email logs, 0 audit logs, settings/roles/permissions unchanged.

## 2026-09-28 (cont. 6) — Live clock on the Record Movement page

The Record Movement page's date heading (`frontend/src/pages/SecurityHome.tsx`) now also shows a live-ticking current time next to the date, updating every second — previously date-only, and even the date was just a snapshot from whenever the component last re-rendered. Display-only (`global.css`'s `.date-heading` bumped up in size/weight for visibility); never sent to the server and has no effect on the recorded `movementAt`, which stays fully server-authoritative (spec §20/§46) — same principle as the offline-queue's `clientMovementAt`, which is trusted only on that one bounded path, never here.

## 2026-09-28 (cont. 5) — Excel employee export; nicer-looking emails

**Employee roster export** — new "Export to Excel" button on the Employees screen (`GET /employees/export`, `MANAGE_EMPLOYEES`) generates a `.xlsx` of the full roster (active + inactive, with status) straight from the database on demand. Answers "can UI edits (Add/Edit/Deactivate) update the CSV import file too?" — decided not to try to keep `employees.csv` live-synced (the backend's filesystem on Render is ephemeral, not the same copy as the git repo), and built this on-demand export instead. See `docs/decisions.md`.

**Email formatting** — the "Employee Movement Record" and password-reset emails (`backend/src/email/email.service.ts`) were plain unstyled `<p>` tags despite already being sent as HTML. Both now bold the key facts (employee name/date, or the 1-hour expiry) and use a teal-accented callout box for the important line; the password-reset email also gets a proper button instead of a bare link. Inline styles throughout (not a `<style>` block, since Outlook/Gmail strip those in transactional mail).

## 2026-09-28 (cont. 4) — 3 new employees; fixed a real car-number data-loss bug; active-tab nav highlight

**New employees added** (`backend/data/employees.csv`, re-imported): `55793` Aditya Ganpat Desai, `55794` Fati Rama Gawas, `55797` Manoj Gajanan Khedekar (no email yet).

**Incident and fix — CSV re-import wiped 34 real car numbers.** Adding the 3 rows above required re-running `npm run import:employees`. The roster CSV's `car_number` column has been blank for every employee since it was originally imported (the 34 car numbers added earlier this session were set live through the app, never written back into this CSV) — but `import-employees.ts` unconditionally upserted `carNumber: row.car_number?.trim() || null`, so the re-import silently overwrote all 34 real values with `null`. Caught immediately (Dashboard showed "0 employees with a car number"); all 34 values were recoverable from `audit_logs` (`EMPLOYEE_UPDATED` entries persist the old/new `carNumber`, per the exact audit-trail design this app relies on for disputes) and were restored via a one-off script that both updated `employees.carNumber` and wrote a matching `EMPLOYEE_UPDATED` audit-log row, so the restoration itself is traceable. Aditya's car number (`MH09 DA 1624`, from the same original list, previously unmatched — see 2026-09-25 entry) was set as new data on the newly-created `55793`.
- **Root-cause fix**: `import-employees.ts` no longer treats a blank `car_number` column as "clear this field" — for an existing employee, a blank column now means "leave the current value alone"; only a non-blank CSV value overwrites it. A blank column still correctly leaves a *new* employee's `carNumber` as `null`. Verified idempotent: re-running the import after the fix left all 35 car numbers (the restored 34 + Aditya) untouched.

**Active-tab highlight in the nav** — `AdminNav` (the shared Record Movement / Dashboard / Employees / ... links used by every role) switched from `Link` to `NavLink`, which reactrouter marks with an `active` class on whatever route currently matches; styled in `global.css` with the brand-dark fill so it's obvious at a glance which tab you're on, matching the existing "Today" toggle style on the Dashboard.

## 2026-09-28 (cont. 3) — Backend security audit + full desktop UI/UX audit

Two focused passes run in parallel.

**Security** — found and fixed two real issues, everything else checked out clean:
- **`email_logs` had no persisted record of which mailbox actually sent an email.** `cc` stores the *intended* sending account, but when `EmailService`'s dynamic-from fallback fires (see the previous entry), the actual sender was only ever visible as an ephemeral Render log line. Added `email_logs.senderAddress` (migration `20260928120000_add_email_log_sender_address`); `EmailService.sendMovementRecordEmail` now returns the address it actually used instead of `Promise<void>`, and `ReportsService` persists it. Matters specifically because `email_logs` is the table this app already relies on for "prove what was actually sent" disputes.
- **`EmployeesService.findAll`'s `take` had no upper bound** — the identical gap already fixed for `GET /audit-logs` (2026-09-25) was missed here. Capped at 200.
- Checked and confirmed fine: no email header-injection surface (Graph's REST API takes structured JSON, not raw SMTP headers), `@IsEmail()` enforced on every path that sets a `User`/`Employee` email, cross-origin cookie/CORS setup (verified same-origin via Vercel's `/api/*` rewrite — `SameSite=Lax` is not a gap here), raw Prisma queries parameterized, secrets never committed, audit-log sanitization strips sensitive fields, `npm audit`'s 27 findings all unreachable in this app's actual usage (unused `multer`/dev-only build tooling).

**UI/UX** — drove a real desktop browser (1280×800, Puppeteer) through every page as every role (Admin/Security/HR): Dashboard, Employees, Users, Corrections, Audit Log, Settings, EmployeeDetails, SecurityHome's full search→select→ENTRY/EXIT flow including a real duplicate-confirmation trigger. No genuine bugs found — zero console errors/warnings beyond benign pre-auth 401 probes. One design question surfaced (Admin lands on the recording screen after login, same as Security, rather than the Dashboard like HR) — confirmed intentional with the user, left as-is.

New tests: `backend/src/reports/reports.service.spec.ts` (senderAddress persistence, including the differs-from-intended case), `backend/src/employees/employees.service.spec.ts` (take cap). All 87 backend tests pass.

See `docs/decisions.md`'s "Backend security audit" entry for full detail.

## 2026-09-28 (cont. 2) — Emails now send "from" the triggering account too, not just CC it

Requested directly by the user, now that both security-unit mailboxes are confirmed real. Previously only the CC reflected which unit sent an email; the actual "From" header always showed the fixed `MAIL_FROM_ADDRESS` regardless of who sent it.

- **`ReportsService.emailDailyRecord`** now passes the sending account's own login email as `from` (same value already used for `cc`) to `EmailService.sendMovementRecordEmail`.
- **`EmailService`** uses it as the Graph API mailbox path (`POST /users/{from}/sendMail`). If that specific attempt fails, it **silently retries once with the fixed `MAIL_FROM_ADDRESS`** before giving up — per explicit instruction, the send must never fail just because one unit's mailbox isn't yet covered by the Exchange application access policy. `sendPasswordResetEmail` is unaffected — always sends from the fixed address, since that flow isn't triggered by a security-unit account acting on the desk's behalf.
- **Two explicit decisions, not assumed**: (1) all roles — including HR/Admin — try to send from their own login email too, not just Security; (2) a failed dynamic-send falls back silently rather than surfacing an error, trading a small chance of an unnoticed misconfiguration for guaranteeing "Email Details" always works.
- **Fallback address set to `shivani.naik@adage-automation.com`** (explicit instruction) — already the value in local `backend/.env`; `security@adage-automation.com` still doesn't exist yet.
- **Operational follow-up needed**: the Exchange access-policy scope group must now cover *every* mailbox that could ever be a sender (the fixed fallback, both security units, every HR/Admin account) — not just one, as originally set up. See `docs/email-m365-admin-handoff.md`'s updated step 5.

New tests in `backend/src/email/email.service.spec.ts` cover: sending from the dynamic address when Graph accepts it, falling back on rejection, throwing when both attempts fail, and the unaffected fixed-address-only path when no dynamic sender is given. All 84 backend tests pass.

See `docs/decisions.md`'s "Dynamic email sender" entry for full rationale.

## 2026-09-28 (cont.) — Reverted Sentry; both security-unit mailboxes confirmed real

- **Reverted the Sentry error-tracking integration added 2026-09-25** — `@sentry/node` uninstalled, its `main.ts`/`AllExceptionsFilter` wiring removed, `SENTRY_DSN` removed from both `.env` files and all docs. The user decided against it rather than set up an account. "No error tracking beyond Render's log dashboard" is a known, accepted, open gap — not scheduled for another fix unless revisited. See `docs/decisions.md`.
- **Confirmed `securityunit1@adage-automation.com` and `securityunit2@adage-automation.com` are real, existing mailboxes** — the CC side of the multi-unit email change (2026-09-25) is fully live. `security@adage-automation.com` (the separate *sending* mailbox, `MAIL_FROM_ADDRESS`) still does not exist — `MAIL_FROM_ADDRESS` stays on its temporary stand-in until it does.

## 2026-09-28 — Confirmed the database-backup workflow is genuinely working

Verified directly against Supabase Storage (not just green checkmarks in the Actions UI): `db-backups/` holds one correctly-sized (~70KB compressed) backup file per successful run, with no gaps, across three consecutive real scheduled runs (2026-09-25 through 2026-09-27) plus the manual runs during the 2026-09-25 fix session below. The workflow (`.github/workflows/db-backup.yml`) is done — no further action needed unless retention (currently 14 days) needs adjusting later.

## 2026-09-25 (cont. 5) — Fixed the database-backup workflow's first live run

The backup workflow added earlier today failed on its first real run with
`connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed` — pg_dump never
even attempted to reach Supabase. Cause: libpq only parses `pg_dump`'s argument as a
connection string when it begins exactly with `postgresql://`/`postgres://` (or is a
`key=value` conninfo); anything else — a stray leading space or newline, a pasted-in pair of
surrounding quotes, Supabase's `psql -h ... -U ...` command form — is read as a bare *database
name*, so it silently falls back to a local Unix socket that doesn't exist on a GitHub runner.
The "required secrets are set" check passed because the secret genuinely was set; it just
wasn't URI-shaped.

- **`.github/workflows/db-backup.yml`, Dump step** — trims whitespace/quotes off
  `BACKUP_DATABASE_URL`, then hard-fails with a message naming the actual problem (and what to
  copy from Supabase) if what's left doesn't start with `postgresql://`. The value itself is
  never echoed: it carries the database password, and a trimmed/derived value is no longer
  covered by GitHub's secret masking.
- **Install step now pulls `postgresql-client-17` from PGDG** instead of Ubuntu's own
  `postgresql-client`, *and* puts that client's real bin directory at the front of `PATH`. The
  runner image ships client 16, and pg_dump refuses outright ("aborting because of server
  version mismatch") against a newer server — Supabase is on 17.6. Installing 17 alone turned
  out not to be enough, which is exactly how the re-run failed: `/usr/bin/pg_dump` is
  postgresql-common's `pg_wrapper`, which dispatches to the *default cluster's* version, and
  the runner image also ships a PostgreSQL 16 server with a `main` cluster — so it kept
  resolving to 16 with 17 installed and unused. The dump step now logs `pg_dump --version`
  too, so a future mismatch is visible in the failing run itself.
- **Upload/Prune steps now trim the `STORAGE_*` values the same way.** These are copied out of
  `backend/.env`, where dotenv strips the surrounding quotes (`.env.example`'s own line is
  `STORAGE_REGION="auto"`) — but a GitHub secret is taken verbatim, so the quotes survive and
  the AWS CLI rejects `"auto"` with `Provided region_name ... doesn't match a supported
  format`. Trimmed in-step rather than left to be hand-cleaned across five secrets. Kept as
  shell locals and deliberately *not* written to `$GITHUB_ENV`: values set there are echoed in
  every later step's `env:` header in clear text, outside GitHub's secret masking.
- **Corrected the connection-string guidance** (workflow header, `docs/decisions.md`,
  `docs/roadmap.md`): what `pg_dump` needs is a *session-mode* URI, which is about the port
  (5432 session, 6543 transaction), not direct-vs-pooler. Supabase's "Direct connection"
  hostname resolves to IPv6 only and GitHub-hosted runners have no IPv6, so the **"Session
  pooler"** string on port 5432 is the one that actually works from Actions — the previous
  guidance pointed at the one that can't.

## 2026-09-25 (cont. 4) — Database backups and backend error tracking

Closed two of the open deployment risks flagged earlier today's audit, on explicit user confirmation:

- **Added `.github/workflows/db-backup.yml`** — a daily `pg_dump` (session-mode connection, not the app's own transaction-mode pooled one) gzip-compressed and uploaded to the same Supabase Storage bucket already used for emailed reports (`db-backups/` prefix), pruned to the last 14. Supabase's free tier has no automated backups/PITR at all — before this, there was genuinely no recovery path if the project were lost or corrupted. **Needs setup**: `BACKUP_DATABASE_URL` and the `STORAGE_*` values added as GitHub Actions repo secrets — see the workflow file's header comment. (See the 2026-09-25 (cont. 5) entry and the 2026-09-28 entry, both above, for the real issues hit getting this working and confirmation it's now actually running.)
- **Added `@sentry/node`** to the backend, initialized in `main.ts` only if `SENTRY_DSN` is set (unset = safe no-op, same pattern as every other optional config in this app). `AllExceptionsFilter` now reports every genuine 5xx to Sentry alongside its existing log line. No performance tracing (`tracesSampleRate: 0`) — error visibility only. **Needs setup**: a free Sentry account/DSN, set as `SENTRY_DSN` in Render's environment.

See `docs/decisions.md`'s "Database backups: scheduled pg_dump via GitHub Actions, and backend error tracking via Sentry" entry.

## 2026-09-25 (cont. 3) — Multiple security units: CC is now the sending account's own email, not a global setting

Adage now operates two security units (`securityunit1@adage-automation.com`, `securityunit2@adage-automation.com`), each a single shared login account used by 2-3 guards physically at that unit. The old single global `SECURITY_EMAIL` Settings key assumed one security desk and is removed entirely.

- **`ReportsService.emailDailyRecord`** now CCs whichever account actually sent the email (its own `User.email`, looked up by `requestedByUserId`), instead of a fixed Settings value. HR/Admin sends (they hold `SEND_EMAIL` too) go out with no CC, by explicit choice, rather than a fallback address.
- **Removed**: the `SECURITY_EMAIL` Settings key end to end — `SettingsService.getSecurityEmail()`, its entry in `SETTING_KEYS`, its seed-script default, and its field on the Settings page. Existing `settings` rows for that key are simply unused now (harmless).
- Considered adding a new, separate CC field on `User` first (since `email`'s uniqueness constraint would otherwise block multiple guards sharing one CC address) — turned out unnecessary once it was clear each unit is *one* shared login account, not several individual guard accounts, so that account's own `email` already holds the unit's address uniquely.
- Docs swept for every "Security Email is a Settings key, not an env var" reference (many, from the earlier `SECURITY_EMAIL`-as-env-var documentation fix) and rewritten to describe the new per-account CC model — `README.md`, `docs/api-reference.md`, `docs/database-schema.md`, `docs/deployment.md`, `docs/developer-guide.md`, `docs/architecture.md`, `docs/roadmap.md`, `docs/testing.md`, `docs/user-guide-admin.md`, `docs/user-guide-hr.md`, `docs/email-m365-admin-handoff.md`, `docs/branding-and-data-needed.md`, `backend/.env`/`.env.example`.
- **Operational follow-up flagged, not yet confirmed**: `securityunit1@`/`securityunit2@adage-automation.com` need to actually exist as real mailboxes — they're now literal CC recipients on outgoing mail, not just internal config values.

See `docs/decisions.md`'s "Security CC is the sending account's own email, not a global setting" entry for full rationale.

## 2026-09-25 (cont. 2) — Full-codebase audit: case-insensitive email gap, unbounded take, double-submit, stale search results

A fresh audit run in parallel across backend, frontend, and deployment (see `docs/decisions.md` for full rationale on each). Deployment findings — no database backups, no error tracking — are documented as open risks pending a decision, not fixed here (they need new infrastructure/accounts, not just code). Fixed:

**Backend:**
- **`UsersService.create`/`update` and `AuthService.requestPasswordReset` matched email case-sensitively**, while login (`AuthService.validateUser`) already matches case-insensitively — the exact gap already closed for Employees in the 2026-09-21 audit, missed for Users. Two accounts differing only by email case could be created, or a user typing different casing than their stored email at "Forgot password" would get the generic response but no email. Fixed to match login's case-insensitive behavior everywhere.
- **`GET /audit-logs`'s `take` param had no upper bound** — capped at 200 regardless of what the caller requests.

**Frontend:**
- **`Employees.tsx`/`Users.tsx` "Add" forms had no double-submit guard** — every other form in the app (Corrections, Settings) already disables its submit button while saving; these two were missed, so a fast double-click/double-Enter could fire two requests before the first resolved (caught cleanly by the backend's uniqueness checks, but with a confusing error). Fixed with the same `saving`-boolean pattern used elsewhere.
- **`Settings.tsx`'s "Save all changes" used `Promise.all` across multiple field saves** — a mid-batch failure rejected immediately, skipping the reconciliation step even for fields that *had* persisted server-side, leaving them stuck showing "unsaved" and implying nothing saved when something did. Switched to `Promise.allSettled`, reconciling only the fields that actually succeeded and reporting a partial-failure message when relevant.
- **No stale-response guard on any debounced employee search** (SecurityHome, Dashboard, Corrections, Employees) — the debounce only delayed sending a request, never cancelled or sequenced in-flight ones, so a slower response for an earlier query could land after a faster response for a newer one and flash stale results. Added a monotonic request-sequence counter to all four (a lower-risk fix than threading `AbortController` through the shared `api` client, which has no signal-injection point today).

See `docs/decisions.md` for full detail on each fix and the deployment risks left open.

## 2026-09-25 (cont.) — Fixed Audit Log/Corrections/Employees/Users showing no data on any phone

A full mobile-viewport audit (360×740, 390×844, 428×926, all 3 roles, every route, every control) found the guard-facing SecurityHome/Dashboard screens are solid on mobile, but four admin/HR data-review pages were fundamentally broken on every phone size tested: `AuditLog.tsx`, `Corrections.tsx`, `Employees.tsx`, and `Users.tsx` rendered only a `<table className="records-table">`, but `global.css` hides `.records-table` and shows `.record-cards` instead at `max-width: 640px` — and none of these four pages had `.record-cards` markup. Result: the entire list silently vanished on any phone, with no error and no empty state (only Dashboard.tsx, which already had both layouts, worked correctly). Fixed by adding `.record-cards`/`.record-card` markup to all four pages, mirroring Dashboard's existing pattern (Corrections and Employees keep their per-row action buttons — Correct/Edit/Deactivate — reachable on the card too) — verified live in a mobile-viewport browser session (360px): all four pages now render full card content with the table correctly hidden, no horizontal overflow introduced.

Also tightened two tap targets flagged by the same audit as under the ~44px accessibility guideline: the welcome-banner dismiss (×) button (was 28×28px, now a 44×44px hit area) and Dashboard's mobile record-card employee-name links (were ~20px tall; grown via padding with an offsetting negative margin so the tap area increases without shifting layout).

## 2026-09-25 — Fixed the keep-alive gap: UptimeRobot set up as primary pinger

- The backend was observed sleeping in production despite the keep-alive setup. Checked the GitHub Actions pinger's actual run history via the API and confirmed the 2026-09-22 finding still holds: it's active (not auto-disabled) but firing every 3–5 hours, not the configured 10 minutes — nowhere near tight enough to beat Render's 15-minute idle sleep.
- Set up UptimeRobot (free tier) as the primary pinger against `https://adage-security-system.onrender.com/api/health`, checked every 8 minutes. Confirmed live: 100% uptime, 0 incidents. See `docs/decisions.md`'s keep-alive entry and `docs/roadmap.md`.

## 2026-09-24 — Migration backfill for the manually-dropped employee columns

- **Added `20260924100000_drop_employee_metadata_columns`**, a follow-up Prisma migration recording (for migration-history purposes only) the `Employee.phone`/`department`/`designation` column removal that was done directly against the live Supabase database on 2026-09-22, outside Prisma's own migration flow. Against the live database this is a genuine no-op (`DROP COLUMN IF EXISTS` — the columns were already gone; verified `/employees` and `/employees/search` before and after, both clean). Its only purpose is keeping a *future* from-scratch database build honest — without it, replaying the full migration history would still recreate these columns via the original `20260903103752_init`. See `docs/decisions.md`.

## 2026-09-23 — Crash-risk audit: guard three more unguarded storage/transaction calls

A follow-up audit specifically targeting code changed in the last few sessions, run in parallel across backend and frontend. One claimed finding (a `Promise.race` losing branch supposedly crashing the whole process via an unhandled rejection, in `report-generator.service.ts`'s render timeout) was checked empirically with a standalone Node script and ruled out as a false positive — `Promise.race` attaches a rejection handler to every promise it's given internally, so a losing branch settling late never goes unhandled. No fix needed there. Three real, previously-missed issues were found and fixed:

- **`frontend/src/auth/AuthContext.tsx`'s `cacheUser()` had no try/catch around `localStorage.setItem`**, unlike every other storage write added in recent sessions (`clockOffset.ts`, `employeeCache.ts`, `WelcomeBanner.tsx`). On a device where `localStorage` throws (private-browsing mode, quota exceeded, disabled by policy), this could surface a false "Unable to sign in" error on login despite the server having authenticated successfully, or silently discard a valid just-fetched session on page load (the thrown error wasn't an `ApiError`, so the auth-cache-fallback logic treated it as "couldn't reach the server" and fell back to a — now also failed to write — cached user, i.e. `null`). Fixed with the same try/catch pattern already used everywhere else.
- **`frontend/src/pages/SecurityHome.tsx`'s `syncPending()` had an unguarded `listPendingMovements()` call.** Its sibling `refreshPendingCount` got this exact guard in the 2026-09-22 audit, but `syncPending` was missed. Since `syncPending` is invoked via `void syncPending()` from both a mount effect and a repeating 20s interval (while anything is pending), an IndexedDB failure here would have produced a repeating unhandled rejection every 20 seconds, with sync silently never running and no feedback to the guard. Fixed.
- **`backend/src/movements/movements.service.ts`'s per-employee advisory-lock transaction used Prisma's defaults** (5s transaction timeout, 2s max-wait). Under a burst of concurrent taps for the *same* employee — several devices' offline queues syncing at once after a shared outage, all queued for one person — requests serialize behind the lock, and if the queue depth × per-transaction time exceeded 5s, later requests would throw a generic transaction-timeout error (caught cleanly by `AllExceptionsFilter`, so no process crash, but a confusing "Unable to save record" the guard has to manually re-tap). Widened to `{ maxWait: 10_000, timeout: 20_000 }`.

## 2026-09-22 (cont. 5) — Report-generator resilience + priority UX pass (welcome banner, clearer offline status, empty states, duplicate-confirm context, Settings save-all, Audit Log filters)

Follow-up to a crash-risk audit and a UX backlog review — implemented the items explicitly picked as worth doing now (Puppeteer single-browser risk, plus 6 of the 7 prioritized UX items; the broad responsive/contrast pass was scoped down to spot-checking the pages touched here, not a full site-wide redesign).

### Fixed

- **Puppeteer's pooled report-generator browser had no recovery path for a wedged (not fully crashed) instance.** The existing `'disconnected'` handler only caught a browser that actually crashed — a hung renderer or a `page.setContent` that never settles would leave every future report request hanging behind the same stuck instance indefinitely, with no timeout and no way to notice. Fixed: a 30s render timeout via `Promise.race`, and `newPage()` failing (not just disconnecting) now triggers one retry with a freshly launched browser. Only a timeout is treated as "this browser may be unhealthy" — an ordinary render error (bad input, a template bug) no longer force-relaunches a perfectly fine pooled browser. Verified with a dedicated test suite (`report-generator.service.spec.ts`, mocked Puppeteer): retries once on `newPage()` failure, discards the pooled browser after a real timeout, and does *not* discard it for an unrelated render error.

### Added

- **"Welcome back, [name]" banner right after login**, with a one-line role-specific next action (Security: search to record a movement; HR: filter/export today's activity; Admin: record a movement or use the admin menu). Shown once via a `sessionStorage` flag set at login and cleared on read, so it never reappears on refresh or back-navigation. New `frontend/src/components/WelcomeBanner.tsx`.
- **Clearer offline/sync wording on the Security recording screen** — "Offline mode — you can still search employees from the last saved list. Movements will be saved once connection returns.", "Queued: N movements pending sync — will be sent automatically once connection returns.", explicit per-tap "Queued: Entry — [name]. Will sync automatically once connection returns."
- **Duplicate-confirmation dialog now shows real context instead of just a bare type.** `POST /movements`'s `requiresConfirmation` response now includes `lastMovementAt`; the dialog shows the employee's name, when the conflicting movement was last recorded ("last recorded: ENTRY at 4:01 PM"), and an explicit "this would record ENTRY twice in a row" explanation before the guard confirms. Button relabeled "Confirm anyway" for clarity. Verified end-to-end with a real duplicate-tap sequence.
- **Better empty-state guidance on Dashboard and Audit Log** — distinguishes "no matches for this filter" (with a hint to try a different value, and a Clear-all-filters button) from a genuinely empty table ("No movements recorded for this date" / "No audit log entries yet").
- **Audit Log: date-range filter (`from`/`to`) + keyword search**, debounced, searching action name, entity type, performing user's name, and IP address. Always newest-first (already the default; not new, but confirmed). New `GET /audit-logs` query params `from`/`to`/`q`; `AuditLogService.list` covered by 5 new unit tests.
- **Settings rebuilt as a single "Save all changes" form**, replacing four separate per-field Save buttons — matches every other form in the app. Adds an "Unsaved changes" indicator, per-field required/format validation before saving (with inline error text), and a centered save confirmation. Only fields that actually changed are sent to the server.

See `docs/decisions.md`, `docs/api-reference.md`, `docs/architecture.md`, `docs/testing.md` for the reasoning and updated contracts behind each of these.

## 2026-09-22 (cont. 4) — Fix: concurrent-device duplicate race, offline search, silent offline-storage failures

### Fixed

- **Two guards on two different devices tapping for the same employee within the same instant could both create a movement with no duplicate warning shown to either.** `MovementsService.createMovement` read "last movement for this employee" and wrote the new record as two separate steps with no lock between them — two near-simultaneous requests could both read the same "last movement" before either committed, and both slip past the duplicate-type confirmation check. Fixed by wrapping the check-then-write in a transaction that takes a Postgres advisory lock (`pg_advisory_xact_lock`) scoped to that employee's id — this serializes concurrent requests for the *same* employee only (any other employee's tap proceeds immediately, uncontended) and releases automatically when the transaction ends. The guard-facing behavior is unchanged: the second tap still gets the "already marked in/out" confirmation and can record it anyway if confirmed. Verified against the real database (not just mocked) with two concurrent connections requesting the same lock key: the second visibly waited ~1s for the first to finish, while two different employees' locks ran fully concurrently.
- **A guard could not search for a new (not-already-selected) employee while genuinely offline.** `/employees/search` is deliberately `NetworkOnly` in the service worker, and there was no local copy of the roster at all — a guard who opened the app already offline, or went offline before picking someone new, had no way to find them. Fixed: new `GET /employees/offline-cache` (full active roster, lightweight fields) is fetched by the frontend on load and every 5 minutes while online, cached in `localStorage` (`frontend/src/offline/employeeCache.ts`), and used as the search fallback whenever the app is offline (or a live search call fails). Verified end-to-end: cached 206 employees while online, went fully offline, searched, and got correct matching results with no error banner.
- **Two unhandled-promise-rejection paths in the offline queue.** `enqueueMovement()` (IndexedDB) can reject — private-browsing restrictions, storage quota, a locked-down device profile — and both call sites in `SecurityHome.tsx` awaited it with nothing catching a failure: the guard's tap would silently do nothing, no banner at all, at the exact moment (already offline) they'd most need feedback. Now wrapped in `try/catch` with a visible error banner. `refreshPendingCount` (also IndexedDB) got the same treatment since it's called from several places, some of them fire-and-forget.

## 2026-09-22 (cont. 3) — Fix: offline-recorded movements now keep their real tap time

### Fixed

- **A movement recorded while offline was written to the database with the time it happened to *sync*, not the time the guard actually tapped ENTRY/EXIT.** Found while discussing what happens when several offline taps sync at once: `MovementsService.createMovement` always used `new Date()` at request-processing time, and the offline queue's locally-captured real tap time (`queuedAt`) was never sent to the server. A guard offline for a couple of hours would have every queued tap land bunched within seconds of each other at the sync moment. Fixed: `POST /movements` now accepts an optional `clientMovementAt`, sent only by the offline-queue sync path, and uses it (flagging the record `recordedOffline: true`) only when it's within a plausible window (≤7 days in the past, ≤5min in the future) — otherwise falls back to the server clock exactly as before. Live/online taps are completely unaffected. New `recorded_offline` column (migration `20260922120000_add_recorded_offline_flag`) surfaced as a small "offline" badge next to the time in Dashboard, EmployeeDetails, and Corrections. See `docs/decisions.md`.
- Verified end-to-end with Puppeteer + simulated network offline: tapped ENTRY offline, waited ~7s, reconnected — the synced record's `movementAt` landed within 515ms of the real tap time (not the ~6.4s-later reconnect time), `recordedOffline: true`.

### Added

- **`clientMovementAt`'s plausibility window raised from 48h to 7 days** — these are company-managed phones, not open personal devices, so the backdating-spoofing risk the bound guards against is lower than the original assumption; 48h was too tight for a real extended-leave/broken-phone case. See `docs/decisions.md`.
- **New `frontend/src/offline/clockOffset.ts`: corrects a wrong device clock in software, without relying on phone settings.** Whenever the app successfully reaches the server (piggybacking on the existing 20s health-check poll), it compares the server's reported time against the device's own clock and stores the difference. The offline queue (`movementQueue.ts`'s `enqueueMovement`) now captures `queuedAt` using this corrected clock instead of the raw device clock, so a device with a wrong system time no longer produces a wrong `clientMovementAt`. Verified end-to-end: simulated a device clock running 3 hours fast, recorded an offline tap, and the synced record's `movementAt` landed within 335ms of the true tap time (not ~3 hours off).

## 2026-09-22 (cont. 2) — Login by username or email; faster reset after recording a movement

### Added

- **Login now accepts either username or email in the same field** (`Username or Email` on the login form) — email match is case-insensitive. Requested by the user. Backend: `AuthService.validateUser` now matches on `username` OR case-insensitive `email` instead of `username` only.

### Changed

- **Cut the delay between recording an ENTRY/EXIT and the search box reappearing for the next employee from 1800ms to 800ms** (`AUTO_RESET_DELAY_MS` in `SecurityHome.tsx`) — reported by the user as feeling slow when working through several people quickly at the gate. The success/pending-sync confirmation banner isn't cleared by this timer (only picking the next employee does), so the confirmation stays visible above the search box rather than being lost.

## 2026-09-22 (cont. 1) — Dashboard: employee names are now clickable, linking straight to their day view

### Added

- **Employee names in the Dashboard's movement records table/cards are now links** to `/employee-details` for that employee and the currently selected date — same destination as the existing "View Employee Day" button, just reachable directly from the row instead of requiring a separate employee-filter step first. Requested by the user. Verified via screenshot (both the table row link and the resulting Employee Movement Details page).

## 2026-09-22 — Fix keep-alive workflow's timeout being shorter than Render's actual cold-start time

### Fixed

- **`.github/workflows/keep-alive.yml` had failed on every scheduled run since it started actually hitting a cold backend** (3 consecutive failures, reported by the user). Its first run happened to pass because the backend was already warm from manual testing; every run after that failed. Root cause: `curl --max-time 25` against a Render free-tier instance that was genuinely asleep — timed a real cold start at 33s, over the 25s budget. Bumped to `--max-time 100`.

## 2026-09-21 (cont. 6) — Employee search dropdown now closes on outside click; no longer opens itself on page load

### Fixed

- **SecurityHome's search box auto-focused on page load, so its browse dropdown opened by itself before any click — and none of the three employee search boxes (SecurityHome, Dashboard, Corrections) could be dismissed by clicking elsewhere on the page.** Reported directly by the user: the dropdown stayed open and covered the rest of the screen, including the Dashboard button, until an employee was picked. Removed `autoFocus`; added a `dropdownOpen` state per page (independent of the cached results list) plus a click-outside listener that closes it. Verified via screenshot and by confirming the Dashboard link becomes clickable again after clicking outside the dropdown.

## 2026-09-21 (cont. 5) — Employee search dropdown now shows a browse list on focus, not just after typing

### Fixed

- **Every employee search box (SecurityHome, Dashboard's employee filter, Corrections) showed nothing until you started typing** — reported directly by the user as looking unresponsive/broken. `EmployeesService.search()`/`searchIncludingInactive()` now return the first 10 employees alphabetically for a blank query instead of `[]`; the frontend fetches this immediately on input focus (in addition to the existing debounced fetch while typing), so tapping an empty search box shows a usable list right away. Verified via screenshot: SecurityHome's `autoFocus` search box shows the browse list the instant the page loads; clicking Dashboard's empty "All Employees" field shows it immediately too.

## 2026-09-21 (cont. 4) — More UX fixes (pagination-preserving edits, success confirmations), docs consolidation, file audit

### Fixed

- **Editing or deactivating/reactivating an employee reloaded the whole list from page 1**, silently discarding "Load More" progress — an admin who scrolled/loaded to row 150 to fix one record would lose their place entirely. `Employees.tsx`'s `saveEdit`/`toggleActive` now patch the one affected row in local state using the API's response, instead of reloading. Same fix applied to `Users.tsx`'s disable/enable.
- **No success confirmation after "Add Employee" or "Add User"** — the form just cleared silently; with 200+ employees sorted alphabetically, a newly added one might not even appear in the post-reload page-1 view, so there was no reassurance it actually worked. Both now show an explicit green confirmation banner.
- **`Users.tsx` had no loading indicator at all** — missed in the earlier loading-skeleton pass; added, matching every other data table.

### Changed — docs

- **Merged `docs/email-provider-options.md` into `docs/decisions.md`** — its content (a provider comparison table) was already substantially duplicated by `decisions.md`'s two email-provider decision entries; folded the table in there and deleted the standalone file, updating the three docs that referenced it (`branding-and-data-needed.md`, `roadmap.md`, `docs/README.md`). Net: 17 docs → 16.
- Documented the new UI/UX conventions from this and the prior UX pass in `docs/developer-guide.md` ("Adding a new frontend page"): reuse `TableSkeleton`/`PasswordInput`, edit forms triggered from a table row must be a modal, patch-not-reload after row-level edits, required-field markers, success confirmations on create actions.
- Added a `docs/roadmap.md` section summarizing the full 2026-09-21 UI/UX pass, and two manual-QA checklist items to `docs/testing.md`.

### Audited, no action needed

- Full sweep of every project file (excluding `node_modules`/`.git`/`dist`): nothing unnecessary or dead found. Two files that look like candidates for removal on first glance are both legitimate: `backend/src/reports/assets/adage-logo.png` is a separate, necessary copy of the logo embedded server-side into generated PNG/PDF reports (distinct from `frontend/public/logo.png`, which the browser bundle can't reach); `backend/test/app.e2e-spec.ts` is a real, working e2e suite (skipped unless `E2E_TEST_DATABASE_URL` is set), not a stale scaffold. `*.tsbuildinfo` and `.claude/scheduled_tasks.lock` are local-only, already-gitignored/untracked build-cache and tooling artifacts — no cleanup needed.

## 2026-09-21 (cont. 3) — Employee edit form moved into a modal

### Fixed

- **"Edit" on the Employees admin list opened the edit form at the top of the page**, invisible without scrolling back up — worst once the roster needed "Load More" and an admin was editing a row far down the list, with no indication where their typing was even going. Converted to a centered modal dialog (`Employees.tsx`) matching the pattern already used by Corrections.tsx and the ENTRY/EXIT duplicate-confirm dialog — appears directly over the clicked row regardless of scroll position, first field auto-focused, same focus-trap/Escape-to-close behavior as the other modals. Verified via screenshot: scrolled to the 44th row, clicked Edit, modal opened centered with the correct employee's data pre-filled.

## 2026-09-21 (cont. 2) — Header logo fix + UI/UX pass (loading states, password visibility, search clear, touch targets, required-field markers)

### Fixed

- **Header logo had a soft "shadow"/blurred edge around the wordmark.** The logo is teal and the header background is dark teal, so it was being rendered white via a CSS mask trick — masking a PNG's anti-aliased alpha edges blurs/fringes at this small a size. Replaced with a small white badge showing the logo in its real, unaltered color (`.logo-badge` in `global.css`, `Header.tsx`) — same technique the login card already used successfully. Verified via screenshot: crisp on both desktop and 390px mobile, no artifacts.

### Added — UI/UX pass

- **Loading skeletons** (`frontend/src/components/TableSkeleton.tsx`) on every data table that previously showed nothing during its initial fetch — Dashboard, Employees, Corrections, Audit Log, Employee Details. Verified via a throttled-network screenshot that it actually renders mid-load, not just in theory.
- **Password visibility toggle** (`frontend/src/components/PasswordInput.tsx`, new `IconEye`/`IconEyeOff`) on every password field: Login, Reset Password (both fields), and the Users "Add User" form.
- **Clear (×) button inside every search input** — SecurityHome, Dashboard's employee filter, Corrections' employee search, and the Employees admin list — previously only the selected-employee chip had a clear affordance.
- **Larger touch target on `.table-action-btn`** (Edit/Deactivate/Reactivate/Correct buttons) — was ~28px tall, now 36px+, comfortable on a tablet/touchscreen.
- **Required-field markers** (`*`) on every required form field across Login, Reset Password, Users, and Employees (add + edit forms), and Corrections' time field.
- **16px minimum font-size on all `.field` inputs/selects** (was 15px) — under 16px, iOS Safari auto-zooms the whole page on focus, a jarring surprise on a form filled out on a phone.
- **`autoFocus` on Login's username field and Reset Password's first field** — one less tap/click before typing.

## 2026-09-21 (cont.) — Docs sync: deployment reality, new /health endpoint, all 2026-09-21 audit fixes documented

Full documentation pass, requested explicitly ("check all the docs and update them ... keep the docs properly inlined with the code we have now"). No code changes — docs only.

### Fixed (stale docs)

- **`docs/deployment.md` and `docs/roadmap.md` both still said "nothing is deployed yet"** and listed deployment as not-started, despite the app having been live on Vercel (frontend) + Render (backend) + Supabase (database) since 2026-09-11. Rewrote both to state the actual live setup, added a new "Keeping it alive" section covering Render's sleep + Supabase's auto-pause and the `/api/health` + keep-alive-workflow mitigation, and updated the Puppeteer pre-deployment checklist item with the real Render `postinstall`-gets-skipped gotcha found and fixed live today.
- **`docs/api-reference.md`** — added the new `GET /health` endpoint; documented the new `409`/`400` responses on `PUT /employees/:id`/`PUT /users/:id`/`PATCH /users/:id/disable` from today's uniqueness/admin-lockout fixes; corrected the dashboard summary's default-date note to mention the IST fix.
- **`docs/decisions.md`** — added entries for all of today's real decisions: last-admin lockout protection, case-insensitive employeeCode/email uniqueness, real server-reachability detection, offline-sync timer retry + `beforeunload` warning, the double-tap guard, the Render/Puppeteer build-command fix, and the health-endpoint/keep-alive design.
- **`docs/security.md`, `docs/database-schema.md`, `docs/architecture.md`, `docs/developer-guide.md`, `docs/testing.md`, `README.md`, `docs/branding-and-data-needed.md`** — updated for the new `health` module, the admin-lockout/uniqueness/reachability fixes, the `todayInAppTimezone()` helper, and (branding doc) marking domain/deployment as live rather than "when ready to go live."

## 2026-09-21 — Full code audit fixes: admin-lockout guard, duplicate-tap guard, IST date bug, uniqueness checks, reachability detection, storage fail-fast

### Fixed

- **Backend `/dashboard/summary` returned yesterday's data for the first 5.5 hours of every IST day** when called with no `date` param — its own default-date fallback still used `new Date().toISOString().slice(0, 10)` (UTC calendar date), the exact bug already fixed in the frontend's `todayIso()`. Added `todayInAppTimezone()` (`backend/src/common/utils/day-range.ts`) and switched the fallback to it.
- **Changing a user's email to one already in use 500'd** with a raw Prisma P2002 instead of a clean error. `UsersService.update()` now checks for a case-sensitive clash first and throws a proper 409 ("That email address is already in use by another user.").
- **No protection against locking every Admin out.** `UsersService` now blocks disabling the last remaining active user who holds `MANAGE_USERS`, and blocks reassigning that user's role away from one that holds it, either way returning a clean 400 instead of allowing a silent total lockout recoverable only via direct DB access.
- **Duplicate ENTRY/EXIT records possible on a slow connection** — the guard's big ENTRY/EXIT buttons had no in-flight guard, so a double-tap could fire two concurrent requests each with their own idempotency key. `SecurityHome.tsx` now tracks a `submitting` flag, disables both buttons (and the confirm-dialog's buttons) while a request is in flight, and shows a spinner.
- **Employee search failures were indistinguishable from "no such employee"** — a network blip during search silently rendered an empty result list. `SecurityHome.tsx` now shows an explicit "Search failed — check your connection and try again." message instead of a false-empty state.
- **`employeeCode` uniqueness was case-sensitive while every search is case-insensitive**, and employee `email` had no uniqueness constraint at all. `EmployeesService` now checks both case-insensitively on create/update and returns a clear 409 (naming the existing employee, for the email case) instead of allowing silent collisions.
- **`StorageService` built an S3 client with empty-string defaults** when `STORAGE_BUCKET`/`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` were unset, failing deep inside the AWS SDK with an opaque error. Added a `requireConfig()` fail-fast check matching `EmailService`'s existing pattern, and made the S3 client itself lazy (only constructed once config is confirmed present).
- **Correction/missing-record modal crashed into a raw "Invalid time value" error** if the native time field was cleared before saving — `edit.time`'s unguarded `Number()` parse produced `NaN`, which flowed into `setHours(NaN, ...)` and then threw out of `.toISOString()`. `Corrections.tsx` now validates the parsed hours/minutes before use and shows a friendly message instead.

### Added

- **`GET /api/health`** (`backend/src/health/health.controller.ts`) — public, unauthenticated, does a real `SELECT 1` round trip. Serves two purposes: (1) the frontend's new real server-reachability check (below), and (2) an external keep-alive target — see `.github/workflows/keep-alive.yml`, a scheduled GitHub Actions job pinging it every 10 minutes to stop Render's free tier from sleeping and Supabase's free tier from auto-pausing.
- **Real server-reachability detection on the recording screen** (`frontend/src/api/health.ts`, wired into `SecurityHome.tsx`) — `navigator.onLine` only reflects the network link, not whether the backend is actually reachable (dead backend, DNS hiccup, captive portal all still report "online"). The recording screen now polls `/api/health` every 20s while the link is up and shows a distinct "server unreachable" banner instead of no warning at all. Mirrors the same class of fix already made for auth (`AuthContext.tsx`'s `shouldUseCachedUser`).
- **Offline sync now retries on a timer, not just on browser online/offline events** — previously a movement queued during a transient server-side blip (not a real link drop) could sit unsynced indefinitely since no browser event would ever fire to trigger a retry. `SecurityHome.tsx` now polls every 20s while anything is pending and the connection is effectively up.
- **`beforeunload` warning when offline movements are still pending sync** — mitigates (not eliminates) the offline queue's biggest risk: it lives only in this browser's IndexedDB with no server-side trace, so clearing site data, uninstalling the PWA, or switching devices before syncing loses those movements permanently and silently. A guard is far less likely to do that if warned at the moment they'd navigate away or close the tab.

## 2026-09-11 (cont. 3) — Full mobile/desktop responsive audit, two real layout bugs fixed

### Fixed

- **Settings page's nav bar wrapped to two rows on desktop** while every other admin page's nav stayed on one — `Settings.tsx` was the only screen rendering `AdminNav` inside the narrow `.page` container (meant for single-column screens like Login/EmployeeDetails) instead of `.page-wide` (used by every other AdminNav-bearing page: Dashboard, Employees, Users, Corrections, Audit Log). Switched to `.page-wide` to match; verified all 7 nav links now render on one row at 1440px, content still well-proportioned, no change on mobile.
- **Employees/Users "Add" forms cut off the last field's text on mobile**: the submit button's wrapper `<div>` had no width/basis, so on a 390px viewport it barely still fit on the same flex row as the "Car Number"/last field, squeezing that input's placeholder to a few visible characters instead of wrapping to its own row like the rest of the form did. Added a `.form-actions` class + a mobile-only `width: 100%` rule so the button always gets its own row under 640px; desktop screenshot confirmed pixel-identical to before.

### Verified

Full pass across every route, all three roles (Security/HR/Admin), at both 390px (mobile) and 1440px (desktop): zero horizontal overflow, zero console/page errors anywhere. Also found and fixed a stale credential: the seeded `security` dev login's password had been changed to something undocumented by an earlier live forgot-password test (confirmed via its audit log — a genuine `USER_PASSWORD_RESET` on 2026-09-10) — reset back to the documented `ChangeMe123!` dev default directly in the database (not a code/migration change, so nothing to commit for this part).

## 2026-09-11 (cont. 2) — Offline-auth-cache gap closed, ARIA label associations fixed, frontend test deps self-declared

### Fixed

- **Offline auth cache didn't cover "online but server unreachable"**: `AuthContext.tsx`'s fallback to a cached logged-in user required `!navigator.onLine`, but a dead backend/DNS hiccup/dropped VPN leaves `navigator.onLine` at `true` while the request still fails — that whole case silently logged the user out instead of trusting a valid cached session. Now falls back to the cache on any failure that isn't a real `ApiError` (a server-issued 401/403). The decision is factored into an exported, unit-tested `shouldUseCachedUser()` (`frontend/src/auth/AuthContext.spec.ts`, 3 new tests). Found by the 2026-09-11 audit; see `docs/decisions.md`.
- **24 form fields across 6 pages had visually-present but programmatically unassociated `<label>`s** (Employees, Users, AuditLog, Dashboard, Corrections, Settings) — a screen reader announced these inputs/selects with no name at all. Fixed by nesting each control inside its `<label>` (implicit association); `Login.tsx`'s existing `htmlFor`/`id` fields were already correct and untouched. Added a small CSS rule to keep the label-to-control spacing identical to before. Verified visually via Puppeteer screenshots of all six pages — no layout regressions — and the new nesting was confirmed programmatically (every Employees-page input now resolves an accessible name via its enclosing label).
- **`frontend/package.json` was missing its own test dependencies** (`jest`, `ts-jest`, `@types/jest`) despite having a `test` script and spec files — it only worked because npm workspaces hoisted them from `backend`'s devDependencies. Declared them directly in `frontend/package.json` (versions matched to backend's) so `frontend`'s tests don't silently depend on another workspace's dependency tree. Found by the 2026-09-11 audit.

### Checked, found already correct

Color contrast across the app's status/muted text colors (all ≥4.6:1 against their backgrounds, passing WCAG AA); icon-only buttons (none exist — every button already pairs an icon with visible text).

## 2026-09-11 (cont.) — Timezone validation, audit-log PII sanitization, offline-conflict polish, expanded test coverage, docs sync

### Added

- **Backend timezone validation** (`backend/src/common/utils/timezone.ts`) — checks at boot whether the runtime `TZ` matches `APP_TIMEZONE`; in production, a mismatch now fails loudly at startup instead of silently drifting day boundaries. Closes part of the "Known simplifications: timezone correctness" roadmap item (the remaining piece — explicit UTC↔IST conversion independent of the process TZ — is still open).
- **Audit log PII sanitization** (`backend/src/audit-logs/audit-log.service.ts`) — `oldValue`/`newValue` snapshots are now sanitized before storage: sensitive keys (passwords, tokens, secrets, session/cookie fields) are stripped, and full employee objects are compacted to a minimal summary (id/name/code/car number/active) instead of every column. Closes the "audit log rows duplicating full employee PII" item tracked since the 2026-09-04 audit.
- **Offline conflict resolution got a "Dismiss" option** alongside the existing "Record anyway" — a guard can now discard a stale conflict without being forced to record it, plus each conflict shows its reason. `frontend/src/pages/SecurityHome.tsx`, `frontend/src/offline/movementQueue.ts`.
- **Expanded backend/frontend test coverage** — new spec files for `employees.controller`, `reports.controller`, `reports.service`, `audit-log.service`, `timezone`, and the frontend's `movementQueue`/`EmployeeDetails`.
- Accessibility polish: `role="status"`/`role="alert"` + `aria-live` on every status banner across SecurityHome/EmployeeDetails/Settings.
- `backend/data/employees.csv` gained a `car_number` column (blank for existing rows); the old dated-snapshot CSV (`employees-roster-2026-09-09.csv`) was removed as fully redundant with it.

### Docs

Synced `docs/api-reference.md`, `docs/architecture.md`, `docs/branding-and-data-needed.md`, `docs/database-schema.md`, `docs/deployment.md`, `docs/developer-guide.md`, `docs/email-provider-options.md`, `docs/roadmap.md`, `docs/security.md`, `docs/testing.md`, `docs/user-guide-admin.md`, `docs/user-guide-hr.md`, `docs/user-guide-security.md`, and `README.md` against the current code — most notably, `docs/roadmap.md`/`docs/testing.md` no longer say "zero test files exist" now that real backend/frontend test coverage does.

## 2026-09-11 — Fixed HR's Dashboard access, broken by the recording-permission removal

### Fixed

- **HR's Dashboard employee filter silently returned nothing**: `GET /employees/search` was gated behind `RECORD_ENTRY`, which HR lost in Commit 15. Changed to `VIEW_DASHBOARD` — held by every role that needs this endpoint (SECURITY for the recording screen, HR for the Dashboard filter), with no extra access granted (`backend/src/employees/employees.controller.ts`).
- **`AdminNav.tsx`'s "Record Movement" link had no permission check at all**, unlike every other link in that component — it kept showing for HR even after HR lost `RECORD_ENTRY`, dangling a link to a page that would just redirect away. Wrapped it in `hasPermission('RECORD_ENTRY')` to match the established pattern.
- Verified live: HR now lands on `/dashboard` after login with only Dashboard/Employees in the nav, the employee filter dropdown returns real results, and Security's recording flow is unaffected.
- **CI pipeline (`.github/workflows/ci.yml`) would have failed on every run**: `npm ci`'s `postinstall` hook runs `prisma generate`, which requires `DATABASE_URL` to resolve — with no `.env` on a fresh CI checkout and no env var set, it fails with "Environment variable not found" before lint/test/build ever run. Added `DATABASE_URL`/`SESSION_SECRET` to the workflow's `env:` block (dummy values — nothing in this workflow connects to a real database). Found by an audit fork; fixed directly.

## 2026-09-10 (cont. 4) — Total working hours, offline conflict surfacing, auth cache, edit-in-place for employees, accessibility improvements, stale-code/docs sweep

### Added

- **Total working hours on the employee day view** (`frontend/src/pages/EmployeeDetails.tsx`) — a teal banner showing "Total working hours: Xh Ym" now appears below the movement list. Calculated client-side from the already-loaded records: first ENTRY to last EXIT of the day. No backend change, no new endpoint. Returns `null` (banner hidden) when there is no EXIT yet. Formatted as `"8h"`, `"30m"`, or `"7h 45m"`. `IconClock` (already in icons.tsx) used for the icon. `.working-hours-banner` CSS added to `global.css` using the existing brand teal palette.

- **Offline conflict surfacing** (`frontend/src/pages/SecurityHome.tsx`, `frontend/src/offline/movementQueue.ts`) — a queued movement that comes back `requiresConfirmation` during sync is now flagged `syncState: 'conflict'` and surfaced to the guard as a red "X offline movements need review" banner with a "Record anyway" button, instead of being silently auto-confirmed. The queue is also scoped per `userId` so guards sharing a device don't see each other's pending movements.

- **Offline auth cache** (`frontend/src/auth/AuthContext.tsx`) — the last successfully authenticated user is cached in `localStorage` (12h expiry, key `adage.last-authenticated-user`). If `/auth/me` fails because the browser is offline (no `ApiError`), the cached user is restored so the recording screen and queue remain accessible. Cleared explicitly on logout.

- **Edit-in-place for employees** (`frontend/src/pages/Employees.tsx`) — an "Edit" button per row expands an inline form to update name, email, and car number without navigating away. Previously the edit UI was undocumented / non-functional from the admin screen.

- **`SESSION_SECRET` production guard** (`backend/src/main.ts`) — throws at boot if `SESSION_SECRET` is unset in production, preventing a silent deploy with an empty/default session secret.

- **`clientRequestId` conflict check** (`backend/src/movements/movements.service.ts`) — if a `clientRequestId` arrives that already exists but maps to a *different* employee, movement type, or recorder, the server throws `ConflictException` instead of silently returning the wrong record. Closes a theoretical idempotency-key collision scenario.

- **`AuthContext` refactored into three files** — `AuthContext.tsx` (provider + cache logic), `auth-context.ts` (context object + type, no React imports beyond `createContext`), `useAuth.ts` (`useAuth` hook). All component imports updated to use `useAuth.ts`. Eliminates the re-export of `ApiError` from `AuthContext.tsx` — callers now import it directly from `api/client.ts`.

- **`ErrorBoundary` wrapped around entire app** (`frontend/src/App.tsx`) — previously `ErrorBoundary` existed but was never mounted at the root level.

- **`eslint-disable` comment removed** (`frontend/src/components/ErrorBoundary.tsx`) — the `no-console` disable in `componentDidCatch` was unnecessary since `console.error` is appropriate for error boundary logging.

- **Modal accessibility** (`SecurityHome.tsx`, `Corrections.tsx`) — both confirm/correction dialogs now have `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, initial focus on open, Tab focus-trap, and Escape-to-close.

- **`aria-label` added** to employee search inputs on SecurityHome, Dashboard, and Corrections for screen-reader clarity.

- **`npm run test`** wired at the root workspace level to run backend and frontend tests together (`--runInBand`). `npm run load:test` added for the `autocannon` benchmark. Root-level test tooling deps (`supertest`, `@typescript-eslint/*`, `eslint*`, `fake-indexeddb`, `autocannon`) added. Frontend `package.json` gains a `test` script.

### Changed

- **Login label** (`frontend/src/pages/Login.tsx`) — field label changed from "Username or Email" to "Username" to match what the backend actually accepts (username only, not email).

- **Users.tsx** imports `useAuth` from `auth/useAuth` (not `auth/AuthContext`) — consistent with the refactor above.

- **`UnauthorizedException` import removed** from `backend/src/auth/auth.service.ts` — it was imported but unused; the local strategy throws it directly.

### Docs

- `docs/architecture.md` — updated `auth/` file listing for the three-file split; updated `movementQueue.ts` description for userId scoping and conflict state.
- `docs/decisions.md` — updated "Offline handling" ADR to reflect conflict-surface behavior; added new "Offline auth cache" ADR.
- `docs/roadmap.md` — working hours added to Done; audit findings section updated (offline auth, modal a11y, offline duplicate resolution all now done); "Known simplifications" conflict description updated.
- `docs/testing.md` — intro updated; added test items for conflict state and idempotency-key collision.
- `docs/user-guide-security.md` — offline conflict section updated to describe the "Record anyway" banner.
- `README.md`, `docs/user-guide-hr.md`, `docs/user-guide-admin.md`, `docs/developer-guide.md` — working-hours scope updated (from "none" to "day-view total; no timesheet roll-up").
- `backend/src/dashboard/dashboard.controller.ts` — stale "no working-hours anywhere" comment updated.

## 2026-09-10 (cont. 3) — Forgot password, full crash/bug audit fixes, a deployment-blocking migration bug fixed

### Added

- **Self-service "forgot password"** — `POST /auth/forgot-password` and `POST /auth/reset-password` (`backend/src/auth/`), a single-use SHA-256-hashed 1-hour-expiring token stored on the `User` row (new migration `20260910100000_add_password_reset_token`). New frontend pages `ForgotPassword.tsx`/`ResetPassword.tsx`; the login page's dead placeholder link now works. Both endpoints rate-limited like login. Verified live end to end: invalid/expired/reused token → 400, valid token + short password → 400, valid token + valid password → 200 and the new password logs in, non-existent email → identical generic response to a real one (no enumeration leak). See `docs/decisions.md`.

### Fixed — full codebase crash/bug audit (forked, then verified/fixed directly)

- **Frontend white-screen crash**: `EmployeeDetails.tsx` computed `dateLabel` from an unvalidated `date` URL param — a malformed/hand-edited/stale-bookmarked link threw a `RangeError` synchronously during render, and no `ErrorBoundary` existed anywhere in the app, so this crashed the entire React tree to a blank screen. Fixed at the source (falls back to today for an invalid date) and added `frontend/src/components/ErrorBoundary.tsx` as defense in depth. Verified live via Puppeteer: navigating to `/employee-details?...&date=not-a-real-date` now renders normally.
- **Backend 500s instead of clean 400s** on every date-filtered endpoint (`GET /movements`, `GET /movements/employee/:id`, `GET /dashboard/summary`, `GET /reports/image`/`pdf`, `POST /reports/email`) — same root cause, an unvalidated `date` query param reaching Prisma/`Intl.DateTimeFormat` as an `Invalid Date`. Extracted the duplicated `dayRange()` logic (previously copy-pasted in both `movements.service.ts` and `reports.service.ts`) into one shared, validated helper (`backend/src/common/utils/day-range.ts`) that throws a clean `BadRequestException` instead. Verified live: `?date=not-a-date` and `?date=2026-13-99` both now return 400, valid dates unaffected.
- **Pooled Puppeteer browser had no self-healing**: if it crashed/disconnected mid-session (rather than failing at launch, which was already handled), every subsequent report request kept returning the same dead `Browser` and failing forever until the whole Node process restarted — a regression risk introduced by the 2026-09-10 pooling change itself. Added a `disconnected` listener that clears the cached browser so the next call relaunches.
- **Corrections.tsx**: clearing the date filter sent `""` to `new Date("")`, throwing a raw `"Invalid time value"` RangeError shown verbatim to the user instead of a friendly message. Now validated before submit.
- Two unguarded non-null assertions in `report-generator.service.ts` (`bodyHandle!.boundingBox()!`) replaced with an explicit check and a clean `InternalServerErrorException`.

### Fixed — a real deployment-blocking bug, found while adding the password-reset migration

- Migration `20260909120000_enable_row_level_security` unconditionally ran `ALTER TABLE "session" ENABLE ROW LEVEL SECURITY`, but that table only exists once the app has booted at least once (created at runtime by `connect-pg-simple`). On any genuinely fresh database — a real first production deploy, a CI/shadow database — this would fail and abort every migration after it, forever, blocking the app from ever starting. Found via `prisma migrate dev`'s shadow-database validation. Fixed by editing the already-applied migration (a rare, deliberately-justified exception — see `docs/decisions.md` — since nothing has been deployed yet and this dev database is the only environment that has ever run it) to guard the statement behind an existence check. Verified: `prisma migrate deploy` runs clean against the live dev database with no drift/checksum error.

### Docs

- Updated `docs/roadmap.md`, `docs/decisions.md` (two new ADRs), `docs/security.md`, `docs/api-reference.md`, `docs/architecture.md`, `docs/database-schema.md` (also added two previously-undocumented audit actions, `REPORT_DOWNLOADED` and `PASSWORD_RESET_REQUESTED`), and `docs/testing.md` to reflect all of the above.

## 2026-09-10 (cont. 2) — Full "Email Details" flow verified working end to end

### Verified live

- **The Microsoft Graph API OAuth2 email send is confirmed working**: Adage registered the Azure AD app, filled in `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` in `backend/.env`, and granted admin consent for `Mail.Send`. A live isolated test first caught the exact expected failure mode (`403 ErrorAccessDenied` — token acquisition succeeded, confirming the credentials, but the send was rejected pre-consent); after consent was granted, the same test succeeded.
- **Supabase Storage is confirmed working**: `STORAGE_*` env vars filled in. A full, real `POST /reports/email` call against employee `Adarsh Bhaskaran Chanabhat` returned `email_logs.status: "SENT"` with `reportFileUrl` populated; the signed re-download URL (`GET /reports/email-logs/:id/download`) was fetched directly and confirmed to be a valid 720×530 PNG.
- This closes both items that were previously tracked as "Blocked — waiting on external input" in `docs/roadmap.md`.

### Changed — temporary configuration, noted for follow-up

- **No `security@adage-automation.com` mailbox exists yet** — `MAIL_FROM_ADDRESS`/`SECURITY_EMAIL` in `backend/.env` are temporarily set to `shivani.naik@adage-automation.com` as a stand-in for both the sending mailbox and the CC address. Swap back once the real mailbox is created (see `docs/email-m365-admin-handoff.md`). Recorded in project memory (`project_email_temp_mailbox.md`) so this isn't forgotten in a future session.
- **The Exchange Online application access policy restricting the Azure app to one mailbox has not been confirmed run** — `Mail.Send` as an application permission can currently send as any mailbox in the tenant. Tracked as a follow-up security-hardening step in `docs/roadmap.md` and `docs/security.md`, not a blocker to normal use.
- Cleaned up the one fabricated test movement record created to exercise this flow (`clientRequestId: test-e2e-email-verify-1`). Deliberately **left the resulting `email_logs` row in place** — unlike the movement record, it reflects a real event (a real email was actually sent and delivered), and `email_logs` exists specifically to prove what was sent, so removing it would defeat that purpose (same principle as never touching `audit_logs`).

### Docs

- Brought `docs/roadmap.md`'s "Blocked" section, "Done" list, and "Suggested next step" current with the above. Removed a stale duplicate `docs/decisions.md` reference (`docs/decisions.md#numeric-input-validation...`) gap — added the missing ADR for the `ParseIntPipe({ optional: true })` bug found and fixed 2026-09-10. Added the settings-key-whitelist and numeric-param-validation behavior to `docs/api-reference.md` and `docs/security.md`. Enhanced `README.md`'s Technology Stack table with previously-undocumented pieces (RLS, pooled Puppeteer, npm workspaces, request timeout, RBAC approach). Fixed remaining `cd backend`-style command inconsistencies in `docs/testing.md`, `docs/database-schema.md`, and `docs/branding-and-data-needed.md` to match the npm-workspaces command style used everywhere else.

## 2026-09-10 (cont.) — Fixed loading-vs-empty-state flash on Dashboard/EmployeeDetails/Corrections

### Fixed

- **Dashboard, EmployeeDetails, and Corrections all initialized their record list as `[]`**, which is indistinguishable from "genuinely no records for this date" — so the "No records found" empty state briefly flashed on every navigation or filter change, even when data was about to arrive. Added a `recordsLoading` flag to each page, set before the fetch and cleared in `.finally()`, and gated the empty-state block on `!recordsLoading`. Verified live via a scripted check: switching Dashboard's date to one with real movement data showed zero empty-state flash before the table rendered (a naive fetch-in-progress check would have shown it).

## 2026-09-10 — Email switched to Microsoft Graph API (OAuth2); several roadmap items closed out

### Changed — email transport

- **Switched email sending from SMTP to the Microsoft Graph API** (`backend/src/email/email.service.ts`) — Adage's Microsoft 365 admin confirmed the tenant has basic-auth SMTP AUTH retired, so the SMTP implementation from 2026-09-07 could never have worked regardless of credentials. Now authenticates via an Azure AD app registration (OAuth2 client-credentials grant against `login.microsoftonline.com`) and sends through `graph.microsoft.com/v1.0/users/{mailbox}/sendMail`. Removed `nodemailer`/`@types/nodemailer` (now unused). Rewrote `docs/email-m365-admin-handoff.md` for the new Azure app-registration steps (register app, grant `Mail.Send` with admin consent, scope it to the security mailbox via an Exchange Online application access policy) and updated every doc that referenced SMTP env vars (`README.md`, `docs/architecture.md`, `docs/api-reference.md`, `docs/deployment.md`, `docs/developer-guide.md`, `docs/roadmap.md`, `docs/branding-and-data-needed.md`, `docs/email-provider-options.md`) plus a new ADR in `docs/decisions.md`. New env vars: `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`/`MAIL_FROM_ADDRESS` (replacing `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`EMAIL_FROM`). Still blocked on the admin handoff — no functional regression, since a real send was never possible either way.

### Fixed — closing out several tracked roadmap items

- **`SettingsController` now whitelists known setting keys** (`backend/src/common/constants/settings-keys.ts`) — `PUT /settings/:key` with an unrecognized key now returns a clean 400 instead of silently creating a junk row.
- **Every controller now uses `ParseIntPipe` (or a small `parseOptionalInt` helper) for numeric route/query params** instead of raw `Number(id)` — a malformed ID now returns a clean 400 instead of reaching Prisma and surfacing as a raw 500. Caught and fixed a real bug introduced mid-change: Nest's built-in `ParseIntPipe({ optional: true })` was found to throw even when the query param is completely absent (verified against the installed `@nestjs/common` 10.4.22), not just when malformed — switched optional numeric query params to a small `parseOptionalInt()` helper (`backend/src/common/utils/parse-optional-int.ts`) instead, verified live against every affected endpoint (employees list/search, movements list, audit logs, email logs) with both present and absent params.
- **Puppeteer now reuses one pooled browser instance** (`backend/src/reports/report-generator.service.ts`) instead of launching a fresh headless Chromium per report — only a page is opened/closed per request now. Verified live: three consecutive report generations showed decreasing latency (2316ms → 1786ms → 1565ms), consistent with the launch cost being paid once.
- **Added a request timeout to the frontend API client** (`frontend/src/api/client.ts`) — every fetch now aborts after 20s via `AbortController` instead of a hung request leaving a "Sending…"/"Saving…" button stuck forever with no way out but reloading.

## 2026-09-09 (cont. 6) — Removed unused dependencies, deprecated tsconfig option

### Removed

- **`@nestjs/schedule`** (backend dependency) — never wired in anywhere: no `ScheduleModule` import, no `@Cron`/`@Interval`/`@Timeout` decorator anywhere in the codebase. Confirmed unused, removed.
- **`date-fns-tz`** (backend dependency) — the only place its name appeared was in a code comment describing it as a future option, never an actual import. Confirmed unused, removed. Updated the comment in `movements.service.ts`'s `dayRange()` and the matching note in `docs/roadmap.md` accordingly.
- **`baseUrl` in `backend/tsconfig.json`** — flagged by the editor as deprecated (removed in TypeScript 7.0). Nothing in the codebase uses path aliasing (no `paths` map exists), so it was dead configuration; removed rather than suppressed.

### Verified

- `npm install` from the repo root cleanly removed 7 transitive packages with the two dependencies gone.
- Full `npm run build` (backend + frontend) still succeeds with zero errors after all three removals.

## 2026-09-09 (cont. 5) — Stale-data sweep across code and docs; docs fully synced to current state

Checked the whole repo (code comments + all of `docs/` + root `README.md`) for stale references left behind by recent changes (npm workspaces conversion, CSV consolidation, the `clientRequestId`/RLS additions, the Employees pagination fix). Found and fixed real staleness, not just cosmetic:

### Fixed — real bugs in comments/docs, not just prose

- **`backend/scripts/import-employees.ts`'s usage comment pointed at a deleted file** (`data/employees-import.csv`, removed in the CSV-consolidation pass) — following it verbatim would fail. Corrected to `data/employees.csv`.
- **`docs/deployment.md`'s "Build & run" steps were broken by the npm-workspaces conversion** — `cd backend && npm ci` / `cd frontend && npm ci` can no longer work, since `backend/package-lock.json` and `frontend/package-lock.json` were deleted in favor of one root lockfile. Rewritten to install/build from the repo root, with `-w backend` for the workspace-specific deploy step.
- **`README.md`'s "Build" section still described two separate per-app build commands**, contradicting its own "Local Development" section above it (which correctly describes the single-root-command flow). Rewritten to match.
- **`docs/api-reference.md` had three real inaccuracies**, not just missing-new-feature gaps: `GET /employees/:id`'s documented permission (`MANAGE_EMPLOYEES`) doesn't match the code (`VIEW_EMPLOYEE_HISTORY`, changed in an earlier audit); `CreateEmployeeDto`'s `email` was documented as required when it's been optional since the email-optional rollout; `POST /movements`'s body was missing the `clientRequestId` field entirely. All three fixed, plus documented the new `GET /employees` search/pagination shape (`q` param, `{ rows, total }` response).

### Updated — docs that were accurate but had fallen behind recent work

- `docs/roadmap.md` — was still headed "Status as of 2026-09-04"; added everything shipped since (idempotency key, RLS, npm workspaces, full 205-employee roster + email-optional, the 2026-09-09 workflow audit's two fixes), updated the stale "6 employees imported" and "hypothetical large employee count" lines.
- `docs/decisions.md` — added three missing ADR entries for decisions already live in the code but never written down: movement idempotency key, Row Level Security (defense in depth), npm workspaces.
- `docs/architecture.md` — frontend page list was missing `Corrections.tsx` and `AuditLog.tsx` entirely; added those plus the idempotency-key and RLS bullets to "Key design decisions."
- `docs/security.md` — added the RLS bullet under Data protection.
- `docs/user-guide-admin.md` / `docs/user-guide-hr.md` — updated the Employees-screen instructions to reflect email now being optional and the new search/pagination UI (previously undocumented since it didn't exist until this session's earlier fix).

## 2026-09-09 (cont. 4) — Full workflow audit: leftover test data purged, Employees pagination gap fixed

Ran a complete pass over every user-facing workflow (Auth, Security movement recording, Dashboard, Employees, Users, Corrections, Audit Log, Settings, Reports/Email) across all three roles, both at the API level (25-check script) and via a full Puppeteer UI walkthrough of every screen. Two real issues found and fixed live; everything else passed.

### Fixed

- **`movement_records` and `email_logs` held leftover test data from earlier sessions' verification work** — all 4 movement records (dated 2026-09-03/09-04, one with the literal `correctionReason: "test"`) and both `email_logs` rows (FAILED, test sends) were artifacts, not real activity. Deleted via `deleteMany({})`. `audit_logs` was deliberately left untouched — it's a permanent record and none of its entries were fabricated data, just a true log of the test actions that were taken.
- **Employees admin screen (`/employees`) had no pagination or search** — `findAll()` returned a flat, silently-capped 50 results with no way to reach the rest. With the roster now at 205 real employees, 155 were completely unreachable through this screen (spec §53's "large employee databases" case). Fixed:
  - `backend/src/employees/employees.service.ts` — `findAll()` now takes `{ skip, take, q }`, searches name/code/email, and returns `{ rows, total }` via a parallel count query.
  - `backend/src/employees/employees.controller.ts` — passes the new `q` query param through.
  - `frontend/src/pages/Employees.tsx` — rewritten with a debounced search box, "Load More" pagination (same pattern as `AuditLog.tsx`), and an empty state.
  - Verified live: `GET /employees` → 50 of 205 with an accurate total; `GET /employees?q=Naik` → all 12 matches (uncapped, unlike the guard-facing 10-result autocomplete); confirmed visually in the browser for both the paginated list and the search.

### Verified, no changes needed

- Auth (login/logout/session, rate limiting), Security's search-and-record flow, Dashboard filters, Users/Corrections/Audit Log/Settings admin screens, RBAC 403s for Security/HR on admin-only routes, report PNG download, email-logs listing. Zero console/page errors across the full UI walkthrough.

### Tracked as "asks" (blocked on external input, not fixable from here)

- SMTP credentials for `security@adage-automation.com` (Microsoft 365 admin) — `docs/email-m365-admin-handoff.md`.
- Supabase Storage bucket + S3-compatible keys for persisting emailed reports.
- 54 employees still missing an email address in `backend/data/employees.csv`.

All three already tracked in `docs/roadmap.md`'s "Blocked — waiting on external input" section; restated here as the outcome of this audit.

## 2026-09-09 (cont. 3) — Data file consolidation, casing regression fix, directory cleanup

### Fixed

- **Real data-quality regression found while checking a doc question**: importing the full 205-person roster (`backend/data/employees-roster-2026-09-09.csv`) had silently overwritten the 6 originally-imported employees' nicely title-cased names with the source data's ALL-CAPS formatting (e.g. "Shivani R Naik" → "SHIVANI R NAIK") — and left all 199 other employees in ALL CAPS too, since the import script never normalized casing. Every screen in the app displays `employeeName` directly (Security search, Dashboard, reports, emails), so this was a real, visible regression. Fixed `backend/scripts/import-employees.ts` to title-case names on import going forward, then re-ran the import to fix all 205 existing records. Verified live: zero employees remain in ALL CAPS.

### Changed — data file consolidation

- **`backend/data/employees-import.csv` (the original 6-employee batch) deleted** — confirmed first that all 6 of its employees, with matching emails, already existed in the larger roster file (just checked, didn't assume), so it was fully redundant.
- **`backend/data/employees-roster-2026-09-09.csv` renamed to `backend/data/employees.csv`** — one stable, living filename for the current roster instead of a dated snapshot name, so future updates overwrite this one file in place rather than accumulating a new dated CSV (and the same redundancy) every time.
- **Removed the duplicate `Adage_Logo.png` at the repo root** — this was the original file as first shared, since copied into the two places the app actually uses it (`frontend/public/logo.png` for the browser, `backend/src/reports/assets/adage-logo.png` embedded into generated reports). Those two *are* necessarily separate — they ship inside two independently-built/deployed apps — but the root copy served no purpose once both were in place and was just a stale-copy risk.
- Checked the full repo tree for other redundancy (temp/debug files, doc overlap) — found none beyond the above; the doc consolidation pass from earlier today already covered the docs folder.
- Updated `docs/branding-and-data-needed.md`'s employee-data section to reflect reality (205 imported, not "still needed"; the real remaining gap is 54 employees' missing email addresses, not the roster itself).

## 2026-09-09 (cont. 2) — Converted to npm workspaces for true single-command portability

### Changed

- **Root `package.json` converted to npm workspaces** (`"workspaces": ["backend", "frontend"]`), replacing the earlier `--prefix`-based approach. On any machine, `npm install` once at the repo root installs backend + frontend + root dependencies together (npm hoists shared packages into one root `node_modules`) — no separate `cd backend && npm install` / `cd frontend && npm install` steps needed anymore.
- **`backend/package.json` gained a `postinstall: "prisma generate"` hook** — the Prisma client is now generated automatically as part of that single `npm install`, rather than requiring a manual `npx prisma generate` afterward.
- Added root scripts: `build` (backend then frontend), `seed`, `prisma:migrate` — so common tasks also don't require `cd`-ing into a workspace.
- Removed `backend/package-lock.json` and `frontend/package-lock.json` in favor of one root `package-lock.json` (npm workspaces requires a single lockfile).
- Updated `README.md` and `docs/developer-guide.md`'s setup/day-to-day/build instructions to the new one-command flow. Deployment-specific instructions (`docs/deployment.md`) intentionally left as separate backend/frontend steps, since production deploys them to different hosts.

### Verified

- Full clean-slate test: deleted all `node_modules` (root, backend, frontend) and all lockfiles, ran `npm install` once from the root, confirmed the Prisma client was generated automatically with no manual step, confirmed `npm run build` (root) built both apps with a complete `backend/dist` (including the logo asset at the correct path) and a complete `frontend/dist`, and confirmed `npm run dev` (root) brought up both the backend (`:4000`, `/api/auth/me` → 401 as expected) and frontend (`:5173`) together from a single command. This is the same flow anyone cloning the repo fresh on a different machine would run.

## 2026-09-09 (cont.) — Combined dev script, closed out email-optional rollout

### Added

- **Root `package.json` with `npm run dev`** — runs backend and frontend together from one command (`concurrently`), instead of two separate terminals. `npm run dev:backend`/`npm run dev:frontend` remain available individually. Verified live: both `http://localhost:5173` and `http://localhost:4000/api` come up from the single command.

### Completed (picked up in-progress work)

- Verified the employee-email-optional change (schema `Employee.email` now `String?`, migration `20260909123000_allow_employee_email_null`, backend DTOs, frontend `types.ts`) was already fully applied to the live database — not just partially done.
- Verified the ~205-employee real roster (`backend/data/employees-roster-2026-09-09.csv`) was already successfully imported (54 of them intentionally with no email yet) via `backend/scripts/import-employees.ts`, which now accepts a blank email per row.
- **Found and fixed a real gap this left behind**: the "Add Employee" form and "EMAIL DETAILS" button hadn't been updated to match — the form still marked email `required` (and would have sent `""` rather than omitting the field, which `@IsEmail()` rejects even though `@IsOptional()` is set), and "EMAIL DETAILS" had no check for a missing email before rendering, meaning clicking it for any of the 54 no-email employees would round-trip to the server just to get a 400. Fixed: email field is now optional in the form (blank omitted from the payload rather than sent empty), the employee table shows "—" for a missing email, and "EMAIL DETAILS" only renders when an email is actually on file, with a clear inline note when it isn't ("No email on file for X — add one via Employees before details can be sent.").
- Confirmed the earlier RLS migration, idempotency-key migration, and this session's clean backend rebuild are all still intact and the database is fully in sync (`prisma migrate status` → up to date, 4 migrations applied).

## 2026-09-09 — Second audit pass, idempotency fix, RLS hardening, docs consolidation

### Fixed (from a second audit pass — new SMTP/storage code + fresh spec-completeness check)

- **`requireTLS: true` added to the SMTP transport** (`email.service.ts`) — without it, nodemailer's default "opportunistic STARTTLS" silently falls back to plaintext if the server doesn't advertise STARTTLS, sending the SMTP password and employee PII unencrypted with no error.
- **"Report Downloaded" is now audit-logged** (`reports.controller.ts`, both `image` and `pdf` handlers) — spec §21 requires this action be audited; only email sends were logged before.
- **`getSignedDownloadUrl` wired into a real endpoint** (`GET /reports/email-logs/:id/download`) — this method existed but was never called from anywhere, undercutting the documented promise that a previously-emailed report "can be resolved by re-serving the exact file."
- **Duplicate-record risk on ambiguous network failure, closed with a proper idempotency key.** New finding: if a movement request is sent, the server commits it, but the response is lost before the client reads it, the client's retry (including the offline queue's auto-confirm-on-sync path added in the 2026-09-04 audit) would create a second, genuinely duplicate ENTRY/EXIT with no guard awareness. Fixed with a `clientRequestId` (new `movement_records.client_request_id`, unique, migration `20260909113728`) generated once per guard tap and reused across every retry of that same tap (confirm-resubmit, offline enqueue, sync retry). `MovementsService.createMovement` now checks it first and returns the existing record on replay instead of creating a duplicate; also handles the race where two near-simultaneous retries both pass the check before either commits (catches the resulting unique-constraint violation and treats it the same as a normal replay). Verified live: submitting the same `clientRequestId` twice returns the same record id both times, and exactly one row exists in the database afterward.
- **A lightweight global exception filter added** (`backend/src/common/filters/all-exceptions.filter.ts`, registered in `main.ts`) — spec §62 asks for backend error logging across DB/auth/report-generation/unexpected failures; previously only two services (`email`, `reports`) had any logging at all. Every uncaught exception is now logged with method/path/status/userId, at `error` level for 5xx and `warn` for 4xx, without ever leaking a raw stack trace to the client.
- **Fixed a broken production build**: `scripts/import-employees.ts` (used only for `npm run import:employees` via `ts-node`, not meant to ship) wasn't excluded from `tsconfig.build.json`, and being outside `src/` shifted TypeScript's inferred `rootDir`, nesting all compiled output under an extra `dist/src/` — which broke the report-download feature at runtime (`ENOENT` looking for the logo asset at the old expected path). Fixed by excluding `scripts/**/*` and setting `rootDir: "./src"` explicitly. **Note**: after this fix, `nest build` became intermittently unreliable in this environment — sometimes emitting only a partial `dist/` with no error output, reproduced identically in both Git Bash and PowerShell. Root cause not conclusively identified (suspected antivirus/OneDrive file-lock interference on Windows); a clean retry (`rm -rf dist tsconfig.tsbuildinfo` then rebuild) has succeeded every time so far. Documented in `docs/developer-guide.md`'s troubleshooting table.

### Security — Row Level Security enabled on all 11 Supabase tables

- User-supplied screenshot of Supabase's Security Advisor showed 11 errors: every `public`-schema table had RLS disabled. Supabase auto-exposes every such table through its own REST/GraphQL API (PostgREST) regardless of this app's own auth — anyone holding the project's `anon`/`service` key could potentially read or write `users`, `employees`, `movement_records`, etc. directly, completely bypassing the NestJS backend.
- Verified this app's own access is unaffected before fixing: confirmed via a direct query that Prisma connects as the `postgres` role, which owns every table (`current_user = tableowner = 'postgres'`) — Postgres exempts table owners from RLS by default, so enabling it blocks only *other* roles (exactly Supabase's PostgREST anon/authenticated roles, which this app never uses).
- Migration `20260909120000_enable_row_level_security` enables RLS with no policies (default-deny for any non-owner role) on all 9 Prisma-modeled tables plus `session` (created at runtime by `connect-pg-simple`) and `_prisma_migrations` (Prisma's own tracking table) — both live in `public` and were flagged by the same scan. Verified live afterward: `relrowsecurity: true` on all 11 tables, and a normal Prisma query (`employee.count()`) still succeeds.

### Documentation

- **Consolidated `docs/running-locally.md` into `docs/developer-guide.md`**, per user request to reduce duplicated content across docs — the two had near-identical start-server commands and the same seeded-login table. `developer-guide.md` now has both the first-time setup and a "day-to-day: starting the servers again" section with the merged troubleshooting table; `running-locally.md` deleted, its one inbound link (`docs/README.md`) removed. Checked other likely-duplicate candidates (the two email docs, Supabase setup instructions, the three role-based user guides) and found they already cross-link rather than repeat content — left as-is.

## 2026-09-07 — Switched email sending from Resend to SMTP (Microsoft 365)

### Changed

- **Email provider switched from Resend to SMTP**, per user request to avoid dependency on any vendor's free tier that could change terms and silently break email sending. Checked `adage-automation.com`'s public MX records directly — confirmed the domain already runs on **Microsoft 365** — so instead of picking a new third-party vendor, email now sends through Adage's existing (already-paid-for) mailbox infrastructure via SMTP. This was also compared against Amazon SES (the other rug-pull-resistant option, since SES never had a free tier to begin with) — SMTP won on setup simplicity given the tenant already exists.
- `backend/src/email/email.service.ts` rewritten to use `nodemailer` over SMTP (`smtp.office365.com:587`, STARTTLS) instead of the Resend SDK. Kept the same lazy-client-construction pattern as before (a missing/invalid config only fails the send call, never crashes the app at boot) and the same on-demand-only invocation contract (still only ever called from `POST /reports/email`).
- `backend/package.json` — removed `resend`, added `nodemailer` + `@types/nodemailer`.
- `backend/.env` / `.env.example` — `EMAIL_API_KEY` replaced with `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`; `EMAIL_FROM`/`SECURITY_EMAIL` updated from the placeholder `@adage.com` domain to the real `@adage-automation.com` domain (matching the 6 real employee emails already in the database). Updated the live `SECURITY_EMAIL` setting row in Supabase to match, and the same default in `seed.ts` for future fresh databases.
- `docs/email-provider-options.md` updated with a "Decided" banner at the top and the rug-pull-resistance reasoning that led to SMTP over Resend/SendGrid/SES.
- New `docs/email-m365-admin-handoff.md` — exact, ready-to-send instructions for whoever administers Microsoft 365 for `adage-automation.com`: confirm/create the `security@` mailbox, enable Authenticated SMTP for it specifically (tenant-wide legacy SMTP AUTH has been off by default since 2022), handle MFA via an app password, and send back the mailbox address + password.
- Every other doc referencing Resend/`EMAIL_API_KEY` swept and updated to reflect SMTP: root `README.md`, `docs/README.md`, `docs/architecture.md`, `docs/database-schema.md`, `docs/api-reference.md`, `docs/developer-guide.md`, `docs/deployment.md`, `docs/branding-and-data-needed.md`. `docs/roadmap.md` restructured with a new "Blocked — waiting on external input" section covering both this and the still-pending Supabase Storage credentials, since both are code-complete but unverifiable until real credentials arrive.

### Status

Code-complete, backend builds clean. **Not yet verified against a real send** — `SMTP_PASS` is still blank pending the Microsoft 365 admin handoff. This is the same "code ready, blocked on external input" pattern used earlier for Supabase (see 2026-09-03 entries) — once credentials arrive, the only remaining step is filling in `.env` and sending one real test email.

## 2026-09-04 — Full audit pass: 3 blocking bugs, 8 real gaps fixed

A full three-part audit (backend, frontend, docs) was run over the entire codebase as it stood after several days of feature work, at the user's request ("do a proper audit of everything we have done"). All findings were independently verified against actual current file contents before being trusted, and every fix below was confirmed live against the running app afterward (not just "should work").

### Fixed — blocking

- **Login rate limiting was completely non-functional.** `@Throttle({...})` on `AuthController.login` only sets metadata — without `ThrottlerGuard` actually registered, it enforced nothing, despite a code comment and `docs/security.md` both claiming otherwise. Fixed by adding `{ provide: APP_GUARD, useClass: ThrottlerGuard }` to `app.module.ts`. Verified live: the 6th rapid bad-login attempt now returns `429`, the first 5 return `401`.
- **`GET /employees/:id` required `MANAGE_EMPLOYEES`, which Security doesn't hold — silently broke the Employee Details page (and therefore EMAIL DETAILS) for the Security role.** The Dashboard's "View Employee Day" link is reachable by Security (gated only on `VIEW_EMPLOYEE_HISTORY`), but the employee-header fetch it depends on was 403ing and being swallowed by a `.catch(() => setEmployee(null))` — no visible error, just a blank card and a missing EMAIL DETAILS button. Fixed: `employees.controller.ts`'s `findOne` now requires `VIEW_EMPLOYEE_HISTORY` instead. Verified live: Security's session now gets `200` on `GET /employees/:id` (was `403`).
- **A failed Resend email send was recorded as `SENT` and reported "✓ Details emailed successfully" — with no email actually delivered.** Resend's SDK resolves to `{ data, error }` for API-level failures (unverified domain, invalid recipient, account issues) rather than throwing; only transport failures reject the promise. The code only had a try/catch, never checked `result.error`. Fixed in `email.service.ts` to throw when `result.error` is present, so `ReportsService`'s existing failure-handling path (mark `email_logs` `FAILED`, audit-log `EMAIL_FAILED`) actually triggers. Directly contradicted the project's own stated principle ("never falsely report success").

### Fixed — real gaps

- **`trust proxy` was never configured** (`main.ts`) — `req.ip` returns the reverse proxy's own address on every suggested deploy target (Railway/Render/Fly.io), breaking audit-log IP capture and, worse, meaning the now-working rate limiter would key every user off the same proxy IP in production — one bad actor locking out everyone. Fixed: `app.getHttpAdapter().getInstance().set('trust proxy', 1)`.
- **`CorrectMovementDto.correctionReason` accepted an empty string** — only `@IsString()`, no `@IsNotEmpty()` — silently defeating the "reason is required, kept in audit log" design goal for anyone bypassing the frontend. Fixed. Verified live: `correctionReason: ""` now returns `400`.
- **`CorrectMovementDto.movementAt` accepted any string**, not just a valid date — an invalid value reached `new Date(...)` unchanged, producing `Invalid Date` and an uncaught Prisma error (raw 500) with no exception filter to catch it. Fixed with `@IsISO8601()`. Verified live: `movementAt: "not-a-date"` now returns `400`.
- **`correctMovement`/`addMissingRecord` never verified the target employee exists** (unlike `createMovement`, which does) — a stale/invalid `employeeId` threw an unhandled FK-violation error (raw 500) instead of a clean 404. Fixed with the same existence check `createMovement` already had. Verified live: a nonexistent employee ID now returns `404`.
- **A report-generation failure during "Email Details" left zero trace** — the PNG was generated *before* the `email_logs` row was created, so a Puppeteer crash/timeout threw before any row existed, directly undermining `email_logs`' documented purpose ("lets administrators know whether a requested record was successfully emailed"). Fixed by creating the `PENDING` row first, then generating the PNG inside the existing try/catch.
- **Latent AND-vs-OR bug**: `MovementsController.create` declared `@RequirePermissions('RECORD_ENTRY', 'RECORD_EXIT')` for the one endpoint handling both movement types — `PermissionsGuard` ANDs multiple required permissions, so this silently demanded a guard hold *both* to record *either* one. Harmless today (every role with one has both) but would have silently broken a future entry-only/exit-only role split — exactly the scenario the permission system exists to make cheap. Fixed: permission is now checked per `dto.movementType` inside the handler. Verified live: HR recording an EXIT still works correctly under the new check.
- **Offline movement queue could get permanently stuck with no way to resolve it.** A movement queued while offline is never actually confirmed against the duplicate-check (impossible without a server round trip) — `syncPending()` only removed an item from the queue when the server returned `created: true`, but never handled the `requiresConfirmation: true` response shape at all. A genuinely duplicate offline tap (e.g. guard taps ENTRY twice while offline) would sync, get rejected pending confirmation, and then sit in the queue forever with `pendingCount > 0` and no UI anywhere to inspect or resolve it. Fixed: on `requiresConfirmation`, `syncPending` now retries once with `confirmed: true` — the guard's original offline tap is the only signal of intent available during a background sync, so it's treated as confirmation. Also fixed a misleading code comment claiming offline items were "already confirmed by guard before queueing" (they weren't — `confirmed` always defaulted to `false` on the primary offline path).
- **Dashboard/Corrections/EmployeeDetails default dates used UTC, not local time** — `new Date().toISOString().slice(0, 10)` takes the UTC calendar date, which is *yesterday's* date for the first ~5.5 hours of every single day in Asia/Kolkata (the system's stated timezone authority). Silently wrong exactly when a night-shift handover might be checking "today's" records. Fixed with a new shared `frontend/src/utils/date.ts` (`todayIso`/`isoDaysAgo`) using the browser's local date instead, replacing three separate ad hoc UTC-based implementations.
- **Validation error arrays rendered as unreadable mashed text.** Nest's `ValidationPipe` returns `message` as `string[]` on a 400; every frontend catch block did `err?.message ?? 'fallback'` assuming a string, so a validation failure would render as e.g. `"email must be an emailusername should not be empty"` with no separators. Fixed in `frontend/src/api/client.ts` — array messages are now joined with `, `.
- **No confirmation before an Admin disables their own account** — a possible unrecoverable lockout (if they're the only enabled Admin) with zero warning, client or server side. Fixed with a `window.confirm` warning in `Users.tsx` when the target of a "disable" action is the currently logged-in user. Also added missing try/catch around both `Employees.tsx` and `Users.tsx`'s `toggleActive` — a failed activate/deactivate/enable/disable previously failed completely silently.

### Deliberately not fixed this session (tracked in `docs/roadmap.md` instead)

Puppeteer launching a fresh browser per report (scale concern, not urgent at today's volume); offline+app-restart-mid-outage lockout (needs an architectural decision, not a quick fix); accessibility gaps (no focus trap/Escape on modals); loading-vs-empty-state flash on first render; no request timeout on frontend fetches; `SettingsController` accepting arbitrary keys; unvalidated numeric route params elsewhere falling through to raw 500s (same class of bug as the DTO fixes above, just via route params).

### Documentation fixes (from the docs-consistency audit)

- `docs/database-schema.md` was **factually wrong** — still claimed `role_permissions` grants every permission to every role, directly contradicting the RBAC narrowing from earlier the same day. Fixed, now describes the actual current mapping.
- `docs/roadmap.md` had completed items (CSV import, Corrections UI, Audit Log UI, branding) filed under a `## Not started — features` heading, and a "Suggested next step" telling the reader to go build screens that were already done four lines above. Restructured the whole file.
- `docs/roadmap.md`'s seed-script description was stale (still described creating sample employees/movements, which stopped happening once real employee data existed).
- `docs/user-guide-admin.md` claimed Employees was Admin-only (HR has it too) and omitted Audit Log from its own screen list; also described Department/Designation form fields that were removed from the UI.
- `docs/testing.md` still had a stale "even though v1 grants everything by default" aside.
- Five broken internal markdown anchor links across `docs/database-schema.md`, `docs/security.md`, and `docs/decisions.md` (mismatched heading slugs, and one link to a heading that never existed) — fixed, including simplifying one overly-long heading in `docs/architecture.md` at the source rather than just working around its ugly auto-generated slug.

## 2026-09-04 — Role-based access (RBAC narrowed from v1-flat)

### Changed

- Replaced the original "every role gets every permission" v1 default with a differentiated mapping, per explicit user request: **SECURITY** = record-movement workflow + Dashboard only (no Employees/Users/Corrections/Audit Log/Settings). **HR** = same as Security, plus Employees. **ADMIN** = unchanged, everything. See [docs/decisions.md](./docs/decisions.md#rbac-narrowed-from-v1-flat-2026-09-04) for the full mapping and rationale, including why `RECORD_ENTRY`/`RECORD_EXIT`/`VIEW_EMPLOYEE_HISTORY`/`SEND_EMAIL` stayed on all three roles.
- `backend/src/common/constants/permissions.ts` — `DEFAULT_ROLE_PERMISSIONS` updated to the new mapping (affects `npm run seed` on a fresh database going forward).
- **Live database reconciled directly** — `seed.ts`'s `upsert` with `update: {}` never removes existing grants, so a one-off script deleted the now-revoked `role_permissions` rows (4 for Security: `MANAGE_EMPLOYEES`/`MANAGE_USERS`/`MANAGE_SETTINGS`/`CORRECT_RECORDS`; 3 for HR: `MANAGE_USERS`/`MANAGE_SETTINGS`/`CORRECT_RECORDS`) rather than relying on re-seeding.
- `frontend/src/components/AdminNav.tsx` — each link now conditionally renders based on `useAuth().hasPermission(...)`, so Security sees only "Record Movement" + "Dashboard", HR additionally sees "Employees", and only Admin sees the rest.
- `frontend/src/components/ProtectedRoute.tsx` — gained an optional `permission` prop; redirects to `/` if the logged-in user lacks it. Explicitly documented as a UX convenience, not the security boundary — `PermissionsGuard` on the backend is the real enforcement regardless of what this component does.
- `frontend/src/App.tsx` — every admin route (`/employees`, `/users`, `/corrections`, `/audit-log`, `/settings`) now passes the matching `permission` to `ProtectedRoute`; `/dashboard` and `/employee-details` gated too, for defense in depth (all three roles currently hold those permissions, so this doesn't change behavior today).

### Verified

- Backend: confirmed directly via API calls (not just trusting the UI) — Security's session gets `403` on `GET /users` and `GET /employees`, `200` on `GET /dashboard/summary`; HR's session gets `200` on `GET /employees`.
- Frontend: screenshotted the nav bar for all three roles (Security shows 2 links, HR shows 3, Admin shows all 7) and confirmed a direct URL navigation to `/users` as Security or HR redirects to `/` while Admin reaches it — proving the route guard, not just the hidden nav link, is doing the real work.

## 2026-09-04 — Record Correction and Audit Log screens

### Added

- **`frontend/src/pages/Corrections.tsx`** — the first UI for the previously API-only correction endpoints. Search an employee (including inactive ones, via `/employees/search-all`, per spec §39/§42), pick a date, see that day's movements, and either "Correct" an existing record or "Add Missing Record" via a modal (movement type, time, and a required reason — enforced client-side, stored in the audit log). Confirmed the append-only correction model still holds: a corrected record disappears from the list (superseded) and the new corrected row takes its place.
- **`frontend/src/pages/AuditLog.tsx`** — a read-only viewer for `GET /audit-logs`, with Entity Type and Performed By filters and a "Load More" pager. Action names are color-coded (green for creates/logins, amber for corrections/deactivations, red for failures).
- **`frontend/src/components/AdminNav.tsx`** — a shared nav-links block (Record Movement, Dashboard, Employees, Users, Corrections, Audit Log, Settings), replacing six near-duplicate copies of the same links across Dashboard/Employees/Users/Settings/Corrections/AuditLog.
- Backend: `MovementsService.summaryForDate` now returns `currentlyInside` (last-recorded ENTRY-without-EXIT for the selected date). `GET /audit-logs` now accepts `skip`/`take` for pagination and includes the acting user's name in the response (`AuditLogService.list` now `include`s the `user` relation — previously omitted).
- Three new icons (`IconEdit`, `IconPlus`, `IconHistory`) plus `IconDoorOpen`/`IconX` from the dashboard work.

### Fixed

- Dashboard filter inputs (Date/Employee/Movement) were rendering unstyled — spotted from a user screenshot, root-caused to those inputs never being wrapped in the shared `.field` class. Fixed, plus added a new "Currently Inside" 4th summary card and Today/Yesterday quick-date buttons.

### Verified

- Full live walkthrough via Puppeteer against the running app: logged in as Admin, searched for and selected an employee (including the inactive-employee search path), added a missing record through the modal, confirmed the success banner and updated record list, then checked the Audit Log page showed the resulting `MISSING_RECORD_ADDED` entry attributed to the correct user. The test movement record created during this walkthrough was deleted afterward so it doesn't pollute the real employee data now in the database.

## 2026-09-03 — Dashboard redesign + fixed unstyled filters bug

### Fixed

- **Dashboard's Date/Employee/Movement filter inputs were rendering as bare, unstyled native browser controls** (no border, padding, or focus ring) — spotted from a user screenshot. Root cause: those inputs were never wrapped in the `.field` class every other input in the app uses. Fixed by wrapping them properly and adding a `.filters-bar .field { margin-bottom: 0 }` override so the fix doesn't add unwanted vertical spacing in the horizontal filter bar.

### Added

- **"Currently Inside" summary card** on the Dashboard — a 4th stat alongside Total Employees/Entries/Exits, computed as employees whose most recent movement on the selected date was an ENTRY (i.e. not yet recorded leaving). Backend: `MovementsService.summaryForDate` now returns `currentlyInside`. For a past date this reads as "not exited by end of that day" rather than a live count — labeled accordingly in the UI.
- **Quick date buttons** ("Today" / "Yesterday") next to the date picker, highlighting whichever is currently selected.
- **Employee filter chip** — once an employee is selected in the Dashboard filter, it now renders as a filled chip with an inline "×" to clear, instead of the previous plain "✕ Clear ..." text link below the input.
- Two new icons: `IconDoorOpen` (currently-inside card), `IconX` (chip clear button).

### Verified

- Visually confirmed via Puppeteer screenshots against the live app: filters now show proper borders/focus states, the 4-card grid renders correctly at desktop width, quick-date buttons toggle active state, and the employee chip + "View Employee Day" link work together without layout overlap (an intermediate version had the date field and quick buttons overflowing into the employee column at 1300px width — fixed by giving the date field a larger flex-basis and letting the quick-date buttons wrap).

## 2026-09-03 — Test data cleanup, dropped department/designation

### Removed

- **Permanently deleted** the 4 fake seeded test employees (Rahul Sharma, Rahul Patil, Amit Patil, Priya Nair) and their dependent rows (6 movement records, 1 email log), per user request — a deliberate one-off exception to the app's normal soft-delete-only rule for employees, justified because these were seed/test data, not real former staff. Verified no employees remain with those codes; the 6 real employees are unaffected.
- `department` and `designation` fields removed from the "Add Employee" form (`frontend/src/pages/Employees.tsx`) and from the employee list table — confirmed via code search they weren't referenced anywhere in search, filtering, or report generation, so they were pure unused metadata. The employee schema and CSV import format were simplified accordingly to `employee_code,employee_name,email`.
- Renamed the seeded dev "security" login account from "Rahul Sharma" to "Security User" (and its DB row updated to match) — it previously borrowed the name of a fake test employee, which was confusing now that that employee no longer exists.

### Changed

- `backend/prisma/seed.ts` no longer creates sample employees or sample movement records — only roles/permissions/settings/dev-user accounts, which are still needed for login. This prevents a future `npm run seed` re-run from silently recreating the just-deleted test data now that the database holds real employee records.

## 2026-09-03 — First real employee data

### Added

- `backend/scripts/import-employees.ts` — reusable CSV employee import (spec §41), run via `npm run import:employees -- <path-to-csv>`. Validates every row (required fields, email format, duplicate employee codes) before writing anything; upserts by employee code so re-running a corrected file is safe. This was a planned-but-not-built roadmap item, built now instead of as a one-off script since more employee batches are expected.
- `backend/data/employees-import.csv` — the source file for the first real import.
- Imported the first 6 real employees, provided by the user: Shivani R Naik (55668), Bala Dattaprasad Patwardhan (55778), Pranav P Naik (55714), Raj Ramanand Fal Dessai (55715), Sai Sanjay Kunkalienkar (55777), Adarsh Bhaskaran Chanabhat (55602). Department and designation were not tracked in the current employee schema.

### Changed

- Deactivated the 4 fake seeded test employees (Rahul Sharma, Rahul Patil, Amit Patil, Priya Nair) — `isActive: false`, per user request. Their test movement history is preserved (soft delete, matches the app's design) but they no longer appear in the guard's search. Verified via a live API call that search now returns only the real employees.

## 2026-09-03 — Deeper design pass

### Added

- `frontend/src/components/icons.tsx` — a small inline SVG icon set (search, entry/exit, dashboard grid, mail, check/alert/clock/x circles, users, settings gear, calendar, chevron, inbox, wifi-off, arrow-left, log-out) so the UI stops relying on emoji/text-only affordances, with no external icon library dependency.
- Empty states (icon + title + hint) for: no employee selected yet on the Security screen, no search matches, no dashboard records, no movement records for an employee/date.
- Micro-interactions: fade/slide-in animations on page load, status banners, search results, and modals; a pop-in animation on the selected-employee card and login card; hover-lift on summary cards; a reusable spinner (light and dark variants) replacing plain "…" loading text.
- `.status-pill` (Active/Inactive, Active/Disabled with a dot indicator) and `.table-action-btn` / `.section-card` patterns, applied consistently across Employees, Users, and Settings admin screens — replacing ad hoc plain-text status and unstyled buttons.
- Avatar-initial circles in the employee search results dropdown (both the Security screen and the Dashboard's employee filter), and on the Employee Details page.

### Changed

- Every icon-bearing element (ENTRY/EXIT buttons, nav links, dashboard button, status banners, summary cards, action-row buttons) now pairs an icon with its label instead of text alone.
- Visually verified in a real headless browser (Puppeteer, since `chromium-cli` wasn't available in this environment) against the live app: login page, Security home (empty state, search results, selected-employee state), and Dashboard — screenshots reviewed and sent to the user, no console errors beyond the expected pre-login 401.

## 2026-09-03 — Real logo, removed download buttons

### Added

- Wired in the real Adage logo (`Adage_Logo.png`, supplied by the user) throughout the app:
  - Sampled the exact brand teal directly from the logo file: `#0d828b` (previous placeholder `#0f766e` replaced everywhere — CSS variables, PWA theme color/manifest).
  - Header and Login screen now render the actual logo image (`frontend/public/logo.png`) instead of the placeholder text-based "A" badge; header renders it in white via a CSS mask since it sits on a dark teal background.
  - Generated real square PWA icons (`icon-192.png`, `icon-512.png`) from the logo, replacing the 1×1 placeholder PNGs.
  - Embedded the logo (as a base64 data URI, read from `backend/src/reports/assets/adage-logo.png`) into the emailed/downloaded PNG/PDF report template, replacing the plain "ADAGE" text header. Added an `assets` copy rule to `nest-cli.json` so the image ships correctly in production builds (`dist/reports/assets/`).

### Removed

- The "DOWNLOAD IMAGE" and "DOWNLOAD PDF" buttons on the Employee Details screen, per user request — only "EMAIL DETAILS" remains on that screen. The underlying `GET /reports/image` / `GET /reports/pdf` API endpoints are untouched and still work (report generation is also used internally for the email attachment) — they're just no longer exposed as buttons in the UI. Documented as API-only in `docs/api-reference.md`.

### Fixed

- **Report PNG/PDF downloads were silently corrupted** — Puppeteer's `page.screenshot()`/`page.pdf()` return a `Uint8Array`, not a true Node `Buffer`; Express's `res.send()` only sends raw binary when `Buffer.isBuffer()` is true, and silently JSON-serializes anything else. The result: `GET /reports/image`/`GET /reports/pdf` were returning a JSON object of numeric byte-index keys instead of an actual image/PDF (verified — the PNG magic bytes were present but wrapped in `{"0":137,"1":80,...}`). Fixed by explicitly wrapping both results in `Buffer.from(...)` in `ReportGeneratorService`. Confirmed fixed by downloading and viewing a real report end-to-end against the live database — correct layout, correct logo, correct data.
- The lazy-loaded report logo (added this session, see above) also crashed the app once during this fix, for the same reason as the `EmailService` boot-crash bug from earlier today — caught during testing, not shipped.

### Documentation

- `docs/email-provider-options.md` — comparison of Resend (current default), SendGrid, Amazon SES, and SMTP for the on-demand email feature, with a recommendation to stick with Resend unless Adage has an existing AWS/vendor preference.
- Updated `docs/branding-and-data-needed.md` to reflect the logo/brand-color items as resolved.

## 2026-09-03 — UI redesign (teal branding placeholder)

### Added

- Full CSS design-system rework in `frontend/src/styles/global.css`: teal color palette (`--brand: #0f766e`, `--brand-light: #14b8a6`) as a placeholder for the real Adage brand teal, Inter typeface (Google Fonts), consistent shadow/radius scale, gradient buttons, sticky header, hover/active states throughout, and a reusable `.logo-mark` teal badge component used in both the header and login screen in place of plain text.
- `docs/branding-and-data-needed.md` — the definitive list of what only Adage can supply: real logo files, exact brand hex, real employee/user data, email-sending domain, storage bucket, and deployment domain.
- Employee avatar initials on the SecurityHome selected-employee card.

### Note

- The teal used (`#0f766e`) is a reasonable placeholder, not Adage's confirmed brand color — swap it once supplied (see `docs/branding-and-data-needed.md`).

## 2026-09-03 — First live database run

### Added

- Provisioned the Supabase project, applied the first real migration (`prisma migrate dev --name init`) against it, and ran the seed script — the schema is now live in Mumbai (ap-south-1), no longer just syntax-validated.
- Manually verified the full core workflow against the live database: login establishes a real session, `/employees/search` returns live data, `POST /movements` records real rows, the confirm-before-save duplicate-warning flow (§43) behaves correctly end to end (blocks the duplicate, then accepts it once confirmed), `/dashboard/summary` reflects the recorded movements, and `/audit-logs` shows the corresponding entries.
- Learned that Supabase's direct connection host (`db.<ref>.supabase.co:5432`) resolves IPv6-only; on networks without IPv6 this is unreachable. Fix: use the session-mode pooler connection (`aws-0-<region>.pooler.supabase.com:5432`, username `postgres.<project-ref>`) instead — documented in `docs/deployment.md`.

### Fixed

- **`EmailService` crashed the entire backend at boot** if `EMAIL_API_KEY` wasn't set, because the Resend client threw synchronously in the constructor — meaning the whole app (auth, movements, dashboard, everything) was unusable without email configured. Fixed by constructing the client lazily, only when an email is actually sent; the app now boots fine with email unconfigured and only errors (into `email_logs.errorMessage`, not a crash) if something tries to actually send.
- **`AuditLogModule` wasn't global**, so `EmployeesModule`, `MovementsModule`, `UsersModule`, and `SettingsModule` failed to resolve their `AuditLogService` dependency at boot (Nest dependency-injection error). Fixed by marking `AuditLogModule` `@Global()`, consistent with `PrismaModule` — appropriate since nearly every module writes to the audit trail.
- **Login appeared to succeed (200 OK, user returned) but never actually established a session** — no `Set-Cookie` header was ever sent, so every subsequent request was treated as unauthenticated. Root cause: `@nestjs/passport`'s `AuthGuard` validates credentials but does not call `req.logIn()` on its own; this has to be done explicitly. Fixed by overriding `LocalAuthGuard.canActivate` to call `super.logIn(request)` after the base guard succeeds — a well-known but easy-to-miss NestJS + Passport + session gotcha.


All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/), dated by day rather than by release version since there is no released version yet.

## 2026-09-03 — Database provider decision

### Decided

- Database provider: **Supabase Postgres, Mumbai (ap-south-1) region** — chosen over Neon (no Mumbai region), Railway (US/EU only), and AWS RDS (more ops overhead, only preferable if Adage is already AWS-standardized). See [docs/decisions.md](./docs/decisions.md#database-provider-supabase-mumbai) for full rationale.
- Supabase Storage (bundled, S3-compatible) is the recommended target for the `STORAGE_*` env vars used to persist emailed reports, in place of a separately provisioned AWS S3/Cloudflare R2 bucket — no code changes required, `StorageService` already speaks the generic S3 API.

### Updated

- `README.md`, `docs/deployment.md`, `docs/developer-guide.md`, `backend/.env.example` — all now point at Supabase specifically instead of listing Postgres/storage providers generically.

## 2026-09-03 — Initial scaffold

### Added

- Monorepo structure: `backend` (NestJS + Prisma), `frontend` (React + Vite + PWA), `docs`.
- **Database**: Prisma schema for `roles`, `permissions`, `role_permissions`, `users`, `employees`, `movement_records` (event-log model with append-only correction chain), `email_logs` (with persisted-report tracking), `audit_logs`, `settings`. Dev seed script creating 3 users (ADMIN/HR/SECURITY), sample employees, and sample movement records.
- **Backend — Auth**: session-cookie login/logout/me via `passport-local` + `express-session` (Postgres-backed store), Argon2 password hashing, login rate limiting.
- **Backend — RBAC**: `SessionAuthGuard` + `PermissionsGuard` + `@RequirePermissions` decorator applied to every route; permission constants centralized in `common/constants/permissions.ts`; v1 grants all permissions to all three roles.
- **Backend — Employees**: search (active-only for guards, all-inclusive for corrections), CRUD, deactivate/reactivate (soft delete).
- **Backend — Movements**: server-authoritative timestamps, confirm-before-save duplicate-movement warning, filterable listing, append-only record correction, missing-record addition.
- **Backend — Dashboard**: daily summary counts (employees/entries/exits), no working-hours calculation.
- **Backend — Reports**: HTML/CSS template rendered via Puppeteer to PNG and PDF; on-demand-only email send via Resend with the sent PNG persisted to S3-compatible storage and referenced from `email_logs`.
- **Backend — Users/Roles/Permissions/Settings/Audit-logs**: admin management modules, all write actions logged to the audit trail.
- **Frontend**: Login page; SecurityHome (search → select → ENTRY/EXIT core workflow, duplicate-confirmation modal, offline IndexedDB queue with a visible "pending sync" state); Dashboard (date/employee/movement-type filters, summary cards, responsive table→card layout); EmployeeDetails (per-day movement view, PNG/PDF download, on-demand EMAIL DETAILS with resend confirmation); Employees/Users/Settings admin pages.
- **PWA**: web app manifest and service worker via `vite-plugin-pwa`; placeholder icons pending real branding assets.
- **Documentation**: full `docs/` set — architecture, database schema, API reference, security model, role-based user guides (Security/HR/Admin), developer guide, testing checklist, deployment checklist, architecture decisions log, and roadmap.

### Verified

- Backend builds cleanly (`npm run build`, zero TypeScript errors).
- Frontend builds cleanly (`npm run build`, zero TypeScript errors).
- Prisma schema validated (`npx prisma validate`, `npx prisma generate`).

### Known gaps (tracked in `docs/roadmap.md`)

- No real database has been provisioned or migrated against yet — everything is verified at compile time only.
- Forgot-password flow is a non-functional UI placeholder.
- CSV/Excel employee import not implemented.
- No dedicated UI yet for record correction or the audit-log viewer (API-only for now).
- No automated tests exist yet.
- No CI pipeline or deployment configured yet.
- PWA icons and login-screen branding are placeholders, not real Adage assets.
