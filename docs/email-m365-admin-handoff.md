# Handoff: Enabling Mail Sending for the Adage Security System (OAuth2 / Microsoft Graph)

Send this to whoever administers Microsoft 365 / Azure for `adage-automation.com`. This supersedes an earlier handoff that asked for SMTP AUTH with a mailbox password — **that approach no longer works**: Microsoft 365 has retired basic-auth SMTP AUTH on Exchange Online, so no mailbox password or app password can authenticate an SMTP send anymore. The supported replacement is an Azure AD app registration using OAuth2, sending through the **Microsoft Graph API** instead of SMTP.

## What's needed

1. **Register an app** in the [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**.
   - Name: something recognizable, e.g. "Adage Security System — Mail Sender"
   - Supported account types: **Single tenant** (accounts in this organizational directory only)
   - Redirect URI: leave blank (this app never involves a user sign-in)

2. **Note two values from the app's Overview page**:
   - **Application (client) ID**
   - **Directory (tenant) ID**

3. **Create a client secret**: app registration → **Certificates & secrets** → **New client secret**. Copy the secret's **value** immediately — it's only shown once. Set an expiry per your organization's policy (e.g. 12 or 24 months) and calendar a reminder to rotate it before then.

4. **Grant the app permission to send mail**: app registration → **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions** → search for and add **`Mail.Send`** → then click **Grant admin consent for [tenant]** (requires a Global Administrator or Privileged Role Administrator).

5. **Restrict which mailboxes the app can send as** (important — `Mail.Send` as an application permission can otherwise send as *any* mailbox in the tenant). As of 2026-09-28, the app sends **as whichever account is actually logged in and triggers a send** — not always one fixed mailbox — so the scope group must contain **every mailbox that might ever be a sender**, not just one:
   - `security@adage-automation.com` (the fixed fallback address, used for HR/Admin sends and as a safety net if a unit's mailbox isn't in this group yet)
   - `securityunit1@adage-automation.com` and `securityunit2@adage-automation.com` (today's two security units — add each new unit's mailbox here too, whenever one is created)

   Create (or update) a mail-enabled security group or distribution group containing all of the above, then run this once in **Exchange Online PowerShell**, using that group's email address or ID as the policy scope:
   ```powershell
   New-ApplicationAccessPolicy -AppId "<the Application (client) ID from step 2>" `
   -PolicyScopeGroupId "<mail-enabled group containing all sender mailboxes above>" `
     -AccessRight RestrictAccess `
     -Description "Adage Security System - restrict to security mailboxes only"
   ```
   (This requires every target mailbox and the mail-enabled scope group to exist first — see step 6. If you're updating an existing policy/group rather than creating a new one, just add the new mailbox as a group member — no need to re-run `New-ApplicationAccessPolicy`.)

6. **Confirm or create the mailboxes** listed in step 5 — regular mailboxes (licensed or shared both work here, since Graph doesn't need a password for any of them; only the app's client secret is used). `securityunit1@`/`securityunit2@adage-automation.com` already exist (confirmed 2026-09-28); `security@adage-automation.com` does not yet.

7. **Send back** (not through a public/unsecured channel):
   - Directory (tenant) ID
   - Application (client) ID
   - The client secret's value
   - Confirmation of which mailboxes the access policy's scope group actually contains

## What this will be used for

An internal security-desk web app sends, **only when a staff member explicitly clicks "Email Details"** (never automatically, never in bulk), a single PNG image of one employee's entry/exit record for one day, to that employee's own `@adage-automation.com` address. As of 2026-09-28, it sends **from and CCs whichever account is actually logged in and triggers the send** — a guard at Unit 1 sends from/CCs `securityunit1@`, a guard at Unit 2 sends from/CCs `securityunit2@` — falling back to the fixed `security@adage-automation.com` if that account's mailbox isn't yet in the access-policy scope group (step 5), or if the sender is HR/Admin rather than a security unit. Expected volume: at most a handful to a few dozen emails per day.

## Technical details (for reference)

```
Auth:  OAuth2 client-credentials grant against
       https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token
       scope: https://graph.microsoft.com/.default
Send:  POST https://graph.microsoft.com/v1.0/users/{mailbox}/sendMail
```
`{mailbox}` is chosen per-send (whichever account triggered it, or the fixed fallback) — not a single hardcoded value — which is exactly why the access policy above must cover every mailbox that might appear there, not just one.

These three values go into the application's environment configuration (`backend/.env`, never committed to source control) as `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, alongside `MAIL_FROM_ADDRESS` (the one fixed fallback mailbox, `security@adage-automation.com`).
