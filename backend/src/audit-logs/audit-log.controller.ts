import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
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
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.auditLogService.list({
      entityType,
      entityId: entityId ? Number(entityId) : undefined,
      userId: userId ? Number(userId) : undefined,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }
}
