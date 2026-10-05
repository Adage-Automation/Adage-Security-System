import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
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

  // Registered before ':id' below so it isn't swallowed by it (same
  // reasoning as 'offline-cache' above). Generates the .xlsx fresh from the
  // database on every call — see EmployeesService.exportToExcel.
  @Get('export')
  @RequirePermissions('MANAGE_EMPLOYEES')
  async export(@Res() res: Response) {
    const buffer = await this.employeesService.exportToExcel();
    const filename = `employees-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  // Registered before ':id' below so it isn't swallowed by it (same
  // reasoning as 'export' above). Blank-headers-only workbook — see
  // EmployeesService.importTemplate for why no filled-in example row.
  @Get('import-template')
  @RequirePermissions('MANAGE_EMPLOYEES')
  async importTemplate(@Res() res: Response) {
    const buffer = await this.employeesService.importTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="employee-import-template.xlsx"',
    });
    res.send(buffer);
  }

  // 2MB comfortably covers a few thousand rows of plain text — far more
  // than the 1000-row cap importFromExcel itself enforces, so this is just
  // a cheap first line of defense against an accidental/oversized upload.
  @Post('import')
  @RequirePermissions('MANAGE_EMPLOYEES')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } }))
  async import(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: any) {
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }
    return this.employeesService.importFromExcel(file.buffer, user.id);
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
