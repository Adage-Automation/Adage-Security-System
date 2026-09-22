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

// How far a client-claimed offline tap time is allowed to diverge from the
// server clock before it's discarded in favor of `new Date()`. Bounds how
// far a device could backdate/postdate a record — 7 days comfortably
// covers an extended offline stretch (leave, a broken phone sitting
// unused) on company-managed devices, where the spoofing risk this bound
// guards against is lower than on an open/personal device. Raised from
// 48h, 2026-09-22 — see docs/decisions.md.
const MAX_CLIENT_TIMESTAMP_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CLIENT_TIMESTAMP_FUTURE_MS = 5 * 60 * 1000;

@Injectable()
export class MovementsService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  // Never trusts a client timestamp for a live/online tap (dto without
  // clientMovementAt) — only the offline-queue sync path sends one, and
  // even then only within a plausible window. Outside that window the tap
  // still gets recorded, just with the server's own clock instead of
  // being rejected — a timestamp technicality must never lose a guard's
  // tap. See docs/decisions.md.
  private resolveMovementTimestamp(clientMovementAt?: string): { movementAt: Date; recordedOffline: boolean } {
    if (!clientMovementAt) {
      return { movementAt: new Date(), recordedOffline: false };
    }
    const claimed = new Date(clientMovementAt);
    const now = Date.now();
    const withinBounds =
      !Number.isNaN(claimed.getTime()) &&
      claimed.getTime() >= now - MAX_CLIENT_TIMESTAMP_PAST_MS &&
      claimed.getTime() <= now + MAX_CLIENT_TIMESTAMP_FUTURE_MS;
    return withinBounds ? { movementAt: claimed, recordedOffline: true } : { movementAt: new Date(), recordedOffline: false };
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

    // Server is authoritative for the timestamp on a live tap (§20, §46).
    // The offline-queue sync path is the one exception — see
    // resolveMovementTimestamp above.
    const { movementAt, recordedOffline } = this.resolveMovementTimestamp(dto.clientMovementAt);

    // Two guards on two different devices can tap for the same employee
    // within the same instant — a real scenario with several devices in
    // the field, not just single-device double-tap (already guarded on
    // the frontend). Without serializing per employee, both requests could
    // read "last movement" before either commits, both miss the
    // duplicate-type check below, and both create a record with no
    // warning shown to either guard. A Postgres advisory lock scoped to
    // this transaction serializes concurrent requests for the SAME
    // employee only — any other employee's tap proceeds immediately,
    // uncontended — and releases automatically when the transaction ends,
    // success or failure. Found in the 2026-09-22 audit.
    const outcome = await this.prisma.$transaction(async (tx) => {
      // $executeRaw, not $queryRaw: pg_advisory_xact_lock() returns void,
      // which $queryRaw can't deserialize into a Prisma row (throws
      // P2010 "Failed to deserialize column of type 'void'") — caught by
      // testing this against the real database, not just the mocked
      // unit test. $executeRaw doesn't try to parse a result set.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${dto.employeeId})`;

      // Idempotency replay (found in the 2026-09-09 audit): if this exact
      // guard tap already succeeded — e.g. the connection dropped after
      // the server committed but before the client read the response —
      // the retry (including the offline queue's auto-confirm-on-sync
      // path) must return the existing record rather than create a
      // genuine duplicate ENTRY/EXIT. Re-checked here, inside the lock,
      // in case a concurrent replay of the same clientRequestId committed
      // while this request was waiting for the lock.
      if (dto.clientRequestId) {
        const existing = await tx.movementRecord.findUnique({
          where: { clientRequestId: dto.clientRequestId },
          include: { employee: true },
        });
        if (existing) {
          if (existing.employeeId !== dto.employeeId || existing.movementType !== dto.movementType || existing.recordedByUserId !== recordedByUserId) {
            throw new ConflictException('clientRequestId is already associated with a different movement');
          }
          return { kind: 'replay' as const, record: existing };
        }
      }

      const last = await tx.movementRecord.findFirst({
        where: { employeeId: dto.employeeId, isSuperseded: false },
        orderBy: { movementAt: 'desc' },
      });

      if (last && last.movementType === dto.movementType && !dto.confirmed) {
        return { kind: 'confirm' as const, lastMovementType: last.movementType as 'ENTRY' | 'EXIT' };
      }

      try {
        const record = await tx.movementRecord.create({
          data: {
            employeeId: dto.employeeId,
            movementType: dto.movementType,
            movementAt,
            recordedOffline,
            recordedByUserId,
            clientRequestId: dto.clientRequestId,
          },
          include: { employee: true },
        });
        return { kind: 'created' as const, record };
      } catch (err: any) {
        // Defense-in-depth: the advisory lock above already serializes
        // same-employee requests, so this shouldn't be reachable in
        // practice anymore, but a clientRequestId collision constraint
        // violation is still handled the same as a normal idempotency
        // replay rather than surfacing as a hard error.
        if (err?.code === 'P2002' && dto.clientRequestId) {
          const existing = await tx.movementRecord.findUnique({
            where: { clientRequestId: dto.clientRequestId },
            include: { employee: true },
          });
          if (existing) {
            if (existing.employeeId !== dto.employeeId || existing.movementType !== dto.movementType || existing.recordedByUserId !== recordedByUserId) {
              throw new ConflictException('clientRequestId is already associated with a different movement');
            }
            return { kind: 'replay' as const, record: existing };
          }
        }
        throw err;
      }
    });

    if (outcome.kind === 'confirm') {
      return { created: false, requiresConfirmation: true, lastMovementType: outcome.lastMovementType };
    }
    if (outcome.kind === 'replay') {
      return { created: true, requiresConfirmation: false, record: outcome.record };
    }

    await this.auditLog.record({
      userId: recordedByUserId,
      action: dto.movementType === 'ENTRY' ? 'ENTRY_RECORDED' : 'EXIT_RECORDED',
      entityType: 'MovementRecord',
      entityId: outcome.record.id,
      newValue: outcome.record,
      ipAddress: ip,
      userAgent,
    });

    return { created: true, requiresConfirmation: false, record: outcome.record };
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
