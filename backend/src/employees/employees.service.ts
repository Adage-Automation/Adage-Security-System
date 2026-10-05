import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { isEmail } from 'class-validator';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

// Search result cap decided deliberately (see project memory): keeps the
// guard's autocomplete list short enough to fit a phone screen without
// scrolling, per spec §7/§53.
const SEARCH_RESULT_LIMIT = 10;

@Injectable()
export class EmployeesService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  // Used by the Security ENTRY/EXIT selector — active employees only. A
  // blank query used to return nothing at all, so the dropdown stayed
  // empty until the guard typed something — clicking/focusing the search
  // box looked broken (no visual response at all). Now returns the first
  // page of active employees alphabetically instead, so the frontend can
  // show a "browse" list immediately on focus, before any typing. Found in
  // the 2026-09-21 UX pass.
  async search(query: string) {
    const trimmed = query?.trim() ?? '';
    return this.prisma.employee.findMany({
      where: {
        isActive: true,
        ...(trimmed
          ? {
              OR: [
                { employeeName: { contains: trimmed, mode: 'insensitive' as const } },
                { employeeCode: { contains: trimmed, mode: 'insensitive' as const } },
                { email: { contains: trimmed, mode: 'insensitive' as const } },
                { carNumber: { contains: trimmed, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      take: SEARCH_RESULT_LIMIT,
      orderBy: { employeeName: 'asc' },
    });
  }

  // Backs the Security app's offline employee-search fallback
  // (frontend/src/offline/employeeCache.ts) — the frontend caches this
  // full active roster locally while online, so a guard can still search
  // for and select someone while genuinely offline. The live /search
  // endpoint above is deliberately NetworkOnly in the service worker
  // (vite.config.ts) and unreachable offline at all, and without a local
  // copy a guard who opens the app offline — or goes offline before
  // picking a new employee — couldn't find anyone to record. No take
  // limit: unlike /search's 10-result autocomplete cap, this is meant to
  // be the full roster. Only the fields the search UI actually needs.
  // Found in the 2026-09-22 audit.
  async listActiveForOfflineCache() {
    return this.prisma.employee.findMany({
      where: { isActive: true },
      select: { id: true, employeeName: true, employeeCode: true, email: true, carNumber: true, isActive: true },
      orderBy: { employeeName: 'asc' },
    });
  }

  // Used by admin correction flows — includes inactive employees so
  // historical records can still be fixed after someone has left (§39/§42).
  // Same blank-query browse-list behavior as search() above.
  async searchIncludingInactive(query: string) {
    const trimmed = query?.trim() ?? '';
    return this.prisma.employee.findMany({
      where: trimmed
        ? {
            OR: [
              { employeeName: { contains: trimmed, mode: 'insensitive' as const } },
              { employeeCode: { contains: trimmed, mode: 'insensitive' as const } },
              { email: { contains: trimmed, mode: 'insensitive' as const } },
              { carNumber: { contains: trimmed, mode: 'insensitive' as const } },
            ],
          }
        : {},
      take: SEARCH_RESULT_LIMIT,
      orderBy: { employeeName: 'asc' },
    });
  }

  // The admin management list — unlike search()/searchIncludingInactive()
  // above (deliberately capped at 10 for the guard's fast autocomplete),
  // this browses/filters the FULL roster with real pagination. Found
  // missing in the 2026-09-09 workflow audit: once the roster grew from a
  // handful of employees to 205, the un-filterable, un-paginated default
  // (50 results, no way to reach the rest) silently made 155 employees
  // unreachable through this screen — exactly the "large employee
  // databases" case spec §53 calls out.
  async findAll(params: { skip?: number; take?: number; q?: string }) {
    const where = params.q?.trim()
      ? {
          OR: [
            { employeeName: { contains: params.q.trim(), mode: 'insensitive' as const } },
            { employeeCode: { contains: params.q.trim(), mode: 'insensitive' as const } },
            { email: { contains: params.q.trim(), mode: 'insensitive' as const } },
            { carNumber: { contains: params.q.trim(), mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        orderBy: { employeeName: 'asc' },
        skip: params.skip ?? 0,
        // Capped regardless of what the caller asks for — same gap already
        // fixed for GET /audit-logs (2026-09-25), missed here. Found in
        // the 2026-09-28 security audit.
        take: Math.min(params.take ?? 50, 200),
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { rows, total };
  }

  // Generates a fresh .xlsx of the full roster straight from the database,
  // on demand — an alternative to hand-maintaining `backend/data/employees.csv`
  // in sync with live edits made through this screen (Add/Edit/Deactivate).
  // That file only ever gets read (by the one-off import script), never
  // written back to from the running app, since the server's filesystem on
  // Render is ephemeral and isn't the same copy as the one in git — trying
  // to keep it "live" would mean committing to GitHub on every employee
  // edit. This export is the safe equivalent: always-current, generated
  // when actually needed, no ongoing sync to maintain. Includes inactive
  // employees (with their status shown) so this can double as a full
  // archive, not just the active roster. Found in the 2026-09-28 request.
  async exportToExcel(): Promise<Buffer> {
    const employees = await this.prisma.employee.findMany({ orderBy: { employeeName: 'asc' } });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Employees');
    sheet.columns = [
      { header: 'Employee Code', key: 'employeeCode', width: 16 },
      { header: 'Name', key: 'employeeName', width: 28 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Car Number', key: 'carNumber', width: 16 },
      { header: 'Status', key: 'status', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4F5' } };

    for (const emp of employees) {
      sheet.addRow({
        employeeCode: emp.employeeCode,
        employeeName: emp.employeeName,
        email: emp.email ?? '',
        carNumber: emp.carNumber ?? '',
        status: emp.isActive ? 'Active' : 'Inactive',
      });
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Blank Employees tab (headers only — no filled-in example row) so a
  // forgotten/not-deleted example row can never get imported as a real
  // employee. The example lives on a separate "Instructions" tab instead,
  // for reference only. HR downloads this, fills in new joiners, and
  // uploads it back via importFromExcel below. Found in the 2026-10-05
  // bulk-add request.
  async importTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();

    const sheet = workbook.addWorksheet('Employees');
    sheet.columns = [
      { header: 'Employee Code', key: 'employeeCode', width: 18 },
      { header: 'Name', key: 'employeeName', width: 28 },
      { header: 'Email', key: 'email', width: 32 },
      { header: 'Car Number', key: 'carNumber', width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4F5' } };

    const instructions = workbook.addWorksheet('Instructions');
    instructions.columns = [{ width: 95 }];
    instructions.addRows([
      ['How to use this template'],
      ['1. Fill in one row per new employee on the "Employees" tab. Do not change the header row or column order.'],
      ['2. "Employee Code" and "Name" are required for every row. Leave "Email" or "Car Number" blank if not known yet.'],
      ['3. Employee Code must be unique and cannot match an existing employee (not case-sensitive).'],
      ['4. Save the file, then upload it via "Import from Excel" on the Employees page.'],
      ['5. Example row for reference only — do not add this row to the Employees tab:'],
      ['   EMP206   |   Jane Doe   |   jane.doe@example.com   |   MH12AB1234'],
    ]);
    instructions.getRow(1).font = { bold: true, size: 13 };

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Row-by-row bulk import so one bad row (a typo, a code that already
  // exists) doesn't block the other 9 — each row is validated and created
  // independently and reported back with its own created/skipped+reason
  // result, rather than all-or-nothing. Deliberately reuses `create()`
  // (same trimming, same case-insensitive duplicate check, same audit log
  // entry) so this is a second caller of the existing single-add path, not
  // a parallel implementation that could drift from it. Rows are processed
  // sequentially (not Promise.all) so a duplicate code repeated twice in
  // the same file is caught by the second row's own DB check, the same way
  // it already would be via two separate manual Add-Employee submissions.
  // Found in the 2026-10-05 bulk-add request.
  async importFromExcel(buffer: Buffer, actingUserId: number) {
    const workbook = new ExcelJS.Workbook();
    try {
      // exceljs's bundled types predate Node 22's generic Buffer<T> —
      // harmless cast, not a real type mismatch.
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw new BadRequestException('Could not read this file — make sure it is a valid .xlsx file (download the import template for the exact format).');
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('The uploaded file has no sheets.');
    }

    const headerMap: Record<string, number> = {};
    sheet.getRow(1).eachCell((cell, colNumber) => {
      headerMap[String(cell.value ?? '').trim().toLowerCase()] = colNumber;
    });
    const codeCol = headerMap['employee code'];
    const nameCol = headerMap['name'];
    const emailCol = headerMap['email'];
    const carCol = headerMap['car number'];
    if (!codeCol || !nameCol) {
      throw new BadRequestException('The file must have "Employee Code" and "Name" columns — download the import template for the exact format.');
    }

    // Generous enough for any realistic batch (a department, a site, even a
    // whole year of joiners) while still bounding one request's work —
    // same reasoning as the `take` caps already enforced elsewhere.
    const MAX_ROWS = 1000;
    if (sheet.rowCount - 1 > MAX_ROWS) {
      throw new BadRequestException(`Too many rows — split into batches of ${MAX_ROWS} or fewer.`);
    }

    const cellText = (row: ExcelJS.Row, col: number | undefined) =>
      col ? String(row.getCell(col).value ?? '').trim() : '';

    const results: Array<{ row: number; employeeCode: string; employeeName: string; status: 'created' | 'skipped'; reason?: string }> = [];

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const employeeCode = cellText(row, codeCol);
      const employeeName = cellText(row, nameCol);
      const email = cellText(row, emailCol);
      const carNumber = cellText(row, carCol);

      if (!employeeCode && !employeeName && !email && !carNumber) continue; // fully blank row — skip silently, don't report

      if (!employeeCode || !employeeName) {
        results.push({ row: rowNumber, employeeCode, employeeName, status: 'skipped', reason: 'Employee Code and Name are both required' });
        continue;
      }
      if (email && !isEmail(email)) {
        results.push({ row: rowNumber, employeeCode, employeeName, status: 'skipped', reason: 'Invalid email format' });
        continue;
      }

      try {
        await this.create({ employeeCode, employeeName, email: email || undefined, carNumber: carNumber || undefined }, actingUserId);
        results.push({ row: rowNumber, employeeCode, employeeName, status: 'created' });
      } catch (err: any) {
        results.push({ row: rowNumber, employeeCode, employeeName, status: 'skipped', reason: err?.message ?? 'Failed to create' });
      }
    }

    return {
      created: results.filter((r) => r.status === 'created').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      results,
    };
  }

  async findById(id: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id } });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }

  // The DB's uniqueness constraint on employeeCode is case-sensitive, but
  // every search in the app matches case-insensitively — so "EMP001" and
  // "emp001" could otherwise both be created as distinct employees, both
  // surfacing together in every search and making report filenames/emails
  // ambiguous. Checked case-insensitively here so the DB constraint is
  // never actually relied on to catch this. Found in the 2026-09-21 audit.
  private async assertCodeAndEmailAvailable(employeeCode: string, email: string | null | undefined, excludingId?: number) {
    const codeClash = await this.prisma.employee.findFirst({
      where: { employeeCode: { equals: employeeCode, mode: 'insensitive' }, ...(excludingId ? { id: { not: excludingId } } : {}) },
    });
    if (codeClash) {
      throw new ConflictException('Employee code already exists');
    }
    if (email) {
      // Email has no DB uniqueness constraint at all (deliberately optional
      // field) — without this, two employees could share one email with no
      // warning, and a movement-record email could reach the wrong person.
      const emailClash = await this.prisma.employee.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, ...(excludingId ? { id: { not: excludingId } } : {}) },
      });
      if (emailClash) {
        throw new ConflictException(`That email address is already registered to ${emailClash.employeeName} (${emailClash.employeeCode}).`);
      }
    }
  }

  async create(dto: CreateEmployeeDto, actingUserId: number) {
    // Untrimmed whitespace (a stray trailing space from a copy-paste, a
    // leading space from autocomplete) would otherwise defeat the
    // case-insensitive duplicate check below — "EMP001" and "EMP001 " look
    // identical to a human but aren't equal strings, so HR could end up
    // with two silently-distinct employees for the same code. Found in the
    // 2026-10-05 HR-workflow audit.
    const data = {
      ...dto,
      employeeCode: dto.employeeCode.trim(),
      employeeName: dto.employeeName.trim(),
      email: dto.email?.trim() || undefined,
      carNumber: dto.carNumber?.trim() || undefined,
    };
    await this.assertCodeAndEmailAvailable(data.employeeCode, data.email);
    const employee = await this.prisma.employee.create({ data });
    await this.auditLog.record({
      userId: actingUserId,
      action: 'EMPLOYEE_CREATED',
      entityType: 'Employee',
      entityId: employee.id,
      newValue: employee,
    });
    return employee;
  }

  async update(id: number, dto: UpdateEmployeeDto, actingUserId: number) {
    const before = await this.findById(id);
    // `undefined` (key omitted) means "leave this field alone" — Prisma
    // drops undefined keys from the update entirely, so they're passed
    // through as-is. `null` (explicitly sent by the Edit form when the
    // user clears the field) means "clear it," and a non-null string gets
    // trimmed, collapsing to `null` too if it's blank after trimming
    // (whitespace-only input isn't meaningfully different from "cleared").
    // Previously both cases collapsed to `undefined`, so clearing the
    // Email or Car Number field in the Edit modal silently had no effect —
    // the request succeeded but the old value stayed in the database.
    // Found in the 2026-10-05 Employees-page audit.
    const data = {
      ...dto,
      employeeName: dto.employeeName?.trim(),
      email: dto.email === undefined ? undefined : dto.email?.trim() || null,
      carNumber: dto.carNumber === undefined ? undefined : dto.carNumber?.trim() || null,
    };
    if (data.email) {
      await this.assertCodeAndEmailAvailable(before.employeeCode, data.email, id);
    }
    const employee = await this.prisma.employee.update({ where: { id }, data });
    await this.auditLog.record({
      userId: actingUserId,
      action: 'EMPLOYEE_UPDATED',
      entityType: 'Employee',
      entityId: employee.id,
      oldValue: before,
      newValue: employee,
    });
    return employee;
  }

  async setActive(id: number, isActive: boolean, actingUserId: number) {
    const before = await this.findById(id);
    const employee = await this.prisma.employee.update({ where: { id }, data: { isActive } });
    await this.auditLog.record({
      userId: actingUserId,
      action: isActive ? 'EMPLOYEE_REACTIVATED' : 'EMPLOYEE_DEACTIVATED',
      entityType: 'Employee',
      entityId: employee.id,
      oldValue: before,
      newValue: employee,
    });
    return employee;
  }
}
