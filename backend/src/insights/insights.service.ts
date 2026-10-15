import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { dateRangeInclusive, dayRange, formatDateInAppTimezone, todayInAppTimezone, matchesDayScope, DayScope } from '../common/utils/day-range';
import { TtlCache } from '../common/utils/ttl-cache';
import { InsightsQueryDto } from './dto/insights-query.dto';
import { DrillDownQueryDto, DrillDownMetric } from './dto/drill-down-query.dto';
import { EmployeeDetailQueryDto } from './dto/employee-detail-query.dto';
import { DailyDurationQueryDto } from './dto/daily-duration-query.dto';
import { styleHeaderRow, workbookToBuffer } from '../common/utils/excel';
import ExcelJS from 'exceljs';

// Bounds any single drill-down response — a click is meant to explain one
// chart element (one day, one team, one unit), never to become an
// unbounded export. Same reasoning as the `take` caps already enforced
// elsewhere in the app (audit logs, employee list).
const MAX_DRILLDOWN_ROWS = 500;

interface MovementRow {
  employeeId: number;
  movementType: 'ENTRY' | 'EXIT';
  movementAt: Date;
  recordedByUserId: number;
  employee: { team: string | null; employeeName: string; employeeCode: string } | null;
  recordedBy: { id: number; name: string; username: string } | null;
}

interface EmpDayAgg {
  employeeId: number;
  team: string | null;
  employeeName: string;
  employeeCode: string;
  date: string;
  firstEntry?: Date;
  lastExit?: Date;
  // The day's chronologically last movement, of either type — needed to
  // tell a genuinely closed-out day from one where the employee tapped
  // back in after their last recorded exit (ENTRY, EXIT, ENTRY). Without
  // this, `firstEntry && lastExit` alone wrongly calls that day
  // "complete" using the stale lastExit, ignoring the dangling trailing
  // entry. Found in the 2026-10 Insights review.
  lastMovementType?: 'ENTRY' | 'EXIT';
}

// Everything here is a read-only aggregation over movement_records/
// employees/email_logs — no `create`/`update`/`delete` anywhere in this
// file. It is structurally impossible for an Insights request to alter
// any recorded data, no matter what filters/date-range a caller passes.
// Computed in JS from one fetched array per request (not SQL GROUP BY) —
// matches the existing pattern already used by Dashboard's summary and
// EmployeeDetails' working-hours calc, at a data volume where this is
// simple and fast enough; revisit with real SQL aggregation if the
// roster/movement volume grows enough to make this slow. Added 2026-10-05.
@Injectable()
export class InsightsService {
  // Caches getSummary's result per distinct filter combination — see
  // ttl-cache.ts for why a plain in-memory Map is safe here (single
  // process, bounded key space). Global, not per-user: the summary's
  // content doesn't vary by requester, only by the filters, and
  // VIEW_REPORTS access is already gated at the controller/guard level.
  // Only invalidation strategy is TTL expiry — no cache-clear on write
  // (e.g. a new movement or a correction). Deliberately not done: a
  // historical range's data essentially never changes after the fact
  // (corrections to old records are rare), and a range touching today
  // gets a short TTL anyway, bounding staleness to that window. Added
  // 2026-10-15 alongside the connection-pool fix, to reduce how often the
  // slow JS aggregation path (see the class comment above) runs on the
  // free tier's 0.1 vCPU.
  private summaryCache = new TtlCache<Awaited<ReturnType<InsightsService['computeSummary']>>>();

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  // Backs the "All Time" date preset — the real earliest recorded
  // movement, not a guessed/hardcoded start date. `date: null` means no
  // movements exist at all yet (a brand-new deployment).
  async getEarliestMovementDate(): Promise<{ date: string | null }> {
    const earliest = await this.prisma.movementRecord.findFirst({
      where: { isSuperseded: false },
      orderBy: { movementAt: 'asc' },
      select: { movementAt: true },
    });
    return { date: earliest ? formatDateInAppTimezone(earliest.movementAt) : null };
  }

  async getSummary(query: InsightsQueryDto) {
    // Stable key regardless of property insertion order — URLSearchParams
    // sorts nothing itself, so sort the entries explicitly.
    const key = JSON.stringify(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)));
    const cached = this.summaryCache.get(key);
    if (cached) return cached;

    const result = await this.computeSummary(query);
    // A range extending to today is still "live" — today's movements can
    // still arrive, so only cache it briefly. A fully historical range
    // (`to` before today) is effectively immutable, so cache it much
    // longer.
    const to = query.to ?? formatDateInAppTimezone(new Date());
    const ttlMs = to >= todayInAppTimezone() ? 60_000 : 30 * 60_000;
    this.summaryCache.set(key, result, ttlMs);
    return result;
  }

  private async computeSummary(query: InsightsQueryDto) {
    const to = query.to ?? formatDateInAppTimezone(new Date());
    const from = query.from ?? formatDateInAppTimezone(new Date(Date.parse(`${to}T00:00:00`) - 29 * 86_400_000));
    const { start, end } = dateRangeInclusive(from, to);

    const [shiftStart, shiftEnd, expectedHoursRaw, teamRoster] = await Promise.all([
      this.settings.get('SHIFT_REFERENCE_START'),
      this.settings.get('SHIFT_REFERENCE_END'),
      this.settings.get('EXPECTED_DAILY_HOURS'),
      this.prisma.employee.findMany({ where: query.team ? { team: query.team } : {}, select: { team: true, isActive: true } }),
    ]);
    const expectedHours = Number(expectedHoursRaw ?? '9') || 9;
    // Full roster headcount per team (not just employees with movements
    // in range) — see the comment on teamBreakdown below for why. Includes
    // inactive employees, same as teamBreakdown's employeeCount.
    const teamSizeByTeam = new Map<string, number>();
    for (const emp of teamRoster) {
      const team = emp.team ?? 'Unassigned';
      teamSizeByTeam.set(team, (teamSizeByTeam.get(team) ?? 0) + 1);
    }

    const unitId = query.unitId ? Number(query.unitId) : undefined;
    const dayScope: DayScope = query.dayScope ?? 'weekdays';
    const movements = this.filterByDayScope(await this.fetchMovements({ start, end, unitId, team: query.team }), dayScope);

    // ── Attendance trend — straight tallies over every raw movement, no
    // dedup (every tap counts, same as Dashboard's existing
    // totalEntries/totalExits).
    const attendanceByDate = new Map<string, { entries: number; exits: number }>();
    const unitTally = new Map<number, { unitName: string; entries: number; exits: number }>();
    const teamEntryExit = new Map<string, { entries: number; exits: number }>();
    // Hour-of-day (0-23, app timezone) tally for gate-traffic planning.
    const hourlyTally = Array.from({ length: 24 }, () => ({ entries: 0, exits: 0 }));
    // Distinct employees with at least one ENTRY that day, separate from
    // the raw entry-event count above (one employee tapping in 3 times
    // counts once here, not three times).
    const enteredEmployeesByDate = new Map<string, Set<number>>();

    for (const m of movements) {
      const date = formatDateInAppTimezone(m.movementAt);

      // The movementType filter only ever hides one side of the raw
      // entry/exit tallies below — buildEmployeeDayAggs (duration,
      // shortfall, missing-exit) always runs on the full `movements`
      // array further down, unaffected by this flag.
      const typeMatches = !query.movementType || m.movementType === query.movementType;
      if (typeMatches) {
        const bucket = attendanceByDate.get(date) ?? { entries: 0, exits: 0 };
        if (m.movementType === 'ENTRY') bucket.entries++;
        else bucket.exits++;
        attendanceByDate.set(date, bucket);

        const unitBucket = unitTally.get(m.recordedByUserId) ?? {
          unitName: m.recordedBy?.name ?? m.recordedBy?.username ?? `User #${m.recordedByUserId}`,
          entries: 0,
          exits: 0,
        };
        if (m.movementType === 'ENTRY') unitBucket.entries++;
        else unitBucket.exits++;
        unitTally.set(m.recordedByUserId, unitBucket);

        const team = m.employee?.team ?? 'Unassigned';
        const teamBucket = teamEntryExit.get(team) ?? { entries: 0, exits: 0 };
        if (m.movementType === 'ENTRY') teamBucket.entries++;
        else teamBucket.exits++;
        teamEntryExit.set(team, teamBucket);

        const hour = Math.floor(this.getMinuteOfDayInAppTimezone(m.movementAt) / 60);
        if (m.movementType === 'ENTRY') hourlyTally[hour].entries++;
        else hourlyTally[hour].exits++;
      }

      if (m.movementType === 'ENTRY' && (!query.movementType || query.movementType === 'ENTRY')) {
        const set = enteredEmployeesByDate.get(date) ?? new Set<number>();
        set.add(m.employeeId);
        enteredEmployeesByDate.set(date, set);
      }
    }

    const empDays = this.buildEmployeeDayAggs(movements);

    // A "long" day is flagged expectedHours+1 and up — e.g. 10h when
    // expected is 9h. Mirrors shortfallDays but for the opposite tail:
    // nothing on the page previously flagged employees who are
    // consistently staying very late (burnout/unpaid-overtime risk),
    // only those leaving early. Direct user feedback, 2026-10.
    const longDurationHours = expectedHours + 1;
    let completeDays = 0;
    let shortfallDays = 0;
    let longDurationDays = 0;
    let missingExitCount = 0;
    let missingEntryCount = 0;
    const shortfallByDate = new Map<string, number>();
    const longDurationByDate = new Map<string, number>();
    const missingExitByDate = new Map<string, number>();
    const missingEntryByDate = new Map<string, number>();
    const teamHours = new Map<
      string,
      { employeeDays: number; completeDays: number; hoursSum: number; hoursList: number[]; shortfallDays: number; longDurationDays: number }
    >();
    // Per-date duration sum/count, for the average-duration trend line —
    // same first-entry-to-last-exit span as everything else here, just
    // averaged per day instead of over the whole range.
    const durationByDate = new Map<string, { sum: number; count: number }>();

    for (const agg of empDays.values()) {
      const team = agg.team ?? 'Unassigned';
      const teamBucket = teamHours.get(team) ?? { employeeDays: 0, completeDays: 0, hoursSum: 0, hoursList: [], shortfallDays: 0, longDurationDays: 0 };
      teamBucket.employeeDays++;

      if (this.isDayComplete(agg)) {
        const hours = this.durationHours(agg.firstEntry, agg.lastExit);
        completeDays++;
        teamBucket.completeDays++;
        teamBucket.hoursSum += hours;
        teamBucket.hoursList.push(hours);

        const dateBucket = durationByDate.get(agg.date) ?? { sum: 0, count: 0 };
        dateBucket.sum += hours;
        dateBucket.count++;
        durationByDate.set(agg.date, dateBucket);

        if (hours < expectedHours) {
          shortfallDays++;
          teamBucket.shortfallDays++;
          shortfallByDate.set(agg.date, (shortfallByDate.get(agg.date) ?? 0) + 1);
        }
        if (hours >= longDurationHours) {
          longDurationDays++;
          teamBucket.longDurationDays++;
          longDurationByDate.set(agg.date, (longDurationByDate.get(agg.date) ?? 0) + 1);
        }
      } else if (this.isMissingExit(agg)) {
        missingExitCount++;
        missingExitByDate.set(agg.date, (missingExitByDate.get(agg.date) ?? 0) + 1);
      } else if (agg.lastExit && !agg.firstEntry) {
        // An exit recorded with no entry that same calendar day — often a
        // legitimate overnight shift crossing midnight, not necessarily a
        // mistake, so this is a count to review, not an accusation (same
        // framing as missing exits).
        missingEntryCount++;
        missingEntryByDate.set(agg.date, (missingEntryByDate.get(agg.date) ?? 0) + 1);
      }
      teamHours.set(team, teamBucket);
    }

    const correctedCount = (await this.fetchCorrectedMovements({ start, end, team: query.team, unitId })).length;

    const sortedDates = [...attendanceByDate.keys()].sort();

    return {
      range: { from, to },
      shiftReference: {
        start: shiftStart ?? '09:30',
        end: shiftEnd ?? '18:30',
        expectedHours,
      },
      attendanceTrend: sortedDates.map((date) => ({ date, ...attendanceByDate.get(date)! })),
      hourlyDistribution: hourlyTally.map((v, hour) => ({ hour, ...v })),
      uniqueEmployeesByDay: sortedDates.map((date) => ({ date, count: enteredEmployeesByDate.get(date)?.size ?? 0 })),
      // Active roster headcount only — unlike teamBreakdown's employeeCount
      // (which deliberately includes inactive employees), this feeds the
      // Daily Attendance Rate %, whose own "see who had no movement"
      // click-through already excludes inactive employees (added earlier).
      // Counting them here too would make the % permanently unable to
      // reach 100% and leave the tooltip's count disagreeing with the
      // drill-through's row count. Fixed 2026-10-13, by request.
      totalRosterSize: teamRoster.filter((e) => e.isActive).length,
      avgDurationTrend: sortedDates.map((date) => {
        const d = durationByDate.get(date);
        return { date, avgHours: d && d.count > 0 ? Math.round((d.sum / d.count) * 10) / 10 : null };
      }),
      exceptions: {
        missingEntries: missingEntryCount,
        missingExits: missingExitCount,
        correctedRecords: correctedCount,
      },
      hoursShortfall: {
        shortfallDays,
        totalEmployeeDays: completeDays,
        trend: sortedDates.map((date) => ({ date, shortfallCount: shortfallByDate.get(date) ?? 0 })),
      },
      hoursLongDuration: {
        longDurationDays,
        totalEmployeeDays: completeDays,
        threshold: longDurationHours,
        trend: sortedDates.map((date) => ({ date, longDurationCount: longDurationByDate.get(date) ?? 0 })),
      },
      missingExits: {
        count: missingExitCount,
        // missingEntryCount is included here too (not a separate trend
        // field) so the frontend can draw both as one "Missing Movements"
        // chart instead of two near-identical day-trend charts.
        trend: sortedDates.map((date) => ({
          date,
          count: missingExitByDate.get(date) ?? 0,
          missingEntryCount: missingEntryByDate.get(date) ?? 0,
        })),
      },
      // Alphabetical, not insertion order (which follows whichever unit
      // happened to record first in the range) — otherwise Security Unit 2
      // could land left of Security Unit 1, which read as arbitrary.
      // Found 2026-10-13, by request.
      unitActivity: [...unitTally.entries()].map(([id, v]) => ({ unitId: id, ...v })).sort((a, b) => a.unitName.localeCompare(b.unitName)),
      // Alphabetical, not insertion order — with 24+ teams, an arbitrary
      // order makes the chart hard to scan for a specific team. Found in
      // the 2026-10-06 Insights review.
      teamBreakdown: [...teamEntryExit.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map((team) => {
          const hours = teamHours.get(team) ?? { employeeDays: 0, completeDays: 0, hoursSum: 0, hoursList: [], shortfallDays: 0, longDurationDays: 0 };
          const entryExit = teamEntryExit.get(team) ?? { entries: 0, exits: 0 };
          return {
            team,
            ...entryExit,
            // Actual team headcount (full roster, not just those with
            // movements) — without this, a 5-person team's average reads
            // as equally trustworthy as a 200-person team's on the chart,
            // when it's really backed by far less data. Found 2026-10,
            // direct user feedback on the Team Breakdown chart.
            employeeCount: teamSizeByTeam.get(team) ?? 0,
            employeeDays: hours.employeeDays,
            // Both averaged/rated against completeDays (days with an actual
            // measured duration), not employeeDays (which also counts
            // missing-exit days with no duration at all) — dividing by the
            // inflated employeeDays count understated both numbers for any
            // team with missing exits. Found 2026-10-13, by request.
            daysWithHoursTracked: hours.completeDays,
            avgHours: hours.completeDays > 0 ? Math.round((hours.hoursSum / hours.completeDays) * 10) / 10 : null,
            // Median alongside the mean — robust to the handful of very
            // long/short days that skew an average, so it reads as "the
            // typical day" rather than being pulled around by outliers.
            // Added 2026-10-13, by request.
            medianHours: hours.hoursList.length > 0 ? Math.round(this.median(hours.hoursList) * 10) / 10 : null,
            shortfallDays: hours.shortfallDays,
            // Alongside shortfallDays (the existing "short-duration" count)
            // — same rate-against-daysWithHoursTracked treatment, exposed
            // so a department comparison isn't just "who's short" but also
            // "who's running long/unpaid overtime." Added 2026-10-13, by
            // request.
            longDurationDays: hours.longDurationDays,
          };
        }),
    };
  }

  // The one place first-entry-to-last-exit duration is computed from raw
  // timestamps — every bucket/threshold/average/display downstream of
  // this must agree. Rounds to the nearest MINUTE before converting to
  // hours, same fix already applied to EmployeeDetails.tsx's
  // calcWorkingHours for the identical reason: real tap timestamps are
  // server-authoritative `new Date()` calls that essentially never land
  // on an exact whole minute, so a guard's "10:02 to 19:02" tap pair
  // (genuinely 9h0m) could otherwise compute as 8.9994h from raw
  // milliseconds — just under the 9h threshold — and wrongly count as a
  // shortfall or land in the "8-9h" bucket instead of "9-10h", purely
  // from a few seconds of ordinary recording noise. Found in the
  // 2026-10 Insights review (same bug class as the EmployeeDetails fix,
  // not yet applied here until now).
  private durationHours(firstEntry: Date, lastExit: Date): number {
    const ms = lastExit.getTime() - firstEntry.getTime();
    return Math.round(ms / 60_000) / 60;
  }

  // Shared by getSummary and getDrillDown so a chart's detail view can
  // never drift from the numbers on the chart itself — both are always
  // computed from the exact same query + aggregation logic.
  private async fetchMovements(filters: { start: Date; end: Date; unitId?: number; team?: string; employeeId?: number }): Promise<MovementRow[]> {
    return this.prisma.movementRecord.findMany({
      where: {
        isSuperseded: false,
        movementAt: { gte: filters.start, lt: filters.end },
        ...(filters.unitId ? { recordedByUserId: filters.unitId } : {}),
        ...(filters.team ? { employee: { team: filters.team } } : {}),
        ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      },
      select: {
        employeeId: true,
        movementType: true,
        movementAt: true,
        recordedByUserId: true,
        employee: { select: { team: true, employeeName: true, employeeCode: true } },
        recordedBy: { select: { id: true, name: true, username: true } },
      },
      orderBy: { movementAt: 'asc' },
    });
  }

  // Every analytics number (averages, medians, shortfall/overtime rates,
  // trend charts, "days present") is computed against the selected day
  // scope — 'weekdays' (default) so a rare Saturday/Sunday tap can't skew a
  // Mon-Fri expectation, 'all' for every day, or 'weekends' to audit
  // off-schedule presence. A weekend tap still shows up untouched in raw
  // record views (Corrections, Dashboard, per-employee movement history,
  // and the attendance/unit/hour/corrected drill-downs below, none of which
  // call this) regardless of scope — only the aggregated stats are scoped.
  // Added 2026-10-14, by request.
  private filterByDayScope(movements: MovementRow[], scope: DayScope): MovementRow[] {
    return movements.filter((m) => matchesDayScope(m.movementAt, scope));
  }

  // `movements` must already be sorted ascending by movementAt (fetchMovements
  // guarantees this) — the first ENTRY seen for a key is genuinely the
  // earliest, and the last EXIT seen (repeatedly overwritten) is genuinely
  // the latest.
  private buildEmployeeDayAggs(movements: MovementRow[]): Map<string, EmpDayAgg> {
    const empDays = new Map<string, EmpDayAgg>();
    for (const m of movements) {
      const date = formatDateInAppTimezone(m.movementAt);
      const key = `${m.employeeId}|${date}`;
      const agg = empDays.get(key) ?? {
        employeeId: m.employeeId,
        team: m.employee?.team ?? null,
        employeeName: m.employee?.employeeName ?? '',
        employeeCode: m.employee?.employeeCode ?? '',
        date,
      };
      if (m.movementType === 'ENTRY' && !agg.firstEntry) agg.firstEntry = m.movementAt;
      if (m.movementType === 'EXIT') agg.lastExit = m.movementAt;
      agg.lastMovementType = m.movementType;
      empDays.set(key, agg);
    }
    return empDays;
  }

  // A day only counts as a genuinely closed-out, complete session when
  // its last recorded movement was the exit — not merely "has an entry
  // and an exit somewhere", which would wrongly call ENTRY/EXIT/ENTRY
  // "complete" using the stale middle exit and silently ignore the
  // trailing unresolved entry.
  private isDayComplete(agg: EmpDayAgg): agg is EmpDayAgg & { firstEntry: Date; lastExit: Date } {
    return Boolean(agg.firstEntry && agg.lastExit && agg.lastExit > agg.firstEntry && agg.lastMovementType === 'EXIT');
  }

  // Mirror of isDayComplete: an entry exists but the day didn't end on an
  // exit — covers both "entry, never an exit" and "entry, exit, entry
  // again with nothing after".
  private isMissingExit(agg: EmpDayAgg): boolean {
    return Boolean(agg.firstEntry && agg.lastMovementType === 'ENTRY');
  }

  private async getExpectedHours(): Promise<number> {
    const raw = await this.settings.get('EXPECTED_DAILY_HOURS');
    return Number(raw ?? '9') || 9;
  }

  // Active (non-superseded) records that resulted from a correction —
  // i.e. the replacement row the append-only correction chain creates,
  // never the original it replaced (see schema.prisma's comment on
  // MovementRecord.correctionOfId for the full append-only design).
  // Reused by both the summary count and the drill-down/export row list.
  private async fetchCorrectedMovements(filters: { start: Date; end: Date; team?: string; unitId?: number }) {
    return this.prisma.movementRecord.findMany({
      where: {
        isSuperseded: false,
        correctedByUserId: { not: null },
        movementAt: { gte: filters.start, lt: filters.end },
        ...(filters.team ? { employee: { team: filters.team } } : {}),
        ...(filters.unitId ? { recordedByUserId: filters.unitId } : {}),
      },
      select: {
        employeeId: true,
        movementType: true,
        movementAt: true,
        correctionReason: true,
        employee: { select: { employeeName: true, employeeCode: true, team: true } },
        recordedBy: { select: { name: true, username: true } },
        correctedBy: { select: { name: true, username: true } },
      },
      orderBy: { movementAt: 'desc' },
    });
  }

  // Explains one chart element (one day's bar, one team's bar, one unit's
  // bar) by returning the underlying rows it was computed from. Every
  // metric reuses fetchMovements/buildEmployeeDayAggs above, so a
  // drill-down can never disagree with the chart that opened it. Capped
  // at MAX_DRILLDOWN_ROWS per the same reasoning as every other list
  // endpoint in the app. Added 2026-10-06.
  async getDrillDown(query: DrillDownQueryDto) {
    const unitId = query.unitId ? Number(query.unitId) : undefined;

    if (query.metric === 'attendance' && !query.date) {
      throw new BadRequestException('metric requires a date');
    }

    if (query.metric === 'attendance') {
      const { start, end } = dayRange(query.date!);
      const movements = await this.fetchMovements({ start, end, unitId, team: query.team });
      const filtered = query.movementType ? movements.filter((m) => m.movementType === query.movementType) : movements;
      return {
        metric: query.metric,
        date: query.date,
        rows: filtered.slice(0, MAX_DRILLDOWN_ROWS).map((m) => ({
          employeeId: m.employeeId,
          employeeName: m.employee?.employeeName ?? '',
          employeeCode: m.employee?.employeeCode ?? '',
          team: m.employee?.team ?? null,
          movementType: m.movementType,
          movementAt: m.movementAt,
          recordedByName: m.recordedBy?.name ?? m.recordedBy?.username ?? '',
        })),
      };
    }

    const to = query.to ?? formatDateInAppTimezone(new Date());
    const from = query.from ?? formatDateInAppTimezone(new Date(Date.parse(`${to}T00:00:00`) - 29 * 86_400_000));
    const { start, end } = dateRangeInclusive(from, to);
    const dayScope: DayScope = query.dayScope ?? 'weekdays';

    // shortfall/missingExit/missingEntry are dual-mode: a `date` (clicking
    // one bar on a day-based trend chart — that chart's own drill-down
    // behavior is unchanged) scopes to that single day; no `date`
    // (clicking a range-level summary/KPI card, which has no single day
    // to scope to) lists every flagged employee-day across the whole
    // from/to range instead.
    if (query.metric === 'shortfall') {
      const { start: dayStart, end: dayEnd } = query.date ? dayRange(query.date) : { start, end };
      const movements = this.filterByDayScope(await this.fetchMovements({ start: dayStart, end: dayEnd, unitId, team: query.team }), dayScope);
      const expectedHours = await this.getExpectedHours();
      const empDays = [...this.buildEmployeeDayAggs(movements).values()];
      const rows = empDays
        .filter((a) => this.isDayComplete(a))
        .map((a) => ({ ...a, hours: this.durationHours(a.firstEntry!, a.lastExit!) }))
        .filter((a) => a.hours < expectedHours)
        // Math.floor, not Math.round — rounding a value like 8.96 up to
        // "9h" would display exactly the threshold this list is titled
        // "Under 9h", reading as a contradiction even though the
        // underlying (unrounded) comparison is correct. Flooring
        // guarantees the displayed value can never reach the cutoff it's
        // supposed to be under. Found in the 2026-10-06 visual review.
        .map((a) => ({
          employeeId: a.employeeId,
          employeeName: a.employeeName,
          employeeCode: a.employeeCode,
          team: a.team,
          date: a.date,
          hours: Math.floor(a.hours * 10) / 10,
        }));
      return { metric: query.metric, date: query.date, range: query.date ? undefined : { from, to }, rows: rows.slice(0, MAX_DRILLDOWN_ROWS) };
    }

    if (query.metric === 'longDuration') {
      const { start: dayStart, end: dayEnd } = query.date ? dayRange(query.date) : { start, end };
      const movements = this.filterByDayScope(await this.fetchMovements({ start: dayStart, end: dayEnd, unitId, team: query.team }), dayScope);
      const expectedHours = await this.getExpectedHours();
      const empDays = [...this.buildEmployeeDayAggs(movements).values()];
      const rows = empDays
        .filter((a) => this.isDayComplete(a))
        .map((a) => ({ ...a, hours: this.durationHours(a.firstEntry!, a.lastExit!) }))
        .filter((a) => a.hours >= expectedHours + 1)
        .map((a) => ({
          employeeId: a.employeeId,
          employeeName: a.employeeName,
          employeeCode: a.employeeCode,
          team: a.team,
          date: a.date,
          hours: Math.round(a.hours * 10) / 10,
        }));
      return { metric: query.metric, date: query.date, range: query.date ? undefined : { from, to }, rows: rows.slice(0, MAX_DRILLDOWN_ROWS) };
    }

    if (query.metric === 'missingExit' || query.metric === 'missingEntry') {
      const { start: dayStart, end: dayEnd } = query.date ? dayRange(query.date) : { start, end };
      const movements = this.filterByDayScope(await this.fetchMovements({ start: dayStart, end: dayEnd, unitId, team: query.team }), dayScope);
      const empDays = [...this.buildEmployeeDayAggs(movements).values()];
      const isMissingExit = query.metric === 'missingExit';
      const rows = empDays
        .filter((a) => (isMissingExit ? this.isMissingExit(a) : a.lastExit && !a.firstEntry))
        .map((a) => ({
          employeeId: a.employeeId,
          employeeName: a.employeeName,
          employeeCode: a.employeeCode,
          team: a.team,
          date: a.date,
          ...(isMissingExit ? { entryAt: a.firstEntry } : { exitAt: a.lastExit }),
        }));
      return { metric: query.metric, date: query.date, range: query.date ? undefined : { from, to }, rows: rows.slice(0, MAX_DRILLDOWN_ROWS) };
    }

    if (query.metric === 'corrected') {
      const rows = await this.fetchCorrectedMovements({ start, end, team: query.team, unitId });
      return {
        metric: query.metric,
        range: { from, to },
        rows: rows.slice(0, MAX_DRILLDOWN_ROWS).map((m) => ({
          employeeId: m.employeeId,
          employeeName: m.employee?.employeeName ?? '',
          employeeCode: m.employee?.employeeCode ?? '',
          team: m.employee?.team ?? null,
          movementType: m.movementType,
          movementAt: m.movementAt,
          recordedByName: m.recordedBy?.name ?? m.recordedBy?.username ?? '',
          correctedByName: m.correctedBy?.name ?? m.correctedBy?.username ?? '',
          correctionReason: m.correctionReason ?? '',
        })),
      };
    }

    if (query.metric === 'unit') {
      if (!unitId) throw new BadRequestException('metric=unit requires unitId');
      const movements = await this.fetchMovements({ start, end, unitId, team: query.team });
      const filtered = query.movementType ? movements.filter((m) => m.movementType === query.movementType) : movements;
      return {
        metric: query.metric,
        range: { from, to },
        rows: filtered
          .slice()
          .reverse() // most recent first — more useful for a spot-check than oldest-first
          .slice(0, MAX_DRILLDOWN_ROWS)
          .map((m) => ({
            employeeId: m.employeeId,
            employeeName: m.employee?.employeeName ?? '',
            employeeCode: m.employee?.employeeCode ?? '',
            team: m.employee?.team ?? null,
            movementType: m.movementType,
            movementAt: m.movementAt,
          })),
      };
    }

    if (query.metric === 'hour') {
      if (query.hour === undefined) throw new BadRequestException('metric=hour requires hour');
      const hour = Number(query.hour);
      const movements = await this.fetchMovements({ start, end, unitId, team: query.team });
      const filtered = movements.filter(
        (m) => Math.floor(this.getMinuteOfDayInAppTimezone(m.movementAt) / 60) === hour && (!query.movementType || m.movementType === query.movementType),
      );
      return {
        metric: query.metric,
        range: { from, to },
        rows: filtered
          .slice()
          .reverse() // most recent first — more useful for a spot-check than oldest-first
          .slice(0, MAX_DRILLDOWN_ROWS)
          .map((m) => ({
            employeeId: m.employeeId,
            employeeName: m.employee?.employeeName ?? '',
            employeeCode: m.employee?.employeeCode ?? '',
            team: m.employee?.team ?? null,
            movementType: m.movementType,
            movementAt: m.movementAt,
            recordedByName: m.recordedBy?.name ?? m.recordedBy?.username ?? '',
          })),
      };
    }

    // team — every employee currently on that team, even one with zero
    // movements in range (shows as all-zero rather than being omitted, so
    // "who's on this team" is a complete roster, not just who happened to
    // tap during the selected window).
    if (!query.team) throw new BadRequestException('metric=team requires team');
    const [rawMovements, roster] = await Promise.all([
      this.fetchMovements({ start, end, team: query.team }),
      this.prisma.employee.findMany({ where: { team: query.team }, select: { id: true, employeeName: true, employeeCode: true, isActive: true } }),
    ]);
    const expectedHours = await this.getExpectedHours();
    const movements = this.filterByDayScope(rawMovements, dayScope);
    const empDays = [...this.buildEmployeeDayAggs(movements).values()];

    const perEmployee = new Map<number, { entries: number; exits: number; hoursSum: number; completeDays: number; shortfallDays: number }>();
    for (const m of movements) {
      const bucket = perEmployee.get(m.employeeId) ?? { entries: 0, exits: 0, hoursSum: 0, completeDays: 0, shortfallDays: 0 };
      if (m.movementType === 'ENTRY') bucket.entries++;
      else bucket.exits++;
      perEmployee.set(m.employeeId, bucket);
    }
    for (const agg of empDays) {
      if (this.isDayComplete(agg)) {
        const hours = this.durationHours(agg.firstEntry, agg.lastExit);
        const bucket = perEmployee.get(agg.employeeId)!;
        bucket.hoursSum += hours;
        bucket.completeDays++;
        if (hours < expectedHours) bucket.shortfallDays++;
      }
    }

    const rows = roster
      .map((emp) => {
        const b = perEmployee.get(emp.id) ?? { entries: 0, exits: 0, hoursSum: 0, completeDays: 0, shortfallDays: 0 };
        return {
          employeeId: emp.id,
          employeeName: emp.employeeName,
          employeeCode: emp.employeeCode,
          isActive: emp.isActive,
          entries: b.entries,
          exits: b.exits,
          avgHours: b.completeDays > 0 ? Math.round((b.hoursSum / b.completeDays) * 10) / 10 : null,
          shortfallDays: b.shortfallDays,
          // Exposed so the frontend can show "N (X%)" instead of a bare
          // count — without it, an employee with 1 short day out of 1
          // tracked day looks identical to one with 1 out of 20. Same fix
          // class as Team Breakdown's own shortfall rate. Added 2026-10-13,
          // by request.
          daysWithHoursTracked: b.completeDays,
        };
      })
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

    return { metric: query.metric, team: query.team, range: { from, to }, rows: rows.slice(0, MAX_DRILLDOWN_ROWS) };
  }

  // One employee's own trend over a range — monthly/daily hours, a per-day
  // entry/exit count, and average arrival/departure time. Reuses the same
  // fetchMovements/buildEmployeeDayAggs helpers as everything else, so
  // this can never disagree with the team/summary numbers it's drilling
  // further into. Added 2026-10-06, by request (per-employee view).
  async getEmployeeDetail(query: EmployeeDetailQueryDto) {
    const employeeId = Number(query.employeeId);
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, employeeName: true, employeeCode: true, team: true, isActive: true },
    });
    if (!employee) throw new BadRequestException('Employee not found');

    const to = query.to ?? formatDateInAppTimezone(new Date());
    const from = query.from ?? formatDateInAppTimezone(new Date(Date.parse(`${to}T00:00:00`) - 29 * 86_400_000));
    const { start, end } = dateRangeInclusive(from, to);
    const dayScope: DayScope = query.dayScope ?? 'weekdays';

    const movements = this.filterByDayScope(await this.fetchMovements({ start, end, employeeId }), dayScope);
    const empDays = [...this.buildEmployeeDayAggs(movements).values()].sort((a, b) => a.date.localeCompare(b.date));

    const countsByDate = new Map<string, { entries: number; exits: number }>();
    for (const m of movements) {
      const date = formatDateInAppTimezone(m.movementAt);
      const bucket = countsByDate.get(date) ?? { entries: 0, exits: 0 };
      if (m.movementType === 'ENTRY') bucket.entries++;
      else bucket.exits++;
      countsByDate.set(date, bucket);
    }

    const arrivalMinutes: number[] = [];
    const departureMinutes: number[] = [];
    const dailyHours = empDays.map((agg) => {
      if (agg.firstEntry) arrivalMinutes.push(this.getMinuteOfDayInAppTimezone(agg.firstEntry));
      if (agg.lastExit) departureMinutes.push(this.getMinuteOfDayInAppTimezone(agg.lastExit));
      const hours = this.isDayComplete(agg) ? Math.round(this.durationHours(agg.firstEntry, agg.lastExit) * 10) / 10 : null;
      return { date: agg.date, hours, missingExit: this.isMissingExit(agg) };
    });

    // Company-wide comparison: every active employee's own average
    // on-premises duration over the same range, bucketed to the nearest
    // QUARTER hour (15min) and counted into a histogram — shows where this
    // one employee stands among everyone else, not just their own trend in
    // isolation. Average (not median), matching the duration line already
    // shown on this chart. Added 2026-10-13, by request.
    // Buckets went whole-hour -> half-hour -> quarter-hour (2026-10-15, by
    // request, twice) — each step was rounding people who were actually
    // apart into the same visual spot. Bucket keys are integers (hours * 4)
    // rather than the 0.25-step float itself, so Map lookups can't miss on
    // floating-point rounding. Not fully exact/unbucketed — at that point
    // it stops being a histogram (a shape showing where people cluster) and
    // becomes one dot per employee; see the scatter-plot mockup discussed
    // 2026-10-15 for that alternative.
    const [allMovementsRaw, activeRoster] = await Promise.all([
      this.fetchMovements({ start, end }),
      this.prisma.employee.findMany({ where: { isActive: true }, select: { id: true, employeeName: true } }),
    ]);
    const allMovements = this.filterByDayScope(allMovementsRaw, dayScope);
    const namesById = new Map(activeRoster.map((e) => [e.id, e.employeeName]));
    const hoursByEmployee = new Map<number, { sum: number; count: number }>();
    for (const agg of this.buildEmployeeDayAggs(allMovements).values()) {
      if (!namesById.has(agg.employeeId) || !this.isDayComplete(agg)) continue;
      const bucket = hoursByEmployee.get(agg.employeeId) ?? { sum: 0, count: 0 };
      bucket.sum += this.durationHours(agg.firstEntry!, agg.lastExit!);
      bucket.count++;
      hoursByEmployee.set(agg.employeeId, bucket);
    }
    // Each bucket's own employee list carries each person's real exact
    // average too (1-decimal, same rounding as employeeAvgHours/dailyHours
    // elsewhere) — the click-through list used to show only names, which
    // hid that two people in the "same" quarter-hour bucket could still be
    // several minutes apart. Added 2026-10-15, by request.
    const bucketEmployees = new Map<number, Array<{ name: string; hours: number }>>();
    for (const [empId, b] of hoursByEmployee) {
      const exact = b.sum / b.count;
      const quarterHourSlot = Math.round(exact * 4);
      const list = bucketEmployees.get(quarterHourSlot) ?? [];
      list.push({ name: namesById.get(empId)!, hours: Math.round(exact * 10) / 10 });
      bucketEmployees.set(quarterHourSlot, list);
    }
    const slotKeys = [...bucketEmployees.keys()];
    const minSlot = slotKeys.length > 0 ? Math.min(...slotKeys) : 0;
    const maxSlot = slotKeys.length > 0 ? Math.max(...slotKeys) : 0;
    const durationDistribution: Array<{ hours: number; count: number; employees: Array<{ name: string; hours: number }> }> = [];
    for (let slot = minSlot; slot <= maxSlot; slot++) {
      const employees = (bucketEmployees.get(slot) ?? []).sort((a, b) => a.name.localeCompare(b.name));
      durationDistribution.push({ hours: Math.round((slot / 4) * 100) / 100, count: employees.length, employees });
    }
    const employeeHours = hoursByEmployee.get(employeeId);
    const employeeAvgHours = employeeHours ? Math.round((employeeHours.sum / employeeHours.count) * 10) / 10 : null;
    // Which exact durationDistribution bucket this employee landed in —
    // computed with the identical formula used to build the histogram
    // above, not re-derived from the already-rounded employeeAvgHours
    // (1-decimal) on the frontend, which could land on a different
    // quarter-hour bucket than the real one at a rounding boundary.
    const employeeDurationBucket = employeeHours ? Math.round((employeeHours.sum / employeeHours.count) * 4) / 4 : null;

    return {
      employee,
      range: { from, to },
      avgArrival: arrivalMinutes.length > 0 ? this.formatMinuteOfDay(this.average(arrivalMinutes)) : null,
      avgDeparture: departureMinutes.length > 0 ? this.formatMinuteOfDay(this.average(departureMinutes)) : null,
      dailyHours,
      dailyCounts: [...countsByDate.keys()].sort().map((date) => ({ date, ...countsByDate.get(date)! })),
      employeeAvgHours,
      employeeDurationBucket,
      durationDistribution,
    };
  }

  // Spec item #5: every employee's duration for ONE selected day, with
  // missing entry/exit flagged rather than silently producing a
  // misleading duration or being silently dropped. `rows` deliberately
  // only includes employees with at least one movement that day — the
  // full roster (200+ employees) would otherwise be mostly "no data"
  // rows mixed in with real exceptions. Table-only by design (confirmed
  // 2026-10, Insights Phase 2) — a bar chart of 200+ employees isn't
  // actually readable.
  //
  // `noMovement` is the roster complement of `rows` — every employee
  // (matching the same team filter) with zero taps that day. Deliberately
  // NOT called "absent": a tap-free day just as easily means approved
  // leave, a holiday, remote work, or a forgotten tap as it does a real
  // absence, and this system has no way to tell those apart. Framed the
  // same cautious way as every other exception in this file. Added
  // 2026-10, by request.
  async getDailyDuration(query: DailyDurationQueryDto) {
    const { start, end } = dayRange(query.date);
    const unitId = query.unitId ? Number(query.unitId) : undefined;
    // Presence (for noMovement below) is intentionally computed from
    // every unit, not just the unitId filter — a unit filter narrows
    // which checkpoint's taps are shown in `rows`, but someone who
    // tapped at the OTHER unit still has movement that day and must not
    // be listed as having none.
    const [movements, allUnitMovements, roster] = await Promise.all([
      this.fetchMovements({ start, end, unitId, team: query.team }),
      unitId ? this.fetchMovements({ start, end, team: query.team }) : Promise.resolve(null),
      // isActive filter only applies to the noMovement roster below — an
      // inactive (left/terminated) employee trivially has no movement
      // every day, which isn't useful information to surface, just noise.
      // `rows` is unaffected (it comes from real movements, not this
      // roster fetch) — a genuinely recorded tap always stays visible.
      this.prisma.employee.findMany({
        where: { isActive: true, ...(query.team ? { team: query.team } : {}) },
        select: { id: true, employeeName: true, employeeCode: true, team: true, isActive: true },
      }),
    ]);
    const empDays = [...this.buildEmployeeDayAggs(movements).values()];

    const rows = empDays
      .map((agg) => {
        const complete = this.isDayComplete(agg);
        return {
          employeeId: agg.employeeId,
          employeeName: agg.employeeName,
          employeeCode: agg.employeeCode,
          team: agg.team,
          hours: complete ? Math.round(this.durationHours(agg.firstEntry!, agg.lastExit!) * 10) / 10 : null,
          status: complete ? ('complete' as const) : this.isMissingExit(agg) ? ('missingExit' as const) : ('missingEntry' as const),
        };
      })
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

    // "No movement" is only a meaningful exception on a day this scope
    // expects presence at all — a tap-free Saturday isn't noteworthy under
    // 'weekdays' (the default), and a tap-free Tuesday isn't noteworthy
    // under 'weekends' (the off-schedule-audit view). 'all' always flags it.
    // Added 2026-10-14, by request.
    const dayScope: DayScope = query.dayScope ?? 'weekdays';
    const presentIds = new Set((allUnitMovements ?? movements).map((m) => m.employeeId));
    const noMovement = matchesDayScope(start, dayScope)
      ? roster
          .filter((emp) => !presentIds.has(emp.id))
          .map((emp) => ({ employeeId: emp.id, employeeName: emp.employeeName, employeeCode: emp.employeeCode, team: emp.team, isActive: emp.isActive }))
          .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
      : [];

    return { date: query.date, rows, noMovement };
  }

  // ── Excel export — three entry points mirroring the three JSON views
  // above (drill-down, team breakdown, daily duration). Each re-runs the
  // exact same query/aggregation the JSON view uses (getDrillDown/
  // getSummary/getDailyDuration) rather than duplicating the logic, so an
  // export can never disagree with what's on screen. Same exceljs
  // workbook/header-styling pattern as EmployeesService.exportToExcel,
  // for a consistent look across the app's exports. Added 2026-10,
  // Insights Phase 2.

  async exportDrillDown(query: DrillDownQueryDto): Promise<Buffer> {
    const data: any = await this.getDrillDown(query);
    const columns = this.drillDownColumns(data.metric);
    const rows = data.rows.map((r: any) => this.formatDrillDownRow(data.metric, r));
    return this.buildExcelBuffer(`${data.metric} drill-down`.slice(0, 31), columns, rows);
  }

  async exportTeamBreakdown(query: InsightsQueryDto): Promise<Buffer> {
    const summary = await this.getSummary(query);
    const columns = [
      { header: 'Team', key: 'team', width: 30 },
      { header: 'Team Size', key: 'employeeCount', width: 12 },
      { header: 'Entries', key: 'entries', width: 12 },
      { header: 'Exits', key: 'exits', width: 12 },
      { header: 'Days Present (team total)', key: 'employeeDays', width: 22 },
      { header: 'Avg Duration (hrs)', key: 'avgHours', width: 18 },
      { header: `Short-Duration Days (Under ${summary.shiftReference.expectedHours}h)`, key: 'shortfallDays', width: 26 },
    ];
    return this.buildExcelBuffer('Team Breakdown', columns, summary.teamBreakdown);
  }

  async exportDailyDuration(query: DailyDurationQueryDto): Promise<Buffer> {
    const { rows } = await this.getDailyDuration(query);
    const columns = [
      { header: 'Employee', key: 'employeeName', width: 28 },
      { header: 'Code', key: 'employeeCode', width: 16 },
      { header: 'Team', key: 'team', width: 26 },
      { header: 'Duration (hrs)', key: 'hours', width: 16 },
      { header: 'Status', key: 'status', width: 16 },
    ];
    const formatted = rows.map((r) => ({
      ...r,
      team: r.team ?? 'Unassigned',
      hours: r.hours ?? '',
      status: r.status === 'complete' ? 'Complete' : r.status === 'missingExit' ? 'Missing Exit' : 'Missing Entry',
    }));
    return this.buildExcelBuffer('Daily Duration', columns, formatted);
  }

  private drillDownColumns(metric: DrillDownMetric): Array<{ header: string; key: string; width: number }> {
    const employeeCols = [
      { header: 'Employee', key: 'employeeName', width: 28 },
      { header: 'Code', key: 'employeeCode', width: 16 },
    ];
    // metric=team is already scoped to one team (the modal title names
    // it), so a repeated Team column on every row would be redundant —
    // every other metric can span multiple teams, so it gets one.
    const employeeColsWithTeam = [...employeeCols, { header: 'Team', key: 'team', width: 26 }];
    switch (metric) {
      case 'attendance':
        return [...employeeColsWithTeam, { header: 'Time', key: 'time', width: 20 }, { header: 'Movement', key: 'movementType', width: 12 }, { header: 'Recorded By', key: 'recordedByName', width: 22 }];
      case 'unit':
        return [...employeeColsWithTeam, { header: 'Date & Time', key: 'time', width: 22 }, { header: 'Movement', key: 'movementType', width: 12 }];
      case 'hour':
        return [...employeeColsWithTeam, { header: 'Date & Time', key: 'time', width: 22 }, { header: 'Movement', key: 'movementType', width: 12 }, { header: 'Recorded By', key: 'recordedByName', width: 22 }];
      case 'shortfall':
      case 'longDuration':
        return [...employeeColsWithTeam, { header: 'Date', key: 'date', width: 14 }, { header: 'Duration that day (hrs)', key: 'hours', width: 22 }];
      case 'missingExit':
        return [...employeeColsWithTeam, { header: 'Date', key: 'date', width: 14 }, { header: 'Entry Time', key: 'time', width: 20 }];
      case 'missingEntry':
        return [...employeeColsWithTeam, { header: 'Date', key: 'date', width: 14 }, { header: 'Exit Time', key: 'time', width: 20 }];
      case 'corrected':
        return [
          ...employeeColsWithTeam,
          { header: 'Movement', key: 'movementType', width: 12 },
          { header: 'Time', key: 'time', width: 20 },
          { header: 'Recorded By', key: 'recordedByName', width: 22 },
          { header: 'Corrected By', key: 'correctedByName', width: 22 },
          { header: 'Reason', key: 'correctionReason', width: 30 },
        ];
      case 'team':
        return [
          ...employeeCols,
          { header: 'Active', key: 'isActive', width: 10 },
          { header: 'Entries', key: 'entries', width: 12 },
          { header: 'Exits', key: 'exits', width: 12 },
          { header: 'Days With Hours Tracked', key: 'daysWithHoursTracked', width: 22 },
          { header: 'Avg Duration (hrs)', key: 'avgHours', width: 18 },
          { header: 'Short-Duration Days', key: 'shortfallDays', width: 20 },
        ];
    }
  }

  private formatDrillDownRow(metric: DrillDownMetric, r: any): Record<string, any> {
    const base = { employeeName: r.employeeName, employeeCode: r.employeeCode, team: r.team ?? '' };
    switch (metric) {
      case 'attendance':
        return { ...base, time: this.formatDateTimeInAppTimezone(r.movementAt), movementType: r.movementType, recordedByName: r.recordedByName };
      case 'unit':
        return { ...base, time: this.formatDateTimeInAppTimezone(r.movementAt), movementType: r.movementType };
      case 'hour':
        return { ...base, time: this.formatDateTimeInAppTimezone(r.movementAt), movementType: r.movementType, recordedByName: r.recordedByName };
      case 'shortfall':
      case 'longDuration':
        return { ...base, date: r.date, hours: r.hours };
      case 'missingExit':
        return { ...base, date: r.date, time: this.formatDateTimeInAppTimezone(r.entryAt) };
      case 'missingEntry':
        return { ...base, date: r.date, time: this.formatDateTimeInAppTimezone(r.exitAt) };
      case 'corrected':
        return {
          ...base,
          movementType: r.movementType,
          time: this.formatDateTimeInAppTimezone(r.movementAt),
          recordedByName: r.recordedByName,
          correctedByName: r.correctedByName,
          correctionReason: r.correctionReason,
        };
      case 'team':
        return {
          ...base,
          isActive: r.isActive ? 'Yes' : 'No',
          entries: r.entries,
          exits: r.exits,
          daysWithHoursTracked: r.daysWithHoursTracked,
          avgHours: r.avgHours ?? '',
          shortfallDays: r.shortfallDays,
        };
    }
  }

  private async buildExcelBuffer(sheetName: string, columns: Array<{ header: string; key: string; width: number }>, rows: any[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = columns;
    styleHeaderRow(sheet);
    for (const row of rows) sheet.addRow(row);
    return workbookToBuffer(workbook);
  }

  private formatDateTimeInAppTimezone(date: Date): string {
    return `${formatDateInAppTimezone(date)} ${this.formatMinuteOfDay(this.getMinuteOfDayInAppTimezone(date))}`;
  }

  private average(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  // Median, not mean — a team's average duration can be skewed by a
  // handful of very long or very short days; the median is the typical
  // day, unaffected by those outliers. Added 2026-10-13, by request.
  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  // Cached for the same reason as day-range.ts's date formatter — this is
  // called per movement in hot aggregation loops, and constructing a new
  // Intl.DateTimeFormat per call measurably dominated CPU time on Render's
  // 0.1 vCPU free tier. Found 2026-10-15.
  private static readonly minuteFormatterCache = new Map<string, Intl.DateTimeFormat>();

  private getMinuteOfDayInAppTimezone(date: Date): number {
    const timeZone = process.env.APP_TIMEZONE ?? 'Asia/Kolkata';
    let formatter = InsightsService.minuteFormatterCache.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      InsightsService.minuteFormatterCache.set(timeZone, formatter);
    }
    const parts = formatter.formatToParts(date);
    const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return Number(lookup.hour) * 60 + Number(lookup.minute);
  }

  private formatMinuteOfDay(minutes: number): string {
    const rounded = Math.round(minutes);
    const h = Math.floor(rounded / 60) % 24;
    const m = rounded % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

}
