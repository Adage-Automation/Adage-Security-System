import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { parseOptionalInt } from '../common/utils/parse-optional-int';
import { todayInAppTimezone } from '../common/utils/day-range';
import { AuditLogService } from './audit-log.service';

@Controller('audit-logs')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class AuditLogController {
  constructor(private auditLogService: AuditLogService) {}

  @Get()
  @RequirePermissions('MANAGE_SETTINGS')
  list(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.auditLogService.list({
      entityType,
      entityId: parseOptionalInt(entityId, 'entityId'),
      userId: parseOptionalInt(userId, 'userId'),
      from,
      to,
      q,
      skip: parseOptionalInt(skip, 'skip'),
      take: parseOptionalInt(take, 'take'),
    });
  }

  // Registered before no ':id' route exists on this controller, so no
  // ordering concern (unlike Employees' 'export', which does need one) —
  // same filters as list() above, whatever's currently on screen.
  @Get('export')
  @RequirePermissions('MANAGE_SETTINGS')
  async export(
    @Res() res: Response,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
  ) {
    const buffer = await this.auditLogService.exportToExcel({
      entityType,
      entityId: parseOptionalInt(entityId, 'entityId'),
      userId: parseOptionalInt(userId, 'userId'),
      from,
      to,
      q,
    });
    const filename = `audit-log-${todayInAppTimezone()}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }
}
