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

5. **Restrict which mailbox the app can send as** (important — `Mail.Send` as an application permission can otherwise send as *any* mailbox in the tenant). Create a mail-enabled security group or distribution group containing only the sending mailbox, then run this once in **Exchange Online PowerShell**, using that group's email address or ID as the policy scope:
   ```powershell
   New-ApplicationAccessPolicy -AppId "<the Application (client) ID from step 2>" `
   -PolicyScopeGroupId "<mail-enabled group containing only the sending mailbox>" `
     -AccessRight RestrictAccess `
     -Description "Adage Security System - restrict to security mailbox only"
   ```
   (This requires the target mailbox and the mail-enabled scope group to exist first — see step 6.)

6. **Confirm or create the mailbox**: `security@adage-automation.com` — a regular mailbox (licensed or shared both work here, since Graph doesn't need a password for this mailbox at all; only the app's client secret is used).

7. **Send back** (not through a public/unsecured channel):
   - Directory (tenant) ID
   - Application (client) ID
   - The client secret's value
   - Confirmation of which mailbox address the access policy was scoped to

## What this will be used for

An internal security-desk web app sends, **only when a staff member explicitly clicks "Email Details"** (never automatically, never in bulk), a single PNG image of one employee's entry/exit record for one day, to that employee's own `@adage-automation.com` address, CC'd to whichever security unit's own address (e.g. `securityunit1@`/`securityunit2@adage-automation.com`) is actually sending it — a separate address from the mailbox in step 6, which is only the technical *sending* mailbox for the Graph API. Expected volume: at most a handful to a few dozen emails per day.

## Technical details (for reference)

```
Auth:  OAuth2 client-credentials grant against
       https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token
       scope: https://graph.microsoft.com/.default
Send:  POST https://graph.microsoft.com/v1.0/users/{mailbox}/sendMail
```

These three values go into the application's environment configuration (`backend/.env`, never committed to source control) as `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, alongside `MAIL_FROM_ADDRESS` (the mailbox from step 6).
