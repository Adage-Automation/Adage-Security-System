import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { dayRange } from '../common/utils/day-range';
import { ReportGeneratorService } from './report-generator.service';
import { StorageService } from './storage.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private auditLog: AuditLogService,
    private generator: ReportGeneratorService,
    private storage: StorageService,
    private email: EmailService,
  ) {}

  private async loadReportData(employeeId: number, date: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const { start, end } = dayRange(date);

    const movements = await this.prisma.movementRecord.findMany({
      where: { employeeId, isSuperseded: false, movementAt: { gte: start, lt: end } },
      orderBy: { movementAt: 'asc' },
    });

    const companyName = (await this.settings.get('COMPANY_NAME')) ?? 'Adage';
    const dateLabel = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }).format(start);

    return { employee, movements, companyName, dateLabel };
  }

  // Downloads are generated fresh, never persisted (spec §58) — only
  // reports that are actually emailed get stored (decision log).
  async downloadPng(employeeId: number, date: string): Promise<{ buffer: Buffer; filename: string }> {
    const data = await this.loadReportData(employeeId, date);
    const buffer = await this.generator.generatePng({
      companyName: data.companyName,
      employeeName: data.employee.employeeName,
      employeeCode: data.employee.employeeCode,
      dateLabel: data.dateLabel,
      movements: data.movements,
    });
    return { buffer, filename: `${data.employee.employeeCode}_${date}.png` };
  }

  async downloadPdf(employeeId: number, date: string): Promise<{ buffer: Buffer; filename: string }> {
    const data = await this.loadReportData(employeeId, date);
    const buffer = await this.generator.generatePdf({
      companyName: data.companyName,
      employeeName: data.employee.employeeName,
      employeeCode: data.employee.employeeCode,
      dateLabel: data.dateLabel,
      movements: data.movements,
    });
    return { buffer, filename: `${data.employee.employeeCode}_${date}.pdf` };
  }

  // Strictly on-demand (spec §29, §66): only reached when an authorized
  // user explicitly calls this after selecting employee + date + viewing
  // the details. Never triggered from the movement-recording path.
  async emailDailyRecord(employeeId: number, date: string, requestedByUserId: number) {
    const data = await this.loadReportData(employeeId, date);
    if (!data.employee.email) {
      throw new BadRequestException('Employee has no registered email address');
    }

    // CC is the sending account's own login email, not a single global
    // setting — Adage runs multiple security units (2026-09-25), each
    // with its own shared login (e.g. securityunit1@adage-automation.com,
    // used by several guards at that unit). Whichever account is logged
    // in and triggers the send determines the CC. Accounts with no email
    // on file (shouldn't happen — email is required at creation) simply
    // send with no CC rather than a fallback address, matching how
    // HR/Admin sends already behave (they hold SEND_EMAIL too but aren't
    // tied to a unit).
    const requestedByUser = await this.prisma.user.findUnique({ where: { id: requestedByUserId }, select: { email: true } });
    const securityEmail = requestedByUser?.email;
    const senderName = (await this.settings.get('EMAIL_SENDER_NAME')) ?? 'Adage Security System';

    // The PENDING row is created before PNG generation, not after — a
    // Puppeteer crash/timeout used to throw before any email_logs row
    // existed at all, leaving a failed send attempt with zero audit trail
    // (the exact thing email_logs exists to prevent). Found in the
    // 2026-09-04 audit.
    const emailLog = await this.prisma.emailLog.create({
      data: {
        employeeId,
        movementDate: new Date(date),
        recipient: data.employee.email,
        cc: securityEmail,
        status: 'PENDING',
        createdByUserId: requestedByUserId,
      },
    });

    const storageKey = `email-reports/${data.employee.employeeCode}/${date}-${emailLog.id}.png`;

    try {
      const pngBuffer = await this.generator.generatePng({
        companyName: data.companyName,
        employeeName: data.employee.employeeName,
        employeeCode: data.employee.employeeCode,
        dateLabel: data.dateLabel,
        movements: data.movements,
      });

      await this.storage.uploadReport(storageKey, pngBuffer, 'image/png');

      await this.email.sendMovementRecordEmail({
        to: data.employee.email,
        cc: securityEmail,
        employeeName: data.employee.employeeName,
        dateLabel: data.dateLabel,
        senderName,
        attachment: { filename: `${data.employee.employeeCode}_${date}.png`, content: pngBuffer },
      });

      const sent = await this.prisma.emailLog.update({
        where: { id: emailLog.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          reportFileUrl: storageKey,
          reportFileFormat: 'PNG',
        },
      });

      await this.auditLog.record({
        userId: requestedByUserId,
        action: 'EMAIL_SENT',
        entityType: 'EmailLog',
        entityId: sent.id,
        newValue: sent,
      });

      return sent;
    } catch (err) {
      const failed = await this.prisma.emailLog.update({
        where: { id: emailLog.id },
        data: { status: 'FAILED', errorMessage: (err as Error).message },
      });
      await this.auditLog.record({
        userId: requestedByUserId,
        action: 'EMAIL_FAILED',
        entityType: 'EmailLog',
        entityId: failed.id,
        newValue: failed,
      });
      throw err;
    }
  }

  async listEmailLogs(employeeId?: number) {
    return this.prisma.emailLog.findMany({
      where: employeeId ? { employeeId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { employee: { select: { employeeName: true, employeeCode: true } } },
    });
  }

  // Re-serves the exact file that was actually emailed, resolving a
  // dispute ("I never got that email") without regenerating a new report
  // that might not byte-for-byte match what was sent. Previously
  // reportFileUrl was persisted for exactly this purpose but no endpoint
  // ever read it back — found in the 2026-09-09 audit.
  async getSignedUrlForEmailLog(emailLogId: number): Promise<string> {
    const log = await this.prisma.emailLog.findUnique({ where: { id: emailLogId } });
    if (!log) {
      throw new NotFoundException('Email log not found');
    }
    if (log.status !== 'SENT' || !log.reportFileUrl) {
      throw new BadRequestException('No stored report file for this email log (it was not successfully sent)');
    }
    return this.storage.getSignedDownloadUrl(log.reportFileUrl);
  }
}
