import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../common/guards/session-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { parseOptionalInt } from '../common/utils/parse-optional-int';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

@Controller('employees')
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class EmployeesController {
  constructor(private employeesService: EmployeesService) {}

  // VIEW_DASHBOARD, not RECORD_ENTRY — this active-employee search backs
  // both the guard's ENTRY/EXIT selector AND the Dashboard's employee
  // filter dropdown, which HR also needs. Gating it behind RECORD_ENTRY
  // silently broke the Dashboard filter for HR the moment HR's recording
  // permissions were removed (2026-09-10) — every role that can reach the
  // Dashboard already holds VIEW_DASHBOARD, so this covers both use cases
  // without granting anything extra. Same root-cause class as the
  // MANAGE_EMPLOYEES/VIEW_EMPLOYEE_HISTORY fix from the 2026-09-04 audit.
  @Get('search')
  @RequirePermissions('VIEW_DASHBOARD')
  search(@Query('q') q: string) {
    return this.employeesService.search(q);
  }

  // Includes inactive employees — for admin correction flows only (§39/§42).
  @Get('search-all')
  @RequirePermissions('CORRECT_RECORDS')
  searchAll(@Query('q') q: string) {
    return this.employeesService.searchIncludingInactive(q);
  }

  // Full active roster for the Security app's offline search fallback —
  // see EmployeesService.listActiveForOfflineCache. Registered before the
  // ':id' route below so it isn't swallowed by it. Same VIEW_DASHBOARD gate
  // as /search, since every role that can reach the recording screen
  // already holds it.
  @Get('offline-cache')
  @RequirePermissions('VIEW_DASHBOARD')
  offlineCache() {
    return this.employeesService.listActiveForOfflineCache();
  }

  @Get()
  @RequirePermissions('MANAGE_EMPLOYEES')
  findAll(@Query('skip') skip?: string, @Query('take') take?: string, @Query('q') q?: string) {
    return this.employeesService.findAll({
      skip: parseOptionalInt(skip, 'skip'),
      take: parseOptionalInt(take, 'take'),
      q,
    });
  }

  // VIEW_EMPLOYEE_HISTORY, not MANAGE_EMPLOYEES — this single-employee
  // lookup backs the Employee Details page (name/code header), which
  // Security can reach via the Dashboard's "View Employee Day" link even
  // though Security lacks MANAGE_EMPLOYEES. Gating this behind
  // MANAGE_EMPLOYEES silently broke that page (and therefore EMAIL
  // DETAILS) for Security — found in the 2026-09-04 audit.
  @Get(':id')
  @RequirePermissions('VIEW_EMPLOYEE_HISTORY')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.employeesService.findById(id);
  }

  @Post()
  @RequirePermissions('MANAGE_EMPLOYEES')
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: any) {
    return this.employeesService.create(dto, user.id);
  }

  @Put(':id')
  @RequirePermissions('MANAGE_EMPLOYEES')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmployeeDto, @CurrentUser() user: any) {
    return this.employeesService.update(id, dto, user.id);
  }

  @Patch(':id/deactivate')
  @RequirePermissions('MANAGE_EMPLOYEES')
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.employeesService.setActive(id, false, user.id);
  }

  @Patch(':id/reactivate')
  @RequirePermissions('MANAGE_EMPLOYEES')
  reactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.employeesService.setActive(id, true, user.id);
  }
}
