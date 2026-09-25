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
- The "from" display name for outgoing emails (`EMAIL_SENDER_NAME`, currently `"Adage Security System"`)
- Confirm the timezone stays `Asia/Kolkata`, or tell me if operations span another timezone

**Security-unit CC emails are not a Settings value** — with multiple security units (2026-09-25: `securityunit1@adage-automation.com`, `securityunit2@adage-automation.com`, each a shared login used by 2-3 guards at that unit), the CC on an emailed report is whichever unit's account actually sent it, i.e. that account's own login `email`. Set/verify this per account on the Users screen — no separate configuration needed.

## 3. Real employee data — mostly done

✅ First 6 real employees added (2026-09-03), then the full roster of 205 employees imported (2026-09-09) from `backend/data/employees.csv` — re-run `npm run import:employees -w backend -- data/employees.csv` from the repo root any time it is updated; upserts by employee code, safe to re-run. The 4 fake test employees (Rahul Sharma, Rahul Patil, Amit Patil, Priya Nair) have been permanently deleted, along with their test movement records.

**Employee metadata trimmed**: the Add/Edit Employee form and CSV import never exposed phone/department/designation fields (confirmed unused in search, filtering, and reports back on 2026-09-03) — but the underlying database columns and schema type lingered unused until 2026-09-22, when they were properly dropped (schema, DTOs, import script, and frontend types all updated to match; see [decisions.md](./decisions.md#backfill-migration-for-a-schema-change-made-directly-against-the-database)). The current schema now only keeps the employee fields the app actually uses.

**Email made optional** (2026-09-09): 54 of the 205 imported employees don't have a registered email yet — the schema, import script, and UI (Add Employee form, EMAIL DETAILS button) all handle this correctly now. **Still needed**: those 54 employees' email addresses, whenever available — update the roster CSV and re-run the import, or add them individually via the Employees screen. Until then, "EMAIL DETAILS" simply won't be available for those employees, with a clear inline explanation shown.

## 4. Real user accounts

The seeded `admin`/`hr`/`security` logins (password `ChangeMe123!`) are for development only and must never be used in production. I need, for each real person who'll log in initially:
- Name, email, desired username, and role (SECURITY / HR / ADMIN)

I can create these directly once you confirm the list, or an Admin can create them through the Users screen after the first Admin account exists.

## 5. Email sending — ✅ working

✅ Decided (2026-09-07): send via Adage's existing Microsoft 365 tenant for `adage-automation.com` (confirmed via public DNS/MX records — no new email vendor needed). See [decisions.md](./decisions.md#email-provider-smtp-via-adages-existing-microsoft-365-tenant-not-resend) for the full comparison that led here.

**Updated (2026-09-10)**: the original plan was SMTP with a mailbox password, but Microsoft 365 has retired basic-auth SMTP AUTH — no password or app password can authenticate an SMTP send anymore. The app now uses the **Microsoft Graph API** via an OAuth2 app registration instead.

✅ **Verified working end to end (2026-09-10)**: the Azure AD app is registered, admin consent for `Mail.Send` is granted, credentials are set in `backend/.env`, and a real "Email Details" send was confirmed delivered.

**Still to do** (not blocking normal use): (1) run the Exchange Online application access policy restricting the app to just the sending mailbox — see [email-m365-admin-handoff.md](./email-m365-admin-handoff.md) step 5; (2) once a real `security@adage-automation.com` mailbox is created, swap `MAIL_FROM_ADDRESS` in `backend/.env` away from the current temporary stand-in (`shivani.naik@adage-automation.com`) to it, and re-run the access policy against the new mailbox; (3) **confirm `securityunit1@adage-automation.com` and `securityunit2@adage-automation.com` are real, existing mailboxes** — since 2026-09-25 they're used as literal CC recipients on outgoing report emails (see "Company & configuration data" above), not just internal config values, so mail to them will silently go nowhere if they don't actually exist yet.

## 6. Storage (for emailed reports) — ✅ working

✅ Bucket created and S3-compatible keys filled in (`STORAGE_*` in `backend/.env`), using the same Supabase project as the database. Verified working end to end 2026-09-10 alongside the email test above.

## 7. Domain & deployment — ✅ live, custom domain still open

✅ Deployed since 2026-09-11: frontend on Vercel, backend on Render (`https://adage-security-system.onrender.com`), database on Supabase — see `docs/deployment.md`. Still open:

- A custom subdomain (e.g. `security.adage.com`) instead of the free provider-issued URLs above, if wanted
- Confirming whether a paid Render/Supabase tier is worth it later to remove the free-tier sleep/auto-pause behavior entirely (currently mitigated with a keep-alive ping, not eliminated — see `docs/deployment.md#keeping-it-alive-render-sleep--supabase-auto-pause`)

## Not needed from you

Anything not listed above — architecture, code, the database schema, the RBAC model, the report template design, etc. — is already decided and built; you don't need to weigh in unless something in `docs/decisions.md` looks wrong to you.
