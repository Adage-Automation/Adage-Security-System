import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';

interface SendMovementEmailInput {
  to: string;
  cc: string;
  employeeName: string;
  dateLabel: string;
  senderName: string;
  attachment: { filename: string; content: Buffer };
}

// All email sending happens server-side only (spec §36) — the frontend
// never talks to the email provider directly. Strictly on-demand: this
// service is only ever invoked from the "EMAIL DETAILS" endpoint, never
// from the movement-recording path (spec §29, §66).
//
// Sends via SMTP (Microsoft 365 / Office 365) rather than a third-party
// transactional-email API — adage-automation.com's MX records already
// point at Microsoft 365, so this rides on email infrastructure Adage
// already pays for and depends on, rather than adding a new vendor
// relationship with its own free-tier terms that could change. See
// docs/decisions.md and docs/email-m365-admin-handoff.md.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  // Constructed lazily rather than in the constructor: a missing/invalid
  // SMTP config must only ever fail the send call, never crash the whole
  // app at boot (the app must keep working — auth, movements, dashboard —
  // even before email is configured).
  private getTransporter(): Transporter {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      throw new Error('SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS) — cannot send email.');
    }
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: false, // STARTTLS on 587, not implicit TLS
        // Without this, nodemailer's default "opportunistic STARTTLS"
        // silently falls back to plaintext if the server doesn't advertise
        // STARTTLS (e.g. stripped by a MITM, or a transient misconfig) —
        // sending the SMTP password and employee PII unencrypted with no
        // error. This makes that fail loudly instead. Found in audit.
        requireTLS: true,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }
    return this.transporter;
  }

  async sendMovementRecordEmail(input: SendMovementEmailInput): Promise<void> {
    const html = `
      <p>Hello ${escapeHtml(input.employeeName.split(' ')[0])},</p>
      <p>As requested, please find attached your entry and exit records for ${escapeHtml(input.dateLabel)}.</p>
      <p>This is an automatically generated record from the ${escapeHtml(input.senderName)}.</p>
      <p>Regards,<br/>${escapeHtml(input.senderName)}</p>
    `;

    try {
      // nodemailer throws for both transport-level AND SMTP-rejection
      // failures (unlike some provider SDKs that silently resolve with an
      // error field) — no separate error-field check needed here, but see
      // the 2026-09-04 audit note in reports.service.ts for why that
      // distinction matters and was previously missed with Resend.
      await this.getTransporter().sendMail({
        from: process.env.EMAIL_FROM ?? 'Adage Security System <security@adage-automation.com>',
        to: input.to,
        cc: input.cc,
        subject: `Employee Movement Record — ${input.dateLabel}`,
        html,
        attachments: [
          {
            filename: input.attachment.filename,
            content: input.attachment.content,
          },
        ],
      });
    } catch (err) {
      this.logger.error(`Failed to send movement email to ${input.to}`, err as Error);
      throw err;
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
