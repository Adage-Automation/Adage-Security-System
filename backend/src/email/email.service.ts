import { Injectable, Logger } from '@nestjs/common';

interface SendMovementEmailInput {
  to: string;
  // Optional — CC is now the sending guard's own account-level Security CC
  // Email (per-unit), not a single global setting. Omitted entirely when
  // the sender has none configured (e.g. HR/Admin, or a not-yet-assigned
  // account). Found in the 2026-09-25 two-security-units change.
  cc?: string;
  // Optional — the mailbox to send "from", i.e. the logged-in account that
  // triggered this send (its own login email). Falls back to the fixed
  // MAIL_FROM_ADDRESS if omitted, or if Graph rejects the attempt (most
  // likely because that mailbox hasn't been added to the Exchange
  // application access policy's scope group yet — see
  // docs/email-m365-admin-handoff.md). The send is never allowed to fail
  // just because one account's mailbox isn't yet covered; it silently
  // retries with the address that is. Found in the 2026-09-28 dynamic-
  // sender change.
  from?: string;
  employeeName: string;
  dateLabel: string;
  senderName: string;
  attachment: { filename: string; content: Buffer };
}

interface SendPasswordResetEmailInput {
  to: string;
  name: string;
  resetLink: string;
  senderName: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface RequiredConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fromAddress: string;
}

// All email sending happens server-side only (spec §36) — the frontend
// never talks to the email provider directly. Strictly on-demand: this
// service is only ever invoked from the "EMAIL DETAILS" endpoint, never
// from the movement-recording path (spec §29, §66).
//
// Sends via the Microsoft Graph API (application permissions, OAuth2
// client-credentials flow), not SMTP — Microsoft has retired basic-auth
// SMTP AUTH on Exchange Online tenants, so a username/password can no
// longer authenticate here even with an app password (2026-09-10, per
// Adage's Microsoft 365 admin). Graph is Microsoft's supported
// replacement for unattended/app-only mail sending. This still rides on
// email infrastructure Adage already pays for and depends on for its
// actual business email, not a new third-party vendor relationship — see
// docs/decisions.md and docs/email-m365-admin-handoff.md.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private cachedToken: CachedToken | null = null;

  // Read lazily, not in the constructor: missing/invalid config must only
  // ever fail the send call, never crash the whole app at boot (auth,
  // movements, dashboard must keep working even before email is set up).
  private requireConfig(): RequiredConfig {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    const fromAddress = process.env.MAIL_FROM_ADDRESS;
    if (!tenantId || !clientId || !clientSecret || !fromAddress) {
      throw new Error(
        'Microsoft Graph email is not configured (AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET/MAIL_FROM_ADDRESS) — cannot send email.',
      );
    }
    return { tenantId, clientId, clientSecret, fromAddress };
  }

  // Client-credentials tokens are valid for ~1 hour; cached in memory and
  // refreshed a little early rather than fetched fresh on every send.
  private async getAccessToken(config: RequiredConfig): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 30_000) {
      return this.cachedToken.token;
    }

    const res = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to acquire Microsoft Graph access token: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
    return this.cachedToken.token;
  }

  // Returns the mailbox actually used as the sender — not necessarily
  // `input.from` — so the caller can persist what really happened (see
  // ReportsService.emailDailyRecord / email_logs.senderAddress) instead of
  // this only ever being visible as an ephemeral Render log line. Found in
  // the 2026-09-28 security audit.
  async sendMovementRecordEmail(input: SendMovementEmailInput): Promise<string> {
    // Inline styles throughout, not a <style> block -- Outlook/Gmail strip
    // or ignore <style> tags in transactional mail, so anything that must
    // actually render (bold labels, the teal accent, spacing) has to be
    // inline on each element. Found while improving the plain, unstyled
    // <p>-only body (2026-09-28 formatting request).
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1f2937; line-height: 1.6;">
        <p>Hello ${escapeHtml(input.employeeName.split(' ')[0])},</p>
        <p>As requested, please find attached the entry and exit records for
          <strong>${escapeHtml(input.employeeName)}</strong> on
          <strong>${escapeHtml(input.dateLabel)}</strong>.
        </p>
        <p style="margin: 20px 0; padding: 12px 16px; background: #f0f9fa; border-left: 3px solid #0d828b; color: #374151;">
          This is an automatically generated record from the <strong>${escapeHtml(input.senderName)}</strong>.
        </p>
        <p style="margin-bottom: 0;">
          Regards,<br/>
          <strong>${escapeHtml(input.senderName)}</strong>
        </p>
      </div>
    `;
    const config = this.requireConfig();
    const primaryFrom = input.from ?? config.fromAddress;
    const message = {
      to: input.to,
      cc: input.cc,
      subject: `Employee Movement Record — ${input.dateLabel}`,
      html,
      attachment: { filename: input.attachment.filename, contentType: 'image/png', content: input.attachment.content },
    };
    try {
      await this.sendMail(primaryFrom, message);
      return primaryFrom;
    } catch (err) {
      // Only worth a fallback attempt if the primary "from" actually
      // differs from the fixed address — otherwise it's the same request
      // that would just fail the same way again.
      if (primaryFrom === config.fromAddress) {
        this.logger.error(`Failed to send movement email to ${input.to}`, err as Error);
        throw err;
      }
      this.logger.warn(
        `Sending as ${primaryFrom} failed (likely not yet covered by the Exchange access policy) — retrying as the fixed ${config.fromAddress}. Original error: ${(err as Error).message}`,
      );
      try {
        await this.sendMail(config.fromAddress, message);
        return config.fromAddress;
      } catch (fallbackErr) {
        this.logger.error(`Failed to send movement email to ${input.to} (both as ${primaryFrom} and as fallback ${config.fromAddress})`, fallbackErr as Error);
        throw fallbackErr;
      }
    }
  }

  // Self-service "forgot password" — never reveals whether an account
  // exists (see AuthService.requestPasswordReset); this method is only
  // ever called once a matching, active account has already been found.
  async sendPasswordResetEmail(input: SendPasswordResetEmailInput): Promise<void> {
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1f2937; line-height: 1.6;">
        <p>Hello ${escapeHtml(input.name.split(' ')[0])},</p>
        <p>We received a request to reset your <strong>${escapeHtml(input.senderName)}</strong> password. Click the button below to choose a new one:</p>
        <p style="margin: 20px 0;">
          <a href="${escapeHtml(input.resetLink)}" style="display: inline-block; background: #0d828b; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: bold;">Reset Password</a>
        </p>
        <p style="color: #6b7280; font-size: 13px;">Or copy this link into your browser: <a href="${escapeHtml(input.resetLink)}">${escapeHtml(input.resetLink)}</a></p>
        <p style="margin: 20px 0; padding: 12px 16px; background: #f0f9fa; border-left: 3px solid #0d828b; color: #374151;">
          This link expires in <strong>1 hour</strong> and can only be used once. If you didn't request this, you can safely ignore this email — your password hasn't been changed.
        </p>
        <p style="margin-bottom: 0;">
          Regards,<br/>
          <strong>${escapeHtml(input.senderName)}</strong>
        </p>
      </div>
    `;
    const config = this.requireConfig();
    try {
      // Password resets always send from the fixed address, never a
      // dynamic sender — unlike movement-record emails, this isn't
      // triggered by a security-unit account acting on the desk's behalf;
      // it's a self-service request from whichever account is locked out,
      // and that account's own mailbox (if it even has one covered by the
      // access policy) has nothing to do with who should appear to send it.
      await this.sendMail(config.fromAddress, {
        to: input.to,
        subject: `Reset your ${input.senderName} password`,
        html,
      });
    } catch (err) {
      this.logger.error(`Failed to send password reset email to ${input.to}`, err as Error);
      throw err;
    }
  }

  private async sendMail(
    from: string,
    input: {
      to: string;
      cc?: string;
      subject: string;
      html: string;
      attachment?: { filename: string; contentType: string; content: Buffer };
    },
  ): Promise<void> {
    const config = this.requireConfig();
    const token = await this.getAccessToken(config);
    // sendMail on the specific mailbox we're allowed to act as — the
    // Azure app's Mail.Send permission is scoped to just this address via
    // an Exchange Online application access policy (see
    // docs/email-m365-admin-handoff.md), not tenant-wide.
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: input.subject,
          body: { contentType: 'HTML', content: input.html },
          toRecipients: [{ emailAddress: { address: input.to } }],
          ccRecipients: input.cc ? [{ emailAddress: { address: input.cc } }] : [],
          attachments: input.attachment
            ? [
                {
                  '@odata.type': '#microsoft.graph.fileAttachment',
                  name: input.attachment.filename,
                  contentType: input.attachment.contentType,
                  contentBytes: input.attachment.content.toString('base64'),
                },
              ]
            : [],
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      // Graph returns 202 with no body on success; anything else is a
      // real failure — never treat a non-2xx as sent (same principle as
      // the earlier Resend bug where a failed send was reported as
      // successful, see docs/roadmap.md's 2026-09-04 audit findings).
      throw new Error(`Microsoft Graph sendMail failed: ${res.status} ${await res.text()}`);
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
