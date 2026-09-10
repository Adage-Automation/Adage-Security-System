import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { dayRange } from '../common/utils/day-range';
import { CreateMovementDto, CorrectMovementDto } from './dto/movement.dto';

export interface CreateMovementResult {
  created: boolean;
  requiresConfirmation: boolean;
  lastMovementType?: 'ENTRY' | 'EXIT';
  record?: any;
}

@Injectable()
export class MovementsService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  private async getLastMovement(employeeId: number) {
    return this.prisma.movementRecord.findFirst({
      where: { employeeId, isSuperseded: false },
      orderBy: { movementAt: 'desc' },
    });
  }

  // Confirm-before-save flow (§43, decided deliberately): if the
  // employee's last movement is the same type and the caller hasn't
  // confirmed yet, we return a warning WITHOUT creating a record. The
  // frontend shows a confirmation popup and resubmits with confirmed=true.
  async createMovement(dto: CreateMovementDto, recordedByUserId: number, ip?: string, userAgent?: string): Promise<CreateMovementResult> {
    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    // Idempotency replay (found in the 2026-09-09 audit): if this exact
    // guard tap already succeeded — e.g. the connection dropped after the
    // server committed but before the client read the response — the
    // retry (including the offline queue's auto-confirm-on-sync path)
    // must return the existing record rather than create a genuine
    // duplicate ENTRY/EXIT. This check runs before the duplicate-type
    // warning below, since a replay isn't a new tap to warn about.
    if (dto.clientRequestId) {
      const existing = await this.prisma.movementRecord.findUnique({
        where: { clientRequestId: dto.clientRequestId },
        include: { employee: true },
      });
      if (existing) {
        if (existing.employeeId !== dto.employeeId || existing.movementType !== dto.movementType || existing.recordedByUserId !== recordedByUserId) {
          throw new ConflictException('clientRequestId is already associated with a different movement');
        }
        return { created: true, requiresConfirmation: false, record: existing };
      }
    }

    const last = await this.getLastMovement(dto.employeeId);

    if (last && last.movementType === dto.movementType && !dto.confirmed) {
      return {
        created: false,
        requiresConfirmation: true,
        lastMovementType: last.movementType as 'ENTRY' | 'EXIT',
      };
    }

    // Server is authoritative for the timestamp — the frontend can never
    // supply the official movement time (§20, §46).
    let record;
    try {
      record = await this.prisma.movementRecord.create({
        data: {
          employeeId: dto.employeeId,
          movementType: dto.movementType,
          movementAt: new Date(),
          recordedByUserId,
          clientRequestId: dto.clientRequestId,
        },
        include: { employee: true },
      });
    } catch (err: any) {
      // Race: two near-simultaneous requests carrying the same
      // clientRequestId (e.g. a retry firing just as the first request's
      // commit lands) both pass the check above before either commits.
      // The unique constraint catches what the check couldn't; treat it
      // the same as a normal idempotency replay rather than a hard error.
      if (err?.code === 'P2002' && dto.clientRequestId) {
        const existing = await this.prisma.movementRecord.findUnique({
          where: { clientRequestId: dto.clientRequestId },
          include: { employee: true },
        });
        if (existing) {
          if (existing.employeeId !== dto.employeeId || existing.movementType !== dto.movementType || existing.recordedByUserId !== recordedByUserId) {
            throw new ConflictException('clientRequestId is already associated with a different movement');
          }
          return { created: true, requiresConfirmation: false, record: existing };
        }
      }
      throw err;
    }

    await this.auditLog.record({
      userId: recordedByUserId,
      action: dto.movementType === 'ENTRY' ? 'ENTRY_RECORDED' : 'EXIT_RECORDED',
      entityType: 'MovementRecord',
      entityId: record.id,
      newValue: record,
      ipAddress: ip,
      userAgent,
    });

    return { created: true, requiresConfirmation: false, record };
  }

  async listByEmployeeAndDate(employeeId: number, date: string) {
    const { start, end } = dayRange(date);
    return this.prisma.movementRecord.findMany({
      where: {
        employeeId,
        isSuperseded: false,
        movementAt: { gte: start, lt: end },
      },
      orderBy: { movementAt: 'asc' },
      include: { recordedBy: { select: { id: true, name: true } } },
    });
  }

  async listWithFilters(params: { date?: string; employeeId?: number; movementType?: 'ENTRY' | 'EXIT' }) {
    const where: any = { isSuperseded: false };
    if (params.date) {
      const { start, end } = dayRange(params.date);
      where.movementAt = { gte: start, lt: end };
    }
    if (params.employeeId) {
      where.employeeId = params.employeeId;
    }
    if (params.movementType) {
      where.movementType = params.movementType;
    }
    return this.prisma.movementRecord.findMany({
      where,
      orderBy: { movementAt: 'desc' },
      include: {
        employee: { select: { id: true, employeeName: true, employeeCode: true } },
        recordedBy: { select: { id: true, name: true } },
      },
    });
  }

  async summaryForDate(date: string) {
    const { start, end } = dayRange(date);
    const records = await this.prisma.movementRecord.findMany({
      where: { isSuperseded: false, movementAt: { gte: start, lt: end } },
      select: { employeeId: true, movementType: true, movementAt: true },
      orderBy: { movementAt: 'asc' },
    });
    const uniqueEmployees = new Set(records.map((r) => r.employeeId));

    // "Currently inside": among employees who moved on this date, whoever's
    // LAST movement was an ENTRY hasn't been recorded leaving yet. Only
    // meaningful for today — a past date's "currently inside" count is
    // shown as historical context (who hadn't exited by end of that day),
    // not a live figure.
    const lastMovementByEmployee = new Map<number, 'ENTRY' | 'EXIT'>();
    for (const r of records) {
      lastMovementByEmployee.set(r.employeeId, r.movementType as 'ENTRY' | 'EXIT');
    }
    const currentlyInside = [...lastMovementByEmployee.values()].filter((t) => t === 'ENTRY').length;

    return {
      totalEmployees: uniqueEmployees.size,
      totalEntries: records.filter((r) => r.movementType === 'ENTRY').length,
      totalExits: records.filter((r) => r.movementType === 'EXIT').length,
      currentlyInside,
    };
  }

  // Append-only correction (§42, decided deliberately): the original row
  // is never mutated. It's flagged superseded and a new record is created
  // and linked back to it, preserving full history for the audit log.
  async correctMovement(originalId: number, dto: CorrectMovementDto, correctedByUserId: number) {
    const original = await this.prisma.movementRecord.findUnique({ where: { id: originalId } });
    if (!original) {
      throw new NotFoundException('Movement record not found');
    }
    // Without this, a stale/invalid employeeId reaches Prisma and throws an
    // unhandled FK-violation error (raw 500) instead of a clean 404 —
    // found in the 2026-09-04 audit.
    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const [, corrected] = await this.prisma.$transaction([
      this.prisma.movementRecord.update({
        where: { id: originalId },
        data: { isSuperseded: true },
      }),
      this.prisma.movementRecord.create({
        data: {
          employeeId: dto.employeeId,
          movementType: dto.movementType,
          movementAt: new Date(dto.movementAt),
          recordedByUserId: original.recordedByUserId,
          correctionOfId: originalId,
          correctedByUserId,
          correctionReason: dto.correctionReason,
        },
      }),
    ]);

    await this.auditLog.record({
      userId: correctedByUserId,
      action: 'RECORD_CORRECTED',
      entityType: 'MovementRecord',
      entityId: corrected.id,
      oldValue: original,
      newValue: corrected,
    });

    return corrected;
  }

  // Adds a movement missed entirely (e.g. guard forgot to record it) —
  // not a correction of an existing row, so no supersede chain.
  async addMissingRecord(dto: CorrectMovementDto, createdByUserId: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const record = await this.prisma.movementRecord.create({
      data: {
        employeeId: dto.employeeId,
        movementType: dto.movementType,
        movementAt: new Date(dto.movementAt),
        recordedByUserId: createdByUserId,
        correctedByUserId: createdByUserId,
        correctionReason: dto.correctionReason,
      },
    });

    await this.auditLog.record({
      userId: createdByUserId,
      action: 'MISSING_RECORD_ADDED',
      entityType: 'MovementRecord',
      entityId: record.id,
      newValue: record,
    });

    return record;
  }
}

// NOTE: dayRange() (imported above, backend/src/common/utils/day-range.ts)
// relies on the server process running in APP_TIMEZONE (Asia/Kolkata) so
// local midnight boundaries match the company's day. Deploy with TZ set
// accordingly, or switch to explicit UTC↔IST conversion if the server ever
// runs in a different timezone than the configured one.
