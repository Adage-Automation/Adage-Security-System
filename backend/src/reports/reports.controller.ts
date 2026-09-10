import { Controller, Get, Param, ParseIntPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { parseOptionalInt } from '../common/utils/parse-optional-int';
import { ReportsService } from './reports.service';
import { AuditLogService } from '../audit-logs/audit-log.service';

@Controller('reports')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(
    private reportsService: ReportsService,
    private auditLog: AuditLogService,
  ) {}

  // Spec §21 requires "Report Downloaded" as an audited action — this was
  // previously missing entirely (only email sends were logged). Found in
  // the 2026-09-09 audit.
  @Get('image')
  @RequirePermissions('DOWNLOAD_REPORT')
  async image(@Query('employeeId', ParseIntPipe) employeeId: number, @Query('date') date: string, @CurrentUser() user: any, @Res() res: Response) {
    const { buffer, filename } = await this.reportsService.downloadPng(employeeId, date);
    await this.auditLog.record({
      userId: user.id,
      action: 'REPORT_DOWNLOADED',
      entityType: 'Employee',
      entityId: employeeId,
      newValue: { format: 'PNG', date },
    });
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  @Get('pdf')
  @RequirePermissions('DOWNLOAD_REPORT')
  async pdf(@Query('employeeId', ParseIntPipe) employeeId: number, @Query('date') date: string, @CurrentUser() user: any, @Res() res: Response) {
    const { buffer, filename } = await this.reportsService.downloadPdf(employeeId, date);
    await this.auditLog.record({
      userId: user.id,
      action: 'REPORT_DOWNLOADED',
      entityType: 'Employee',
      entityId: employeeId,
      newValue: { format: 'PDF', date },
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  // Only endpoint that ever triggers an email — never called automatically
  // from the movement-recording flow (spec §29, §66).
  @Post('email')
  @RequirePermissions('SEND_EMAIL')
  email(@Query('employeeId', ParseIntPipe) employeeId: number, @Query('date') date: string, @CurrentUser() user: any) {
    return this.reportsService.emailDailyRecord(employeeId, date, user.id);
  }

  @Get('email-logs')
  @RequirePermissions('SEND_EMAIL')
  emailLogs(@Query('employeeId') employeeId?: string) {
    return this.reportsService.listEmailLogs(parseOptionalInt(employeeId, 'employeeId'));
  }

  // Re-serves the exact file that was previously emailed, via a short-lived
  // signed URL — resolves an "I never got that email" dispute without
  // regenerating a fresh (potentially different) report.
  @Get('email-logs/:id/download')
  @RequirePermissions('SEND_EMAIL')
  async downloadEmailedReport(@Param('id', ParseIntPipe) id: number) {
    const url = await this.reportsService.getSignedUrlForEmailLog(id);
    return { url };
  }
}
