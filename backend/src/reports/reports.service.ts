import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
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

    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

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

    const securityEmail = await this.settings.getSecurityEmail();
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
}
