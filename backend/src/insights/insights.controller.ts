import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { todayInAppTimezone } from '../common/utils/day-range';
import { InsightsService } from './insights.service';
import { InsightsQueryDto } from './dto/insights-query.dto';
import { DrillDownQueryDto } from './dto/drill-down-query.dto';
import { EmployeeDetailQueryDto } from './dto/employee-detail-query.dto';
import { DailyDurationQueryDto } from './dto/daily-duration-query.dto';

// VIEW_REPORTS only — HR and Admin, not Security. This is aggregated data
// about the whole workforce (attendance patterns, hours shortfalls, team
// breakdowns), more sensitive than the per-day table Security already
// sees via VIEW_DASHBOARD, so it gets its own real permission rather than
// reusing an existing one. See docs/decisions.md.
@Controller('insights')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class InsightsController {
  constructor(private insightsService: InsightsService) {}

  @Get('summary')
  @RequirePermissions('VIEW_REPORTS')
  summary(@Query() query: InsightsQueryDto) {
    return this.insightsService.getSummary(query);
  }

  // Backs the "All Time" date preset — without this, "all time" would need
  // to either hardcode a start date (wrong the moment real data predates
  // or postdates whatever was guessed) or send an arbitrarily-early `from`
  // that's correct in effect but ugly to show back in the date field.
  @Get('earliest-movement')
  @RequirePermissions('VIEW_REPORTS')
  earliestMovement() {
    return this.insightsService.getEarliestMovementDate();
  }

  // Backs clicking a chart bar — returns the underlying rows for one
  // element (one day, one team, one unit), never a full export.
  @Get('drill-down')
  @RequirePermissions('VIEW_REPORTS')
  drillDown(@Query() query: DrillDownQueryDto) {
    return this.insightsService.getDrillDown(query);
  }

  // One employee's own trend over the range — picked via a search box, not
  // tied to any particular chart click.
  @Get('employee-detail')
  @RequirePermissions('VIEW_REPORTS')
  employeeDetail(@Query() query: EmployeeDetailQueryDto) {
    return this.insightsService.getEmployeeDetail(query);
  }

  // Spec item #5 — every employee's duration for one selected day, with
  // missing entry/exit flagged. Table-only (see InsightsService.getDailyDuration).
  @Get('daily-duration')
  @RequirePermissions('VIEW_REPORTS')
  dailyDuration(@Query() query: DailyDurationQueryDto) {
    return this.insightsService.getDailyDuration(query);
  }

  // Three export routes mirroring the JSON views above — generates the
  // .xlsx fresh from the database on every call, same pattern as
  // EmployeesController.export.
  @Get('export/drill-down')
  @RequirePermissions('VIEW_REPORTS')
  async exportDrillDown(@Query() query: DrillDownQueryDto, @Res() res: Response) {
    const buffer = await this.insightsService.exportDrillDown(query);
    this.sendExcel(res, buffer, `insights-${query.metric}`);
  }

  @Get('export/team-breakdown')
  @RequirePermissions('VIEW_REPORTS')
  async exportTeamBreakdown(@Query() query: InsightsQueryDto, @Res() res: Response) {
    const buffer = await this.insightsService.exportTeamBreakdown(query);
    this.sendExcel(res, buffer, 'insights-team-breakdown');
  }

  @Get('export/daily-duration')
  @RequirePermissions('VIEW_REPORTS')
  async exportDailyDuration(@Query() query: DailyDurationQueryDto, @Res() res: Response) {
    const buffer = await this.insightsService.exportDailyDuration(query);
    this.sendExcel(res, buffer, `insights-daily-duration-${query.date}`);
  }

  private sendExcel(res: Response, buffer: Buffer, filenameBase: string) {
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filenameBase}-${todayInAppTimezone()}.xlsx"`,
    });
    res.send(buffer);
  }
}
