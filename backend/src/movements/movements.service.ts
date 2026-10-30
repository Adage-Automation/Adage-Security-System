import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { dayRange, dateRangeInclusive, formatDateInAppTimezone, formatTimeInAppTimezone, todayInAppTimezone } from '../common/utils/day-range';
import { CreateMovementDto, AddMissingRecordDto } from './dto/movement.dto';

export interface CreateMovementResult {
  created: boolean;
  requiresConfirmation: boolean;
  lastMovementType?: 'ENTRY' | 'EXIT';
  // The existing record's own timestamp — lets the frontend's duplicate-
  // confirmation dialog show "Last recorded: ENTRY at 9:03 AM" instead of
  // just the bare type, so the guard isn't confirming blind. Added in the
  // 2026-09-22 UX audit.
  lastMovementAt?: Date;
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
        return { kind: 'confirm' as const, lastMovementType: last.movementType as 'ENTRY' | 'EXIT', lastMovementAt: last.movementAt };
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
    }, {
      // Prisma's defaults (5s transaction timeout, 2s max wait to even
      // start) are sized for a typical single-row transaction, not one
      // that can queue up behind a per-employee advisory lock under a
      // burst of concurrent taps for the SAME employee (e.g. several
      // devices' offline queues syncing at once after a shared outage,
      // all queued for one person). Widened so that queue depth alone
      // doesn't turn into a generic transaction-timeout 500 the guard
      // has to manually retry. Found in the 2026-09-23 audit.
      maxWait: 10_000,
      timeout: 20_000,
    });

    if (outcome.kind === 'confirm') {
      return { created: false, requiresConfirmation: true, lastMovementType: outcome.lastMovementType, lastMovementAt: outcome.lastMovementAt };
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

  // Backs the Missing Movements page's own list of "who actually needs
  // something added" — scoped to CORRECT_RECORDS (the same permission
  // that gates the rest of this page) rather than reusing Insights'
  // richer `/insights/daily-duration`, which needs VIEW_REPORTS. Security
  // holds CORRECT_RECORDS but deliberately not VIEW_REPORTS (that still
  // gates the separate, HR/Admin-only workforce-analytics dashboard) —
  // added 2026-10-26, by request, so this list can't quietly need a
  // permission Security was never meant to have.
  //
  // ORDER-AWARE per calendar day, not a raw entry/exit count — same rule
  // the frontend's own "which type is missing" check and addMissingRecord's
  // duplicate check below both use, and the same rule Insights'
  // isMissingExit/isDayComplete already used (a count comparison was tried
  // first, 2026-10-26, but a real production record showed it wrong: two
  // ENTRY taps at the exact same minute — almost certainly one offline-sync
  // duplicate and one live tap for the same arrival, a known class of noise
  // — followed by one genuine EXIT reads as "entries=2, exits=1" and got
  // wrongly flagged missingExit, even though the day is actually complete.
  // A duplicate tap of either type is just noise, not a second real
  // session, so only the day's FIRST and LAST movement type matter: ending
  // on ENTRY means a session is still open (missingExit); starting on EXIT
  // (and not also ending open) means there's an orphan exit nothing
  // explains (missingEntry). This still catches the original entry/exit/
  // entry report (ends on ENTRY) and an entry/entry/exit/exit day (two
  // real, fully-closed sessions, correctly excluded) just as well as a
  // naive count would have, without this false positive. All three call
  // sites must agree on what "missing" means or the list can tell someone
  // to add a record the write path then rejects.
  //
  // Takes a range (not just one date) so the page's Attendance Month view
  // can show every gap across the whole 26th-25th cycle in one list, not
  // just whichever single day happens to be selected. `from === to` for
  // the page's plain single-date view — same query shape either way, one
  // path to maintain. Widened from a single `date` param 2026-10-26, by
  // request.
  async missingInRange(from: string, to: string) {
    const { start, end } = dateRangeInclusive(from, to);
    const movements = await this.prisma.movementRecord.findMany({
      where: { isSuperseded: false, movementAt: { gte: start, lt: end } },
      select: {
        employeeId: true,
        movementType: true,
        movementAt: true,
        employee: { select: { employeeName: true, employeeCode: true, team: true } },
      },
      // Chronological order is load-bearing here — firstType/lastType below
      // only mean "the day's first/last movement" if the rows arrive in
      // that order. `id` as a secondary key breaks ties deterministically
      // for two DIFFERENT movementTypes sharing the exact same movementAt
      // (Postgres doesn't otherwise guarantee a stable order for equal
      // sort values) — not just theoretical: Add Missing Record's modal
      // defaults its time field to 09:00, so two separately-added records
      // for the same employee/day can easily land on the exact same
      // minute if nobody changes it. Two rows of the SAME movementType
      // tying (the duplicate-tap case this rule exists for) are unaffected
      // either way. Checked against all of production, 2026-10-26: no
      // mixed-type ties exist today, but nothing before this fix stopped
      // one from appearing.
      orderBy: [{ movementAt: 'asc' }, { id: 'asc' }],
    });

    const byDayAndEmployee = new Map<
      string,
      {
        date: string;
        employeeId: number;
        employeeName: string;
        employeeCode: string;
        team: string | null;
        firstType: 'ENTRY' | 'EXIT';
        lastType: 'ENTRY' | 'EXIT';
        firstMovementAt: Date;
        lastMovementAt: Date;
        // Set by the stitching pass below when this day's orphan leading
        // exit (firstType === 'EXIT') is explained by the PREVIOUS day's
        // dangling open entry — the same shift Insights' own
        // stitchOvernightSessions already credits the hours to. Added
        // 2026-10-30.
        entryResolvedByStitch: boolean;
        // Set on the OTHER end of the same stitch: this day's dangling
        // open entry (lastType === 'ENTRY') is explained by the NEXT day's
        // orphan leading exit.
        exitResolvedByStitch: boolean;
      }
    >();
    for (const m of movements) {
      if (!m.employee) continue;
      const date = formatDateInAppTimezone(m.movementAt);
      const key = `${date}|${m.employeeId}`;
      const bucket = byDayAndEmployee.get(key);
      if (!bucket) {
        byDayAndEmployee.set(key, {
          date,
          employeeId: m.employeeId,
          employeeName: m.employee.employeeName,
          employeeCode: m.employee.employeeCode,
          team: m.employee.team,
          firstType: m.movementType as 'ENTRY' | 'EXIT',
          lastType: m.movementType as 'ENTRY' | 'EXIT',
          firstMovementAt: m.movementAt,
          lastMovementAt: m.movementAt,
          entryResolvedByStitch: false,
          exitResolvedByStitch: false,
        });
      } else {
        bucket.lastType = m.movementType as 'ENTRY' | 'EXIT';
        bucket.lastMovementAt = m.movementAt;
      }
    }

    // Mirrors Insights' stitchOvernightSessions (insights.service.ts) —
    // kept as a separate implementation, not a shared call, since this
    // service has its own simpler per-day shape (no EmpDayAgg/hours
    // computation to piggyback on). Without this, a day resolved by the
    // overnight-exit checkbox (Corrections modal) would keep showing here
    // as missingEntry forever: this list has no idea the orphan exit it's
    // looking at was already matched to yesterday's open entry. Only
    // crosses one calendar day, and only sees whatever `from`/`to` range
    // was already queried — same range-edge limitation Insights' version
    // has, see its own comment. Added 2026-10-30, by request.
    for (const bucket of byDayAndEmployee.values()) {
      if (bucket.firstType !== 'EXIT') continue;
      const prevKey = `${this.previousDateStr(bucket.date)}|${bucket.employeeId}`;
      const prev = byDayAndEmployee.get(prevKey);
      if (!prev || prev.lastType !== 'ENTRY') continue;
      if (prev.lastMovementAt >= bucket.firstMovementAt) continue;
      bucket.entryResolvedByStitch = true;
      prev.exitResolvedByStitch = true;
    }

    // A `missingExit` on TODAY specifically is ambiguous — the employee may
    // simply still be on-site, shift not yet over, not a genuine gap at
    // all. Excluded here (not just a frontend warning banner) so the list
    // only ever shows a day once it's actually settled; `missingEntry` (an
    // orphan exit with no matching entry) is a structural anomaly
    // regardless of whether the day is still in progress, so it's still
    // shown for today. Added 2026-10-26, by request.
    const today = todayInAppTimezone();
    return [...byDayAndEmployee.values()]
      .map((b) => ({
        ...b,
        // These two used to be coded as mutually exclusive (missingEntry
        // required lastType !== 'ENTRY'), but a day can genuinely have
        // both: an orphan EXIT at the start (firstType === 'EXIT') AND a
        // still-open session at the end (lastType === 'ENTRY') are two
        // independent gaps, not one. The old code reported only
        // missingExit for that shape — fixing the exit made the day
        // reappear next refresh as missingEntry, two passes for one day
        // with no indication the first fix was partial. Found in the
        // 2026-10-28 audit.
        //
        // Self-suppress once the stitching pass above explains the gap —
        // same idea as Insights' isMissingExit/isMissingEntry. Added
        // 2026-10-30.
        missingExit: b.lastType === 'ENTRY' && b.date !== today && !b.exitResolvedByStitch,
        missingEntry: b.firstType === 'EXIT' && !b.entryResolvedByStitch,
      }))
      .filter((b) => b.missingExit || b.missingEntry)
      .map((b) => ({
        date: b.date,
        employeeId: b.employeeId,
        employeeName: b.employeeName,
        employeeCode: b.employeeCode,
        team: b.team,
        status: (b.missingExit && b.missingEntry ? 'missingBoth' : b.missingExit ? 'missingExit' : 'missingEntry') as
          | 'missingExit'
          | 'missingEntry'
          | 'missingBoth',
      }))
      .sort((a, b) => (a.date === b.date ? a.employeeName.localeCompare(b.employeeName) : a.date.localeCompare(b.date)));
  }

  // Identical to Insights' own private helper of the same name
  // (insights.service.ts) — kept duplicated rather than shared, since
  // pulling one function into a common module isn't worth a cross-module
  // dependency between these two otherwise-independent services for three
  // lines.
  private previousDateStr(dateStr: string): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  async listByEmployeeAndDate(employeeId: number, date: string) {
    const { start, end } = dayRange(date);
    return this.prisma.movementRecord.findMany({
      where: {
        employeeId,
        isSuperseded: false,
        movementAt: { gte: start, lt: end },
      },
      // `id` as a secondary key — Corrections.tsx's missingTypes reads
      // this result's first/last record to decide what's missing, so a
      // deterministic order matters here the same way it does in
      // missingInRange/addMissingRecord above, not just for display.
      orderBy: [{ movementAt: 'asc' }, { id: 'asc' }],
      // `correctedBy` (plus the already-unselected-by-default scalar
      // `correctionReason`) lets the frontend flag a record that was
      // backfilled via Missing Movements rather than tapped live — see
      // AddedBadge. Added 2026-10-26, by request, now that Security (not
      // just Admin) can add these.
      include: { recordedBy: { select: { id: true, name: true } }, correctedBy: { select: { id: true, name: true } } },
    });
  }

  async listWithFilters(params: { date?: string; employeeId?: number; movementType?: 'ENTRY' | 'EXIT'; recordedByUserId?: number }) {
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
    if (params.recordedByUserId) {
      where.recordedByUserId = params.recordedByUserId;
    }
    return this.prisma.movementRecord.findMany({
      where,
      orderBy: { movementAt: 'desc' },
      include: {
        employee: { select: { id: true, employeeName: true, employeeCode: true } },
        recordedBy: { select: { id: true, name: true } },
        correctedBy: { select: { id: true, name: true } },
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

  // Admin correction, narrowed by request (2026-10-23): previously an
  // admin could "correct" ANY existing record's type/time (append-only —
  // the original was superseded and a replacement inserted), covering
  // both "guard tapped the wrong button" and "guard forgot to tap
  // entirely". That first case is now removed — a record that already
  // has a real recorded time can never be changed, full stop. Only a true
  // gap (the employee has no ENTRY, no EXIT, or neither, for that day)
  // can be filled in. The old correctMovement()/supersede-chain code (and
  // its `/movements/:id/correct` endpoint) is deleted outright rather
  // than kept dead, per the same reasoning that motivated it being
  // tightened in the first place — a removed capability shouldn't still
  // be reachable through a request a stale client or a crafted body could
  // send. `isSuperseded`/`correctionOfId` stay in the schema only for
  // historical rows created before this change.
  async addMissingRecord(dto: AddMissingRecordDto, createdByUserId: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const movementAt = new Date(dto.movementAt);
    const calendarDate = formatDateInAppTimezone(movementAt);
    const { start, end } = dayRange(calendarDate);

    // The authoritative enforcement of "only a true gap can be filled" —
    // never rely on the frontend alone to only offer the missing type(s).
    // Order-aware, not a raw count (2026-10-26 fix, matching missingInRange
    // above — a plain count comparison was tried first the same day, but a
    // real production record showed it wrong: two ENTRY taps at the same
    // minute, a known duplicate-tap/offline-sync pattern, followed by one
    // genuine EXIT reads as "2 entries, 1 exit" and would have wrongly kept
    // offering/accepting a second EXIT add on an already-complete day).
    // Only the day's first and last movement type matter: a trailing ENTRY
    // with nothing after it is missing an EXIT; a day that started on an
    // EXIT has an orphan EXIT missing its ENTRY. These two are independent,
    // not mutually exclusive — a day can be missing both (orphan leading
    // EXIT AND a still-open trailing ENTRY), so each is checked on its own
    // rather than one gating the other (fixed 2026-10-28; the gated version
    // wrongly rejected the fix for one of the two gaps as "already
    // covered"). A day with zero records of either type is wide open —
    // both are missing, so either can be added first.
    //
    // Wrapped in the same per-employee advisory lock createMovement uses
    // (2026-09-22 audit) — without it, a guard's live tap for this exact
    // employee/type/day could land between the check below and the create,
    // recreating the very duplicate this check exists to prevent. An admin
    // filling this form is rare enough that the race is narrow, but the
    // lock is nearly free and this app already has the pattern, so there's
    // no reason to leave the gap open. Found in the 2026-10-23 audit.
    const record = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${dto.employeeId})`;

      const dayRecords = await tx.movementRecord.findMany({
        where: { employeeId: dto.employeeId, isSuperseded: false, movementAt: { gte: start, lt: end } },
        select: { movementType: true, movementAt: true },
        // `id` tiebreaks two different movementTypes sharing the exact
        // same movementAt deterministically — see the matching comment on
        // missingInRange above for why this isn't just theoretical.
        orderBy: [{ movementAt: 'asc' }, { id: 'asc' }],
      });
      // Independent, not mutually exclusive — a day can be missing both
      // (orphan leading EXIT and a still-open trailing ENTRY at once).
      // This used to gate missingEntry on `!missingExit`, so on exactly
      // that kind of day, adding the ENTRY that closes the leading orphan
      // exit was wrongly rejected as "already covered" (missingEntry
      // computed false because missingExit was true) — the write path
      // disagreed with the list/UI fix for the identical bug made earlier
      // the same day. Found in the 2026-10-28 audit, same pass.
      const missingExit = dayRecords.length === 0 || dayRecords[dayRecords.length - 1].movementType === 'ENTRY';
      const missingEntry = dayRecords.length === 0 || dayRecords[0].movementType === 'EXIT';
      // A day that already has its own complete session can still take a
      // SEPARATE, earlier orphan EXIT — the overnight-shift-crossing-
      // midnight case, where the previous day's real exit lands after
      // midnight, before this day's own first record (Corrections' "Exit
      // was after midnight" checkbox). Insights' stitching then matches it
      // back to the previous day's open entry. Only valid if this day
      // doesn't already start on an orphan EXIT itself — one leading
      // orphan per day, same as the no-stitch case. Added 2026-10-30, by
      // request — without this, the checkbox only worked when the next
      // day had zero records at all, not the common case of a normal
      // shift the next day.
      const canAddLeadingOrphanExit = dto.movementType === 'EXIT' && dayRecords.length > 0 && dayRecords[0].movementType !== 'EXIT';
      const alreadyCovered = dto.movementType === 'EXIT' ? !missingExit && !canAddLeadingOrphanExit : !missingEntry;
      if (alreadyCovered) {
        throw new BadRequestException(`An ${dto.movementType} is already recorded for this employee on ${calendarDate} — nothing missing to add.`);
      }

      // The check above only confirmed a gap exists — not that the
      // timestamp being written actually closes it. A missing EXIT must
      // land after the day's last record, or the day still reads as
      // ENTRY-last (still "missing exit") and the real orphan is now
      // buried under a second record; symmetrically a missing ENTRY must
      // land before the day's first record. Found in the 2026-10-28 audit:
      // the frontend's modal defaults every add to 09:00 regardless of
      // type, which fails exactly this check for a post-09:00 entry or a
      // pre-09:00 orphan exit (the common overnight-shift case).
      if (dayRecords.length > 0) {
        const last = dayRecords[dayRecords.length - 1];
        const first = dayRecords[0];
        if (dto.movementType === 'EXIT') {
          // Two disjoint valid shapes for an EXIT now: closing the day's
          // trailing gap (after its last record), or — only when the day
          // already has its own complete session — a new leading orphan
          // from a separate, earlier shift (before its first record).
          const closesTrailingGap = missingExit && movementAt > last.movementAt;
          const addsLeadingOrphan = canAddLeadingOrphanExit && movementAt < first.movementAt;
          if (!closesTrailingGap && !addsLeadingOrphan) {
            throw new BadRequestException(
              missingExit
                ? `This EXIT (${formatTimeInAppTimezone(movementAt)}) must be after the day's last recorded movement (${formatTimeInAppTimezone(last.movementAt)}) to actually close the gap.`
                : `This EXIT (${formatTimeInAppTimezone(movementAt)}) must be before the day's first recorded movement (${formatTimeInAppTimezone(first.movementAt)}) to count as a separate, earlier shift.`,
            );
          }
        }
        if (dto.movementType === 'ENTRY' && movementAt >= first.movementAt) {
          throw new BadRequestException(
            `This ENTRY (${formatTimeInAppTimezone(movementAt)}) must be before the day's first recorded movement (${formatTimeInAppTimezone(first.movementAt)}) to actually close the gap.`,
          );
        }
      }

      return tx.movementRecord.create({
        data: {
          employeeId: dto.employeeId,
          movementType: dto.movementType,
          movementAt,
          recordedByUserId: createdByUserId,
          correctedByUserId: createdByUserId,
          correctionReason: dto.correctionReason,
        },
      });
    });

    await this.auditLog.record({
      userId: createdByUserId,
      action: 'MISSING_MOVEMENT_ADDED',
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
