# Testing

No automated tests exist yet (tracked in [roadmap.md](./roadmap.md)). This document defines what must be covered, per the original spec, so tests can be filled in module-by-module without re-deriving requirements.

## Authentication

- Successful login with correct credentials
- Login rejected with wrong password / unknown username
- Login rejected for a disabled (`isActive: false`) user
- Logout destroys the session (subsequent `/auth/me` returns 401)
- Login is rate-limited after repeated failures
- `POST /auth/forgot-password` returns the identical generic response for a registered and an unregistered email (no enumeration leak)
- A valid, unexpired reset token successfully changes the password and the new password logs in
- An invalid, expired, or already-used reset token is rejected with 400
- A reset token can only be used once — reusing it after a successful reset fails
- `POST /auth/forgot-password` and `POST /auth/reset-password` are both rate-limited after repeated attempts

## Employees

- Search matches name, employee code, and email, case-insensitively
- Search returns only active employees on `/employees/search`, but includes inactive on `/employees/search-all`
- Search caps at 10 results
- Create rejects a duplicate `employeeCode`
- Update, deactivate, reactivate all write an audit log entry with before/after values

## Movements

- ENTRY and EXIT both create a `movement_records` row with a server-generated `movementAt`
- An employee can have unlimited ENTRY/EXIT rows on the same day — verify a sequence like ENTRY/EXIT/ENTRY/EXIT all persist as separate rows
- Duplicate-movement warning: pressing the same movement type twice in a row returns `requiresConfirmation: true` and does **not** create a record; resubmitting with `confirmed: true` creates it
- A client-supplied `movementAt` or `recordedByUserId` in the request body is ignored — the server always uses its own clock and the authenticated user
- Correcting a record marks the original `isSuperseded: true` and creates a new linked record — the original is never deleted or mutated in place
- "Current" queries (dashboard, employee history) exclude superseded records

## Dashboard

- Date filter returns only records within that day's boundary
- Employee filter narrows to one employee
- Movement-type filter narrows to ENTRY or EXIT only
- Filters combine correctly (date + employee + type together)
- Historical dates (not just today) return correct records
- Summary counts (`totalEmployees`, `totalEntries`, `totalExits`) match the underlying records for that date — and there is no working-hours field anywhere in the response

## Email

- `POST /reports/email` sends to the employee's registered email and CCs the configured Security email — neither is ever supplied by the caller
- The email contains exactly that employee's movements for exactly the requested date — never another employee's or another date's
- A PNG attachment is included and matches the on-screen data
- A failed send (e.g. provider error) marks the `email_logs` row `FAILED` with `errorMessage` populated, and does not silently report success to the caller
- No code path other than `POST /reports/email` ever calls `EmailService` — specifically, creating a movement record must never trigger a send

## Authorization

- Every endpoint rejects an unauthenticated request with 401
- Every endpoint rejects an authenticated request lacking the required permission with 403 — the current mapping (Security limited, HR adds Employees, Admin has everything — see `docs/decisions.md`) gives real, non-trivial cases to test directly rather than needing a synthetic fixture: e.g. Security hitting `/users` or `/employees` should 403, HR hitting `/users` should 403, Admin should 200 on everything
- Hiding a button in the UI is never treated as sufficient access control — every permission check must be independently verifiable by hitting the API directly

## Suggested test commands (once written)

```bash
npm test -w backend          # unit tests
npm run test:e2e -w backend  # end-to-end (requires a test database)
```

`backend/package.json` already has `test` and `test:e2e` scripts wired to Jest — they currently have no test files to run.
