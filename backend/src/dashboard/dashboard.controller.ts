import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { MovementsService } from '../movements/movements.service';

@Controller('dashboard')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class DashboardController {
  constructor(private movementsService: MovementsService) {}

  // Today's stats (§23): total employees, total entries, total exits.
  // Deliberately no working-hours calculation anywhere (spec §64).
  @Get('summary')
  @RequirePermissions('VIEW_DASHBOARD')
  summary(@Query('date') date?: string) {
    const targetDate = date ?? new Date().toISOString().slice(0, 10);
    return this.movementsService.summaryForDate(targetDate);
  }
}
