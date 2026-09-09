# What's Needed From Adage's Side

Everything the app can build without you is built. This is the list of things only Adage can provide — branding assets, real data, and account-level decisions. Nothing below blocks development from continuing, but each item blocks the *real* production launch until it's supplied.

## 1. Branding — mostly done

- ✅ **Logo file** — received (`Adage_Logo.png`, the horizontal wordmark). In use across the header, login screen, PWA icons, and the emailed/downloaded report template.
- ✅ **Brand teal** — sampled directly from the logo file: `#0d828b`. All CSS variables and the PWA theme color now use this exact value, not a guess.
- **Still open**: a square "mark-only" version of the logo (just the symbol, no wordmark) would let the header badge and PWA icon look tighter — right now they use the full wordmark scaled down / centered, which works but isn't ideal at very small sizes. Not blocking, just an improvement if one exists.
- **Still open**: any existing brand guideline (secondary colors, approved fonts, logo clear-space rules) if one exists — otherwise the current choices (Inter typeface, teal + white, generous rounded corners) stand as reasonable defaults.

## 2. Company & configuration data

These populate the `settings` table (Settings screen, or I can seed them directly):
- Official company name as it should appear on reports/emails (currently placeholder `"Adage"`)
- The security desk's email address to CC on every employee record email (`SECURITY_EMAIL`)
- The "from" display name for outgoing emails (`EMAIL_SENDER_NAME`, currently `"Adage Security System"`)
- Confirm the timezone stays `Asia/Kolkata`, or tell me if operations span another timezone

## 3. Real employee data — mostly done

✅ First 6 real employees added (2026-09-03), then the full roster of 205 employees imported (2026-09-09) from `backend/data/employees.csv` — this is now the one, current, living roster file (re-run `npm run import:employees -- data/employees.csv` from `backend/` any time it's updated; upserts by employee code, safe to re-run). The 4 fake test employees (Rahul Sharma, Rahul Patil, Amit Patil, Priya Nair) have been permanently deleted, along with their test movement records.

**Department/designation dropped** (2026-09-03, by request): confirmed these fields weren't used anywhere in search, filtering, or reports — pure unused metadata. Removed from the "Add Employee" form and the CSV import format entirely. The database columns remain (nullable, harmless) in case they're wanted later.

**Email made optional** (2026-09-09): 54 of the 205 imported employees don't have a registered email yet — the schema, import script, and UI (Add Employee form, EMAIL DETAILS button) all handle this correctly now. **Still needed**: those 54 employees' email addresses, whenever available — update `backend/data/employees.csv` and re-run the import, or add them individually via the Employees screen. Until then, "EMAIL DETAILS" simply won't be available for those employees, with a clear inline explanation shown.

## 4. Real user accounts

The seeded `admin`/`hr`/`security` logins (password `ChangeMe123!`) are for development only and must never be used in production. I need, for each real person who'll log in initially:
- Name, email, desired username, and role (SECURITY / HR / ADMIN)

I can create these directly once you confirm the list, or an Admin can create them through the Users screen after the first Admin account exists.

## 5. Email sending — decided, waiting on credentials

✅ Decided (2026-09-07): SMTP via Adage's existing Microsoft 365 tenant for `adage-automation.com` (confirmed via public DNS/MX records — no new email vendor needed). See [email-provider-options.md](./email-provider-options.md) for the full comparison that led here.

**Still needed** — see [email-m365-admin-handoff.md](./email-m365-admin-handoff.md) for the exact instructions to hand to whoever administers Microsoft 365: confirmation/creation of the `security@adage-automation.com` mailbox, Authenticated SMTP enabled for it, and the resulting password or app password (goes in `backend/.env` as `SMTP_PASS`, never shared in chat).

## 6. Storage (for emailed reports)

- Already using the Supabase project's bundled storage (decided earlier) — just need a bucket created and its S3-compatible keys, per `docs/deployment.md#setting-up-supabase`. No separate action needed unless you'd rather use a different provider.

## 7. Domain & deployment (when ready to go live)

- The subdomain you want the app on (e.g. `security.adage.com`)
- Which hosting accounts to use for the frontend/backend (see `docs/deployment.md` for provider suggestions) — or confirmation to proceed with the recommended defaults

## Not needed from you

Anything not listed above — architecture, code, the database schema, the RBAC model, the report template design, etc. — is already decided and built; you don't need to weigh in unless something in `docs/decisions.md` looks wrong to you.
