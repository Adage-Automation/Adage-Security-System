# Email Sending Options

> **Decided (2026-09-07): SMTP**, via Adage's existing Microsoft 365 tenant for `adage-automation.com` — confirmed via public MX records, so no new vendor account is needed. Code has already been switched (`backend/src/email/email.service.ts` now uses `nodemailer` over SMTP, not the Resend SDK). See [decisions.md](./decisions.md) for the "avoid free-tier dependency" reasoning that led here, and [email-m365-admin-handoff.md](./email-m365-admin-handoff.md) for what's still needed (mailbox confirmation + SMTP AUTH enabled + credentials from whoever administers Microsoft 365). The comparison below is kept for reference / in case this ever needs to change again.

The app sends exactly one kind of email — the on-demand "EMAIL DETAILS" movement record, with a PNG attachment, to an employee, CC'd to Security (see `docs/decisions.md` and spec §29-38). Volume will be low: a handful to a few dozen sends a day at most, triggered manually. That changes the calculus versus a marketing/transactional-at-scale product — deliverability and a clean API matter more than throughput.

The code already isolates all email logic in one file (`backend/src/email/email.service.ts`), so switching providers later is a small, contained change either way — this isn't a decision you're locked into forever.

## Comparison

| Provider | Free tier | Pricing after free tier | Setup effort | Notes |
|---|---|---|---|---|
| **Resend** | 3,000 emails/mo, 100/day | $20/mo for 50k | Low — modern API, attachments are trivial, good docs | Newer company (est. 2023) but built specifically for developers sending from an app; was the original implementation, since replaced |
| **SendGrid** (Twilio) | 100 emails/day (free tier discontinued for new accounts as of 2025 in some regions — verify current terms) | ~$20/mo for 50k | Medium — more enterprise-y API/dashboard | Very established, good for compliance-heavy orgs; API is more verbose than Resend's |
| **Amazon SES** | No free tier by default outside AWS's own EC2 sandbox allowance; extremely cheap pay-per-use (~$0.10 per 1,000 emails) | Scales down to near-zero at this volume | High — needs AWS account, domain verification via Route53/DNS, moving out of the SES sandbox (a manual approval request) before you can send to unverified recipients | Cheapest by far at low volume, but the most setup friction; makes sense if Adage already runs on AWS |
| **SMTP via Microsoft 365** (chosen) | Whatever the existing tenant's plan includes | Usually included, no extra cost | Low — mailbox already exists on the domain (confirmed via MX records) | Rides on infrastructure Adage already pays for and depends on for real business email, so there's no separate vendor free-tier that could change terms and break this feature. Daily sending limits are higher than this app will ever need. Slightly less deliverability tooling (no dedicated bounce/complaint webhooks) than a dedicated transactional provider, but irrelevant at this app's volume. |

## Why SMTP via the existing tenant won over the others

The deciding concern (raised explicitly): free-tier terms from a third-party vendor can change at any time, silently breaking email sending. Structurally, the two most rug-pull-resistant options were **Amazon SES** (never had a free tier — pure pay-as-you-go from day one, so nothing to lose) and **SMTP via an existing paid company mailbox** (not even a new vendor relationship for this feature). Since `adage-automation.com`'s MX records confirmed an existing Microsoft 365 tenant, SMTP won on setup simplicity — no new AWS account, no Route53 DNS work, no SES sandbox-removal request.

## What was needed (now in progress)

1. ~~Which provider~~ — decided: SMTP via Microsoft 365.
2. ~~An account with that provider~~ — not needed, rides on the existing tenant.
3. **Domain/mailbox confirmation** — in progress, see `email-m365-admin-handoff.md`.
4. **Credentials** (`SMTP_PASS` in `backend/.env`) — waiting on whoever administers Microsoft 365.
