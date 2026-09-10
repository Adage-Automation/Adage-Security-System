# Email Sending Options

> **Decided (2026-09-07): send through Adage's existing Microsoft 365 tenant** for `adage-automation.com` — confirmed via public MX records, so no new vendor account is needed. **Updated (2026-09-10)**: the transport mechanism changed from SMTP to the **Microsoft Graph API (OAuth2)** after Adage's M365 admin confirmed the tenant has basic-auth SMTP AUTH retired — no mailbox password can authenticate an SMTP send. Code has been switched again (`backend/src/email/email.service.ts` now calls the Graph API directly with a client-credentials token, no `nodemailer`/SMTP at all). See [decisions.md](./decisions.md) for the "avoid free-tier dependency" reasoning that led to the Microsoft 365 tenant in the first place, and [email-m365-admin-handoff.md](./email-m365-admin-handoff.md) for what's still needed (Azure app registration + `Mail.Send` permission + credentials from whoever administers Microsoft 365/Azure). The comparison below is kept for reference / in case this ever needs to change again.

The app sends exactly one kind of email — the on-demand "EMAIL DETAILS" movement record, with a PNG attachment, to an employee, CC'd to Security (see `docs/decisions.md` and spec §29-38). Volume will be low: a handful to a few dozen sends a day at most, triggered manually. That changes the calculus versus a marketing/transactional-at-scale product — deliverability and a clean API matter more than throughput.

The code already isolates all email logic in one file (`backend/src/email/email.service.ts`), so switching providers later is a small, contained change either way — this isn't a decision you're locked into forever.

## Comparison

| Provider | Free tier | Pricing after free tier | Setup effort | Notes |
|---|---|---|---|---|
| **Resend** | 3,000 emails/mo, 100/day | $20/mo for 50k | Low — modern API, attachments are trivial, good docs | Newer company (est. 2023) but built specifically for developers sending from an app; was the original implementation, since replaced |
| **SendGrid** (Twilio) | 100 emails/day (free tier discontinued for new accounts as of 2025 in some regions — verify current terms) | ~$20/mo for 50k | Medium — more enterprise-y API/dashboard | Very established, good for compliance-heavy orgs; API is more verbose than Resend's |
| **Amazon SES** | No free tier by default outside AWS's own EC2 sandbox allowance; extremely cheap pay-per-use (~$0.10 per 1,000 emails) | Scales down to near-zero at this volume | High — needs AWS account, domain verification via Route53/DNS, moving out of the SES sandbox (a manual approval request) before you can send to unverified recipients | Cheapest by far at low volume, but the most setup friction; makes sense if Adage already runs on AWS |
| **Microsoft 365 tenant** (chosen; Graph API/OAuth2, not SMTP) | Whatever the existing tenant's plan includes | Usually included, no extra cost | Low-to-medium — mailbox already exists on the domain (confirmed via MX records); needs an Azure app registration with `Mail.Send` since SMTP AUTH isn't available | Rides on infrastructure Adage already pays for and depends on for real business email, so there's no separate vendor free-tier that could change terms and break this feature. Daily sending limits are higher than this app will ever need. Slightly less deliverability tooling (no dedicated bounce/complaint webhooks) than a dedicated transactional provider, but irrelevant at this app's volume. |

## Why the existing tenant won over the others

The deciding concern (raised explicitly): free-tier terms from a third-party vendor can change at any time, silently breaking email sending. Structurally, the two most rug-pull-resistant options were **Amazon SES** (never had a free tier — pure pay-as-you-go from day one, so nothing to lose) and **an existing paid company mailbox** (not even a new vendor relationship for this feature). Since `adage-automation.com`'s MX records confirmed an existing Microsoft 365 tenant, it won on setup simplicity over standing up a new AWS account, Route53 DNS work, and an SES sandbox-removal request — first via SMTP, then via the Microsoft Graph API once SMTP AUTH turned out to be unavailable on the tenant.

## What was needed (now in progress)

1. ~~Which provider~~ — decided: Adage's existing Microsoft 365 tenant.
2. ~~An account with that provider~~ — not needed, rides on the existing tenant.
3. ~~Domain/mailbox confirmation~~ — done, see `email-m365-admin-handoff.md`.
4. ~~Azure app registration + credentials~~ — completed and verified. `Mail.Send` admin consent is granted and live Graph token acquisition/email delivery work. The remaining security follow-up is applying and verifying the Exchange Online application access policy for the approved sender mailbox. SMTP AUTH was tried first but turned out to be retired on this tenant (2026-09-10), hence the switch to OAuth2/Graph.
