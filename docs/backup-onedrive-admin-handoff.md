# Handoff: Enabling SharePoint Backup Storage for the Adage Security System

Send this to whoever administers Microsoft 365 / Azure for `adage-automation.com` (the same person who set up email sending). This reuses the **same Azure AD app** already registered for sending mail ("Adage Security System — Mail Sender") — no new app, no new client secret to manage — just one additional permission, scoped to a single SharePoint site rather than the whole tenant.

## Why SharePoint instead of a personal OneDrive

The nightly database backup currently lands in the same Supabase project it's backing up — if that project were ever deleted or compromised, the backup disappears with it. Storing it in SharePoint/OneDrive instead puts it in a genuinely separate system. A **SharePoint site's document library** is used rather than one person's personal OneDrive so the backup isn't tied to any individual's account and survives them leaving — target: `https://adageautomationpl.sharepoint.com/sites/DigitalizationAIDept`.

## What's needed

1. **Add one new permission to the existing app registration**: [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → the existing "Adage Security System — Mail Sender" app → **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions** → search for and add **`Sites.Selected`** → click **Grant admin consent for [tenant]**.

   `Sites.Selected` on its own grants access to **nothing** until a site is explicitly listed in step 2 below — this is the deliberately narrow alternative to `Sites.ReadWrite.All`, which would let the app write to *every* SharePoint site in the tenant. Same least-privilege principle already used for email (the Exchange access policy scoping `Mail.Send` to specific mailboxes only).

2. **Grant that app write access to this one site.** This step can't be done from the Azure Portal UI — it's a single Graph API call, made once, by someone signed in with SharePoint admin rights. Easiest way: [Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer), signed in as an account with SharePoint admin (or Global Admin) rights.

   a. First, resolve the site's ID:
   ```
   GET https://graph.microsoft.com/v1.0/sites/adageautomationpl.sharepoint.com:/sites/DigitalizationAIDept
   ```
   Copy the `id` field from the response (looks like `adageautomationpl.sharepoint.com,xxxxx-xxxx-...,yyyyy-yyyy-...`).

   b. Then grant the app write access to that site:
   ```
   POST https://graph.microsoft.com/v1.0/sites/{site-id-from-above}/permissions
   ```
   Body:
   ```json
   {
     "roles": ["write"],
     "grantedToIdentities": [
       {
         "application": {
           "id": "<the Application (client) ID — same one from the email setup>",
           "displayName": "Adage Security System - Mail Sender"
         }
       }
     ]
   }
   ```
   A successful response includes a `permission` `id` — save that too; it's needed if this access ever needs to be revoked later (`DELETE /sites/{site-id}/permissions/{permission-id}`).

3. **Send back**:
   - Confirmation that `Sites.Selected` was added and admin consent granted (step 1)
   - The site `id` from step 2a
   - The permission `id` from step 2b's response

No new client secret, tenant ID, or client ID is needed — this reuses everything already in `backend/.env` and the GitHub Actions secrets from the email/backup setup.

## What this will be used for

The existing nightly database backup workflow (`.github/workflows/db-backup.yml`, currently uploading a `pg_dump` to Supabase Storage) will be extended to also upload that same dump — plus a copy of every emailed report file (PNG/PDF) currently sitting in the S3/R2 storage bucket — into this SharePoint folder, so backups no longer live only inside the same project as the data they protect. Runs once daily, uploading only what changed since the previous run; total volume: a small compressed SQL file plus a modest number of small image/PDF files per day.

## Technical details (for reference)

```
Auth:   Same OAuth2 client-credentials grant already used for email
        (https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token,
        scope: https://graph.microsoft.com/.default)
Upload: PUT https://graph.microsoft.com/v1.0/sites/{site-id}/drive/root:/{path}:/content
        (small files, <4MB; an upload session is used instead for anything larger)
```
