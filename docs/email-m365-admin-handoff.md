# Handoff: Enabling SMTP Sending for the Adage Security System

Send this to whoever administers Microsoft 365 for `adage-automation.com`. Confirmed via public DNS (MX records) that this domain is already on Microsoft 365 — no new email vendor needed, just enabling SMTP sending for one mailbox.

## What's needed

1. **Confirm or create the mailbox**: `security@adage-automation.com` (or whichever address should be the "from" address for automated employee movement-record emails). This needs to be a regular **licensed mailbox** with its own password — not a shared mailbox (shared mailboxes don't have passwords, which SMTP AUTH needs) and not just an alias.

2. **Enable Authenticated SMTP for that mailbox specifically**: Microsoft 365 admin center → **Users** → **Active users** → select the mailbox → **Mail** tab → **Manage email apps** → check **Authenticated SMTP** → **Save changes**. (Microsoft disabled this tenant-wide by default in 2022 for security; this re-enables it for just this one account, not the whole tenant.)

3. **Handle MFA**: if that mailbox account has MFA enabled (likely, if it follows the rest of the tenant's security policy), a regular password won't work for SMTP AUTH. Either:
   - Generate an **app password** for the account (Microsoft 365 → My Account → Security info → Add sign-in method → App password), or
   - Exclude that one account from MFA via a Conditional Access policy (less preferred — an app password is more targeted and easier to revoke later).

4. **Send back** (not through a public/unsecured channel):
   - The exact mailbox address
   - The password or app password generated in step 3

## What this will be used for

An internal security-desk web app sends, **only when a staff member explicitly clicks "Email Details"** (never automatically, never in bulk), a single PNG image of one employee's entry/exit record for one day, to that employee's own `@adage-automation.com` address, CC'd to this same security mailbox. Expected volume: at most a handful to a few dozen emails per day.

## Technical connection details (for reference)

```
SMTP host: smtp.office365.com
Port: 587
Encryption: STARTTLS
Auth: the mailbox's own username (full email address) + password/app password
```

These go into the application's environment configuration (`backend/.env`, never committed to source control) as `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.
