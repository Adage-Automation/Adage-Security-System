import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('image')
  @RequirePermissions('DOWNLOAD_REPORT')
  async image(@Query('employeeId') employeeId: string, @Query('date') date: string, @Res() res: Response) {
    const { buffer, filename } = await this.reportsService.downloadPng(Number(employeeId), date);
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  @Get('pdf')
  @RequirePermissions('DOWNLOAD_REPORT')
  async pdf(@Query('employeeId') employeeId: string, @Query('date') date: string, @Res() res: Response) {
    const { buffer, filename } = await this.reportsService.downloadPdf(Number(employeeId), date);
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
  email(@Query('employeeId') employeeId: string, @Query('date') date: string, @CurrentUser() user: any) {
    return this.reportsService.emailDailyRecord(Number(employeeId), date, user.id);
  }

  @Get('email-logs')
  @RequirePermissions('SEND_EMAIL')
  emailLogs(@Query('employeeId') employeeId?: string) {
    return this.reportsService.listEmailLogs(employeeId ? Number(employeeId) : undefined);
  }
}
