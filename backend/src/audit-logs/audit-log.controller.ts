import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { parseOptionalInt } from '../common/utils/parse-optional-int';
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
}
