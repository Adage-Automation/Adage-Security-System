import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
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

  // Used by the Security ENTRY/EXIT selector — active employees only.
  async search(query: string) {
    if (!query || query.trim().length === 0) {
      return [];
    }
    return this.prisma.employee.findMany({
      where: {
        isActive: true,
        OR: [
          { employeeName: { contains: query, mode: 'insensitive' } },
          { employeeCode: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { carNumber: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: SEARCH_RESULT_LIMIT,
      orderBy: { employeeName: 'asc' },
    });
  }

  // Used by admin correction flows — includes inactive employees so
  // historical records can still be fixed after someone has left (§39/§42).
  async searchIncludingInactive(query: string) {
    if (!query || query.trim().length === 0) {
      return [];
    }
    return this.prisma.employee.findMany({
      where: {
        OR: [
          { employeeName: { contains: query, mode: 'insensitive' } },
          { employeeCode: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { carNumber: { contains: query, mode: 'insensitive' } },
        ],
      },
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
        take: params.take ?? 50,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { rows, total };
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
  private async assertCodeAndEmailAvailable(employeeCode: string, email: string | undefined, excludingId?: number) {
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
    await this.assertCodeAndEmailAvailable(dto.employeeCode, dto.email);
    const employee = await this.prisma.employee.create({ data: dto });
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
    if (dto.email) {
      await this.assertCodeAndEmailAvailable(before.employeeCode, dto.email, id);
    }
    const employee = await this.prisma.employee.update({ where: { id }, data: dto });
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
