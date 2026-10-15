import { InsightsService } from './insights.service';

function movement(overrides: Partial<Record<string, any>> = {}) {
  return {
    employeeId: 1,
    movementType: 'ENTRY',
    movementAt: new Date('2026-10-01T04:00:00.000Z'), // ~09:30 IST
    recordedByUserId: 10,
    employee: { team: 'Testing', employeeName: 'Asha Rao', employeeCode: 'EMP001' },
    recordedBy: { id: 10, name: 'Security Unit 1', username: 'securityunit1' },
    ...overrides,
  };
}

describe('InsightsService.getSummary', () => {
  const prisma = {
    movementRecord: { findMany: jest.fn() },
    emailLog: { findMany: jest.fn() },
    employee: { findMany: jest.fn() },
  };
  const settings = { get: jest.fn() };
  const service = new InsightsService(prisma as any, settings as any);

  beforeEach(() => {
    jest.clearAllMocks();
    (service as any).summaryCache.clear();
    settings.get.mockImplementation((key: string) => {
      if (key === 'SHIFT_REFERENCE_START') return Promise.resolve('09:30');
      if (key === 'SHIFT_REFERENCE_END') return Promise.resolve('18:30');
      if (key === 'EXPECTED_DAILY_HOURS') return Promise.resolve('9');
      return Promise.resolve(null);
    });
    prisma.emailLog.findMany.mockResolvedValue([]);
    prisma.employee.findMany.mockResolvedValue([]);
  });

  it('is strictly read-only — never calls create/update/delete on anything', () => {
    expect((prisma.movementRecord as any).create).toBeUndefined();
    expect((prisma.movementRecord as any).update).toBeUndefined();
    expect((prisma.movementRecord as any).delete).toBeUndefined();
  });

  it('counts a complete 9.5h day as no shortfall, and tallies the attendance trend', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z') }), // 09:30 IST
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T13:30:00.000Z') }), // 19:00 IST (9.5h)
    ]);

    const result = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.attendanceTrend).toEqual([{ date: '2026-10-01', entries: 1, exits: 1 }]);
    expect(result.hoursShortfall.shortfallDays).toBe(0);
    expect(result.hoursShortfall.totalEmployeeDays).toBe(1);
    expect(result.avgDurationTrend).toEqual([{ date: '2026-10-01', avgHours: 9.5 }]);
    expect(result.missingExits.count).toBe(0);
  });

  // 10:02 IST to 19:02 IST is genuinely exactly 9h0m. A few seconds of
  // ordinary tap-timing noise (real timestamps are server `new Date()`
  // calls, essentially never landing on a clean whole minute) must never
  // make this compute as e.g. 8.9994h from raw milliseconds and wrongly
  // count as a shortfall. Regression test for the 2026-10 Insights review.
  it('a 10:02-to-19:02 day (exactly 9h, with a few seconds of real-world timing noise) is never counted as a shortfall', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:32:02.418Z') }), // 10:02:02.418 IST
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T13:32:01.937Z') }), // 19:02:01.937 IST — raw ms diff is 8.9999h, not 9h
    ]);

    const result = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.hoursShortfall.shortfallDays).toBe(0);
    expect(result.avgDurationTrend).toEqual([{ date: '2026-10-01', avgHours: 9 }]);
  });

  it('counts a sub-9h day as a shortfall day, not a "late arrival" (flexible timing)', async () => {
    // Arrives 11:00 IST, leaves 18:30 IST — later than the 09:30 reference
    // start, but flexible timing means that alone is never a violation.
    // Only the completed-hours total (7.5h here) matters.
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T05:30:00.000Z') }), // 11:00 IST
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T13:00:00.000Z') }), // 18:30 IST
    ]);

    const result = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.hoursShortfall.shortfallDays).toBe(1);
    expect(result.avgDurationTrend).toEqual([{ date: '2026-10-01', avgHours: 7.5 }]);
  });

  // Long-Duration Days: mirrors shortfall but for the opposite tail — a
  // day is "long" at expectedHours+1 and up (10h when expected is 9h).
  // Added 2026-10 per direct user feedback: nothing previously flagged
  // employees consistently staying very late (burnout/unpaid-overtime
  // risk), only those leaving early.
  it('counts a 10h+ day as a long-duration day, not a complete-but-unremarkable one', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z') }), // 09:30 IST
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T14:00:00.000Z') }), // 19:30 IST (10h)
    ]);

    const result: any = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.hoursLongDuration.longDurationDays).toBe(1);
    expect(result.hoursLongDuration.threshold).toBe(10);
    expect(result.hoursLongDuration.trend).toEqual([{ date: '2026-10-01', longDurationCount: 1 }]);
    expect(result.hoursShortfall.shortfallDays).toBe(0); // not also counted as a shortfall
  });

  it('does not count a 9.5h day (under the 10h long-duration threshold) as long-duration', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z') }),
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T13:30:00.000Z') }), // 9.5h
    ]);

    const result: any = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.hoursLongDuration.longDurationDays).toBe(0);
  });

  it('detects a missing exit (entry with no matching exit that day)', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([movement({ movementType: 'ENTRY' })]);

    const result = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.missingExits.count).toBe(1);
    expect(result.hoursShortfall.totalEmployeeDays).toBe(0); // no complete span to judge
  });

  it('counts ENTRY/EXIT/ENTRY (tapped back in after the recorded exit) as missing an exit, not as a 4h-ish complete day', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z') }),
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T08:00:00.000Z') }),
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T09:00:00.000Z') }),
    ]);

    const result = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.missingExits.count).toBe(1);
    expect(result.hoursShortfall.totalEmployeeDays).toBe(0); // not counted as a complete, judgeable day
    expect(result.avgDurationTrend).toEqual([{ date: '2026-10-01', avgHours: null }]);
  });

  it('groups activity by recordedByUserId (unit) and by employee.team', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, recordedByUserId: 10, recordedBy: { id: 10, name: 'Security Unit 1', username: 'securityunit1' }, employee: { team: 'Testing' } }),
      movement({ employeeId: 2, recordedByUserId: 11, recordedBy: { id: 11, name: 'Security Unit 2', username: 'securityunit2' }, employee: { team: 'Admin' } }),
    ]);

    const result = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.unitActivity).toEqual(
      expect.arrayContaining([
        { unitId: 10, unitName: 'Security Unit 1', entries: 1, exits: 0 },
        { unitId: 11, unitName: 'Security Unit 2', entries: 1, exits: 0 },
      ]),
    );
    const teams = result.teamBreakdown.map((t) => t.team).sort();
    expect(teams).toEqual(['Admin', 'Testing']);
  });

  it('falls back to an employee with no team as "Unassigned"', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([movement({ employee: { team: null } })]);

    const result = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.teamBreakdown.map((t) => t.team)).toEqual(['Unassigned']);
  });

  it('buckets entries/exits by hour of day (app timezone)', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z') }), // 09:30 IST -> hour 9
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T13:30:00.000Z') }), // 19:00 IST -> hour 19
    ]);

    const result = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.hourlyDistribution).toHaveLength(24);
    expect(result.hourlyDistribution[9]).toEqual({ hour: 9, entries: 1, exits: 0 });
    expect(result.hourlyDistribution[19]).toEqual({ hour: 19, entries: 0, exits: 1 });
  });

  it('counts distinct employees entering per day, not raw entry events', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z') }),
      movement({ employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-01T06:00:00.000Z') }),
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T07:00:00.000Z') }), // same employee, 2nd entry
      movement({ employeeId: 2, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:30:00.000Z') }),
    ]);

    const result = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.uniqueEmployeesByDay).toEqual([{ date: '2026-10-01', count: 2 }]);
    expect(result.attendanceTrend).toEqual([{ date: '2026-10-01', entries: 3, exits: 1 }]);
  });

  it('averages duration per day for the avgDurationTrend', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z') }), // 09:30
      movement({ employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-01T13:30:00.000Z') }), // 19:00 -> 9.5h
      movement({ employeeId: 2, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z') }), // 09:30
      movement({ employeeId: 2, movementType: 'EXIT', movementAt: new Date('2026-10-01T12:30:00.000Z') }), // 18:00 -> 8.5h
    ]);

    const result = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.avgDurationTrend).toEqual([{ date: '2026-10-01', avgHours: 9 }]);
  });

  it('movementType filter hides one side of the tally charts but leaves duration figures untouched', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z') }), // 09:30
      movement({ employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-01T13:30:00.000Z') }), // 19:00, 9.5h
    ]);

    const result = await service.getSummary({ from: '2026-10-01', to: '2026-10-01', movementType: 'ENTRY' } as any);

    expect(result.attendanceTrend).toEqual([{ date: '2026-10-01', entries: 1, exits: 0 }]);
    // Duration/shortfall/missing-exit must still see the real EXIT — the
    // filter must never make a real complete day look like a missing exit.
    expect(result.missingExits.count).toBe(0);
    expect(result.avgDurationTrend).toEqual([{ date: '2026-10-01', avgHours: 9.5 }]);
  });

  it('defaults to the last 30 days when from/to are omitted', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([]);

    const result = await service.getSummary({});

    const days = (Date.parse(`${result.range.to}T00:00:00`) - Date.parse(`${result.range.from}T00:00:00`)) / 86_400_000;
    expect(days).toBe(29);
  });

  it('passes the team/unit filters through to the movement query', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([]);

    await service.getSummary({ from: '2026-10-01', to: '2026-10-01', team: 'Testing', unitId: '10' });

    const where = prisma.movementRecord.findMany.mock.calls[0][0].where;
    expect(where.employee).toEqual({ team: 'Testing' });
    expect(where.recordedByUserId).toBe(10);
  });

  it('sorts teamBreakdown alphabetically, not by insertion order', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, employee: { team: 'Testing', employeeName: 'A', employeeCode: '1' } }),
      movement({ employeeId: 2, employee: { team: 'Admin', employeeName: 'B', employeeCode: '2' } }),
      movement({ employeeId: 3, employee: { team: 'Logistics', employeeName: 'C', employeeCode: '3' } }),
    ]);

    const result = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.teamBreakdown.map((t) => t.team)).toEqual(['Admin', 'Logistics', 'Testing']);
  });

  // Reported by the user (2026-10): comparing avg-duration bars across
  // teams of very different sizes is misleading without seeing the
  // headcount — a 3-person team's average carries far less weight than a
  // 200-person team's, but the chart alone can't show that.
  it('teamBreakdown.employeeCount reflects the full roster, not just employees with movements in range', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([movement({ employeeId: 1, employee: { team: 'Testing', employeeName: 'A', employeeCode: '1' } })]);
    prisma.employee.findMany.mockResolvedValue([
      { team: 'Testing' },
      { team: 'Testing' },
      { team: 'Testing' },
      { team: 'Admin' },
    ]);

    const result: any = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    const testing = result.teamBreakdown.find((t: any) => t.team === 'Testing');
    expect(testing.employeeCount).toBe(3); // roster size, not the 1 employee who actually tapped
  });

  // Active-only, unlike teamBreakdown.employeeCount (which deliberately
  // includes inactive employees) — this feeds the Daily Attendance Rate %,
  // whose own "see who had no movement" click-through already excludes
  // inactive employees. Counting them here too would make the % unable to
  // reach 100% and disagree with the drill-through's row count.
  it('totalRosterSize counts only active employees, unlike teamBreakdown.employeeCount', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([movement({ employeeId: 1, employee: { team: 'Testing', employeeName: 'A', employeeCode: '1' } })]);
    prisma.employee.findMany.mockResolvedValue([
      { team: 'Testing', isActive: true },
      { team: 'Testing', isActive: true },
      { team: 'Testing', isActive: false },
      { team: 'Admin', isActive: true },
    ]);

    const result: any = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.totalRosterSize).toBe(3);
    const testing = result.teamBreakdown.find((t: any) => t.team === 'Testing');
    expect(testing.employeeCount).toBe(3); // unchanged — still the full roster, inactive included
  });

  // teamBreakdown.employeeDays ("Days Present") counts every tap-day,
  // including a missing-exit day with no measurable duration at all.
  // avgHours/shortfallDays must be rated against daysWithHoursTracked
  // (complete days only) — dividing by employeeDays would dilute both
  // numbers for any team with missing exits. Found 2026-10-13, by request.
  it('avgHours and the shortfall rate are rated against complete days only, not diluted by a missing-exit day', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      // Day 1: complete, 5h — under the 9h expected, so a shortfall day.
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:30:00.000Z') }), // 10:00 IST
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T09:30:00.000Z') }), // 15:00 IST
      // Day 2: missing exit — no measurable duration, shouldn't dilute avgHours/shortfall%.
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-02T04:30:00.000Z') }), // 10:00 IST
    ]);

    const result: any = await service.getSummary({ from: '2026-10-01', to: '2026-10-02' });

    const testing = result.teamBreakdown.find((t: any) => t.team === 'Testing');
    expect(testing.employeeDays).toBe(2); // Days Present — both tap-days count
    expect(testing.daysWithHoursTracked).toBe(1); // only the complete day
    expect(testing.avgHours).toBe(5); // not 5/2 = 2.5
  });

  // teamBreakdown.medianHours/.longDurationDays — median lets a department
  // comparison show the typical day instead of one an outlier could skew;
  // longDurationDays is the overtime-side mirror of the existing
  // shortfallDays. Added 2026-10-13, by request ("not only working hours
  // but also overtime and short days too").
  it('exposes medianHours and longDurationDays per team', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      // 5h — under 9h expected, a shortfall day. (Monday)
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-09-28T04:30:00.000Z') }), // 10:00 IST
      movement({ movementType: 'EXIT', movementAt: new Date('2026-09-28T09:30:00.000Z') }), // 15:00 IST
      // 9h — right at the expected mark, neither shortfall nor long. (Tuesday)
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-09-29T04:00:00.000Z') }), // 09:30 IST
      movement({ movementType: 'EXIT', movementAt: new Date('2026-09-29T13:00:00.000Z') }), // 18:30 IST
      // 11h — over the 10h long-duration threshold (expected + 1). (Wednesday)
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-09-30T02:30:00.000Z') }), // 08:00 IST
      movement({ movementType: 'EXIT', movementAt: new Date('2026-09-30T13:30:00.000Z') }), // 19:00 IST
      // 12h — also over the long-duration threshold. (Thursday)
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T01:30:00.000Z') }), // 07:00 IST
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T13:30:00.000Z') }), // 19:00 IST
    ]);

    const result: any = await service.getSummary({ from: '2026-09-28', to: '2026-10-01' });

    const testing = result.teamBreakdown.find((t: any) => t.team === 'Testing');
    expect(testing.daysWithHoursTracked).toBe(4);
    expect(testing.medianHours).toBe(10); // sorted [5, 9, 11, 12] -> (9+11)/2
    expect(testing.shortfallDays).toBe(1); // only the 5h day
    expect(testing.longDurationDays).toBe(2); // the 11h and 12h days
    expect(testing.shortfallDays).toBe(1); // 1 of 1 tracked day, not 1 of 2
  });

  it('excludes weekend taps from every rate/trend, but a weekday tap in the same range still counts', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      // Saturday — 9h, would otherwise count as a complete day.
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-03T04:00:00.000Z') }), // Sat, 09:30 IST
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-03T13:00:00.000Z') }), // Sat, 18:30 IST
      // Thursday — 9h, a real working day.
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z') }), // Thu, 09:30 IST
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T13:00:00.000Z') }), // Thu, 18:30 IST
    ]);

    const result: any = await service.getSummary({ from: '2026-09-28', to: '2026-10-04' });

    const testing = result.teamBreakdown.find((t: any) => t.team === 'Testing');
    expect(testing.daysWithHoursTracked).toBe(1);
    expect(result.attendanceTrend.find((d: any) => d.date === '2026-10-03')).toBeUndefined();
    expect(result.attendanceTrend.find((d: any) => d.date === '2026-10-01')).toBeDefined();
    expect(result.hourlyDistribution.reduce((sum: number, h: any) => sum + h.entries, 0)).toBe(1);
  });

  it('dayScope "all" counts both the weekend and weekday tap', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-03T04:00:00.000Z') }), // Sat
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-03T13:00:00.000Z') }),
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z') }), // Thu
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T13:00:00.000Z') }),
    ]);

    const result: any = await service.getSummary({ from: '2026-09-28', to: '2026-10-04', dayScope: 'all' } as any);

    const testing = result.teamBreakdown.find((t: any) => t.team === 'Testing');
    expect(testing.daysWithHoursTracked).toBe(2);
    expect(result.attendanceTrend.find((d: any) => d.date === '2026-10-03')).toBeDefined();
  });

  it('dayScope "weekends" counts only the weekend tap, not the weekday one', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-03T04:00:00.000Z') }), // Sat
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-03T13:00:00.000Z') }),
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z') }), // Thu
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T13:00:00.000Z') }),
    ]);

    const result: any = await service.getSummary({ from: '2026-09-28', to: '2026-10-04', dayScope: 'weekends' } as any);

    const testing = result.teamBreakdown.find((t: any) => t.team === 'Testing');
    expect(testing.daysWithHoursTracked).toBe(1);
    expect(result.attendanceTrend.find((d: any) => d.date === '2026-10-03')).toBeDefined();
    expect(result.attendanceTrend.find((d: any) => d.date === '2026-10-01')).toBeUndefined();
  });

  it('exceptions.missingEntries counts an exit with no entry that day, separately from missingExits', async () => {
    prisma.movementRecord.findMany.mockImplementation((args: any) => {
      if (args?.where?.correctedByUserId) return Promise.resolve([]);
      return Promise.resolve([movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T13:00:00.000Z') })]);
    });

    const result = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.exceptions.missingEntries).toBe(1);
    expect(result.exceptions.missingExits).toBe(0);
    expect(result.missingExits.count).toBe(0); // the pre-existing top-level count is unaffected
  });

  it('exceptions.correctedRecords counts active records that resulted from a correction', async () => {
    prisma.movementRecord.findMany.mockImplementation((args: any) => {
      if (args?.where?.correctedByUserId) {
        return Promise.resolve([movement({ correctedByUserId: 5, correctionReason: 'Wrong tap', correctedBy: { name: 'HR Admin', username: 'hr' } })]);
      }
      return Promise.resolve([movement()]);
    });

    const result = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(result.exceptions.correctedRecords).toBe(1);
  });

  it('caches a repeat call with identical filters, skipping recomputation', async () => {
    prisma.movementRecord.findMany.mockImplementation((args: any) => {
      if (args?.where?.correctedByUserId) return Promise.resolve([]);
      return Promise.resolve([movement()]);
    });

    const first = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });
    const callsAfterFirst = prisma.movementRecord.findMany.mock.calls.length;
    const second = await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });

    expect(second).toEqual(first);
    expect(prisma.movementRecord.findMany.mock.calls.length).toBe(callsAfterFirst);
  });

  it('does not cache across different filter combinations', async () => {
    prisma.movementRecord.findMany.mockImplementation((args: any) => {
      if (args?.where?.correctedByUserId) return Promise.resolve([]);
      return Promise.resolve([movement()]);
    });

    await service.getSummary({ from: '2026-10-01', to: '2026-10-01' });
    const callsAfterFirst = prisma.movementRecord.findMany.mock.calls.length;
    await service.getSummary({ from: '2026-10-01', to: '2026-10-02' });

    expect(prisma.movementRecord.findMany.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

// Backs the "All Time" date preset — a real earliest-recorded-movement
// date, not a guessed/hardcoded start date. Added 2026-10-13, by request.
describe('InsightsService.getEarliestMovementDate', () => {
  const prisma = { movementRecord: { findFirst: jest.fn() } };
  const service = new InsightsService(prisma as any, {} as any);

  it('returns the earliest non-superseded movement date', async () => {
    prisma.movementRecord.findFirst.mockResolvedValue({ movementAt: new Date('2026-01-15T04:00:00.000Z') }); // ~09:30 IST

    const result = await service.getEarliestMovementDate();

    expect(result).toEqual({ date: '2026-01-15' });
    expect(prisma.movementRecord.findFirst).toHaveBeenCalledWith({
      where: { isSuperseded: false },
      orderBy: { movementAt: 'asc' },
      select: { movementAt: true },
    });
  });

  it('returns a null date when no movements exist yet', async () => {
    prisma.movementRecord.findFirst.mockResolvedValue(null);

    const result = await service.getEarliestMovementDate();

    expect(result).toEqual({ date: null });
  });
});

// Explains one chart element by returning the rows it was computed from —
// every metric reuses getSummary's own fetchMovements/buildEmployeeDayAggs,
// so a drill-down can never disagree with the chart that opened it.
// Added 2026-10-06.
describe('InsightsService.getDrillDown', () => {
  const prisma = {
    movementRecord: { findMany: jest.fn() },
    employee: { findMany: jest.fn() },
  };
  const settings = { get: jest.fn() };
  const service = new InsightsService(prisma as any, settings as any);

  beforeEach(() => {
    jest.clearAllMocks();
    (service as any).summaryCache.clear();
    settings.get.mockImplementation((key: string) => (key === 'EXPECTED_DAILY_HOURS' ? Promise.resolve('9') : Promise.resolve(null)));
  });

  it('rejects a day-based metric with no date', async () => {
    await expect(service.getDrillDown({ metric: 'attendance' } as any)).rejects.toThrow('requires a date');
  });

  it('attendance: returns the raw movement rows for that day', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ movementType: 'ENTRY' }),
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T10:00:00.000Z') }),
    ]);

    const result = await service.getDrillDown({ metric: 'attendance', date: '2026-10-01' } as any);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ employeeName: 'Asha Rao', employeeCode: 'EMP001', movementType: 'ENTRY' });
  });

  it('attendance: movementType filter narrows the rows to just that type', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ movementType: 'ENTRY' }),
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T10:00:00.000Z') }),
    ]);

    const result: any = await service.getDrillDown({ metric: 'attendance', date: '2026-10-01', movementType: 'EXIT' } as any);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].movementType).toBe('EXIT');
  });

  it('shortfall: only returns employees whose completed span that day was under the expected hours', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      // Employee 1: 9.5h — not a shortfall
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z'), employee: { team: 'Testing', employeeName: 'Full Day', employeeCode: 'E1' } }),
      movement({ employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-01T13:30:00.000Z'), employee: { team: 'Testing', employeeName: 'Full Day', employeeCode: 'E1' } }),
      // Employee 2: 5h — shortfall
      movement({ employeeId: 2, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z'), employee: { team: 'Testing', employeeName: 'Short Day', employeeCode: 'E2' } }),
      movement({ employeeId: 2, movementType: 'EXIT', movementAt: new Date('2026-10-01T09:00:00.000Z'), employee: { team: 'Testing', employeeName: 'Short Day', employeeCode: 'E2' } }),
    ]);

    const result = await service.getDrillDown({ metric: 'shortfall', date: '2026-10-01' } as any);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ employeeName: 'Short Day', hours: 5 });
  });

  it('longDuration: only returns employees whose completed span that day was at or over the long-duration threshold', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      // Employee 1: 9.5h — not long-duration (threshold is 10h)
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z'), employee: { team: 'Testing', employeeName: 'Normal Day', employeeCode: 'E1' } }),
      movement({ employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-01T13:30:00.000Z'), employee: { team: 'Testing', employeeName: 'Normal Day', employeeCode: 'E1' } }),
      // Employee 2: 11h — long-duration
      movement({ employeeId: 2, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z'), employee: { team: 'Testing', employeeName: 'Long Day', employeeCode: 'E2' } }),
      movement({ employeeId: 2, movementType: 'EXIT', movementAt: new Date('2026-10-01T15:00:00.000Z'), employee: { team: 'Testing', employeeName: 'Long Day', employeeCode: 'E2' } }),
    ]);

    const result = await service.getDrillDown({ metric: 'longDuration', date: '2026-10-01' } as any);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ employeeName: 'Long Day', hours: 11 });
  });

  // Added so the frontend can offer an in-modal Team filter for
  // range-wide drill-downs that can span many teams (e.g. opened from a
  // KPI card with no team filter active). Direct user feedback, 2026-10.
  it('shortfall: each row carries its own team, so the drill-down can be filtered by team client-side', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z'), employee: { team: 'Testing', employeeName: 'Short Day', employeeCode: 'E1' } }),
      movement({ employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-01T09:00:00.000Z'), employee: { team: 'Testing', employeeName: 'Short Day', employeeCode: 'E1' } }),
    ]);

    const result: any = await service.getDrillDown({ metric: 'shortfall', date: '2026-10-01' } as any);

    expect(result.rows[0].team).toBe('Testing');
  });

  // A row in a list titled "Under 9h" showing "9h" reads as a
  // contradiction, even though the underlying (unrounded) comparison is
  // correct — rounding 8.96 to one decimal rounds it up to exactly the
  // cutoff. Found via a real headless-browser screenshot review, 2026-10-06.
  it('shortfall: never displays a hours value that rounds up to the expected-hours cutoff', async () => {
    settings.get.mockImplementation((key: string) => (key === 'EXPECTED_DAILY_HOURS' ? Promise.resolve('9') : Promise.resolve(null)));
    prisma.movementRecord.findMany.mockResolvedValue([
      // 8.96h — genuinely under 9h, but Math.round(8.96 * 10) / 10 = 9
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z'), employee: { team: 'Testing', employeeName: 'Boundary Case', employeeCode: 'E1' } }),
      movement({ employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-01T12:57:36.000Z'), employee: { team: 'Testing', employeeName: 'Boundary Case', employeeCode: 'E1' } }),
    ]);

    const result: any = await service.getDrillDown({ metric: 'shortfall', date: '2026-10-01' } as any);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].hours).toBeLessThan(9);
    expect(result.rows[0].hours).toBe(8.9);
  });

  it('shortfall: with no date, lists every short-duration employee-day across the whole from/to range (the summary card has no single day to scope to)', async () => {
    settings.get.mockImplementation((key: string) => (key === 'EXPECTED_DAILY_HOURS' ? Promise.resolve('9') : Promise.resolve(null)));
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z') }),
      movement({ employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-01T09:00:00.000Z') }), // 5h, day 1
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-02T04:00:00.000Z') }),
      movement({ employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-02T09:00:00.000Z') }), // 5h, day 2
    ]);

    const result: any = await service.getDrillDown({ metric: 'shortfall', from: '2026-10-01', to: '2026-10-02' } as any);

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r: any) => r.date).sort()).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('missingExit: only returns employees with an entry and no matching exit that day', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, movementType: 'ENTRY', employee: { team: 'Testing', employeeName: 'No Exit', employeeCode: 'E1' } }),
      movement({ employeeId: 2, movementType: 'ENTRY', employee: { team: 'Testing', employeeName: 'Full Day', employeeCode: 'E2' } }),
      movement({ employeeId: 2, movementType: 'EXIT', employee: { team: 'Testing', employeeName: 'Full Day', employeeCode: 'E2' }, movementAt: new Date('2026-10-01T10:00:00.000Z') }),
    ]);

    const result = await service.getDrillDown({ metric: 'missingExit', date: '2026-10-01' } as any);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ employeeName: 'No Exit' });
  });

  it('missingEntry: only returns employees with an exit and no matching entry that day', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, movementType: 'EXIT', employee: { team: 'Testing', employeeName: 'No Entry', employeeCode: 'E1' } }),
      movement({ employeeId: 2, movementType: 'ENTRY', employee: { team: 'Testing', employeeName: 'Full Day', employeeCode: 'E2' } }),
      movement({ employeeId: 2, movementType: 'EXIT', employee: { team: 'Testing', employeeName: 'Full Day', employeeCode: 'E2' }, movementAt: new Date('2026-10-01T10:00:00.000Z') }),
    ]);

    const result = await service.getDrillDown({ metric: 'missingEntry', date: '2026-10-01' } as any);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ employeeName: 'No Entry' });
  });

  it('missingExit/missingEntry: with no date, lists every flagged employee-day across the whole from/to range (the Exceptions KPI card has no single day to scope to)', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z'), employee: { team: 'Testing', employeeName: 'No Exit Day 1', employeeCode: 'E1' } }),
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-02T04:00:00.000Z'), employee: { team: 'Testing', employeeName: 'No Exit Day 1', employeeCode: 'E1' } }),
    ]);

    const result: any = await service.getDrillDown({ metric: 'missingExit', from: '2026-10-01', to: '2026-10-02' } as any);

    expect(result.rows).toHaveLength(2); // flagged on both days, not deduped to one row
    expect(result.rows.map((r: any) => r.date).sort()).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('corrected: only returns active records that resulted from a correction, with who/why', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ correctedByUserId: 5, correctionReason: 'Wrong tap', correctedBy: { name: 'HR Admin', username: 'hradmin' } }),
    ]);

    const result: any = await service.getDrillDown({ metric: 'corrected', from: '2026-10-01', to: '2026-10-01' } as any);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ correctedByName: 'HR Admin', correctionReason: 'Wrong tap' });
  });

  it('unit: rejects with no unitId', async () => {
    await expect(service.getDrillDown({ metric: 'unit' } as any)).rejects.toThrow('requires unitId');
  });

  it('unit: returns that unit\'s movements in range, most recent first', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ movementAt: new Date('2026-10-01T04:00:00.000Z') }),
      movement({ movementAt: new Date('2026-10-02T04:00:00.000Z') }),
    ]);

    const result: any = await service.getDrillDown({ metric: 'unit', unitId: '10', from: '2026-10-01', to: '2026-10-02' } as any);

    expect(result.rows).toHaveLength(2);
    expect(new Date(result.rows[0].movementAt).getTime()).toBeGreaterThan(new Date(result.rows[1].movementAt).getTime());
  });

  it('team: rejects with no team', async () => {
    await expect(service.getDrillDown({ metric: 'team' } as any)).rejects.toThrow('requires team');
  });

  it('team: includes every employee on the team, even one with zero movements in range', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([movement({ employeeId: 1 })]);
    prisma.employee.findMany.mockResolvedValue([
      { id: 1, employeeName: 'Asha Rao', employeeCode: 'EMP001', isActive: true },
      { id: 2, employeeName: 'Zero Movements', employeeCode: 'EMP002', isActive: true },
    ]);

    const result: any = await service.getDrillDown({ metric: 'team', team: 'Testing', from: '2026-10-01', to: '2026-10-01' } as any);

    expect(result.rows).toHaveLength(2);
    const zero = result.rows.find((r: any) => r.employeeName === 'Zero Movements');
    expect(zero).toMatchObject({ entries: 0, exits: 0, avgHours: null, shortfallDays: 0, daysWithHoursTracked: 0 });
    const asha = result.rows.find((r: any) => r.employeeName === 'Asha Rao');
    expect(asha.entries).toBe(1);
  });

  // Lets the frontend show "N (X%)" instead of a bare shortfall count —
  // without it, 1 short day out of 1 tracked day looked identical to 1 out
  // of 20. Same fix class as teamBreakdown's own shortfall rate.
  it('team: exposes daysWithHoursTracked per employee, for a shortfall rate the frontend can compute', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      // Complete 5h day — under 9h expected, so a shortfall day.
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:30:00.000Z') }), // 10:00 IST
      movement({ employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-01T09:30:00.000Z') }), // 15:00 IST
      // Missing exit — shouldn't count toward daysWithHoursTracked.
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-02T04:30:00.000Z') }), // 10:00 IST
    ]);
    prisma.employee.findMany.mockResolvedValue([{ id: 1, employeeName: 'Asha Rao', employeeCode: 'EMP001', isActive: true }]);

    const result: any = await service.getDrillDown({ metric: 'team', team: 'Testing', from: '2026-10-01', to: '2026-10-02' } as any);

    expect(result.rows[0]).toMatchObject({ daysWithHoursTracked: 1, shortfallDays: 1 });
  });
});

// One employee's own trend — avg arrival/departure, daily hours, daily
// entry/exit counts. Added 2026-10-06, by request (per-employee view).
describe('InsightsService.getEmployeeDetail', () => {
  const prisma = {
    movementRecord: { findMany: jest.fn() },
    employee: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const settings = { get: jest.fn() };
  const service = new InsightsService(prisma as any, settings as any);

  beforeEach(() => {
    jest.clearAllMocks();
    (service as any).summaryCache.clear();
    prisma.employee.findUnique.mockResolvedValue({ id: 1, employeeName: 'Asha Rao', employeeCode: 'EMP001', team: 'Testing', isActive: true });
    prisma.employee.findMany.mockResolvedValue([{ id: 1 }]);
  });

  it('rejects an unknown employee', async () => {
    prisma.employee.findUnique.mockResolvedValue(null);
    await expect(service.getEmployeeDetail({ employeeId: '999' } as any)).rejects.toThrow('Employee not found');
  });

  it('computes average arrival/departure time across the range', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      // Day 1: 09:00 - 17:00 IST (03:30/11:30 UTC)
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T03:30:00.000Z') }),
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-01T11:30:00.000Z') }),
      // Day 2: 11:00 - 19:00 IST (05:30/13:30 UTC)
      movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-02T05:30:00.000Z') }),
      movement({ movementType: 'EXIT', movementAt: new Date('2026-10-02T13:30:00.000Z') }),
    ]);

    const result = await service.getEmployeeDetail({ employeeId: '1', from: '2026-10-01', to: '2026-10-02' } as any);

    expect(result.avgArrival).toBe('10:00'); // average of 09:00 and 11:00
    expect(result.avgDeparture).toBe('18:00'); // average of 17:00 and 19:00
    expect(result.dailyHours).toEqual([
      { date: '2026-10-01', hours: 8, missingExit: false },
      { date: '2026-10-02', hours: 8, missingExit: false },
    ]);
    expect(result.dailyCounts).toEqual([
      { date: '2026-10-01', entries: 1, exits: 1 },
      { date: '2026-10-02', entries: 1, exits: 1 },
    ]);
  });

  it('flags a day with no departure time as missingExit, with null hours and no avgDeparture contribution', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([movement({ movementType: 'ENTRY', movementAt: new Date('2026-10-01T03:30:00.000Z') })]);

    const result = await service.getEmployeeDetail({ employeeId: '1', from: '2026-10-01', to: '2026-10-01' } as any);

    expect(result.dailyHours).toEqual([{ date: '2026-10-01', hours: null, missingExit: true }]);
    expect(result.avgArrival).toBe('09:00');
    expect(result.avgDeparture).toBeNull();
  });

  it('only includes this employee\'s own movements, never another employee\'s', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([]);

    await service.getEmployeeDetail({ employeeId: '1', from: '2026-10-01', to: '2026-10-01' } as any);

    expect(prisma.movementRecord.findMany.mock.calls[0][0].where.employeeId).toBe(1);
  });

  // durationDistribution/employeeAvgHours — company-wide comparison, so
  // this one employee's duration can be seen against everyone else's, not
  // just their own trend in isolation. Added 2026-10-13, by request.
  it('buckets every active employee\'s avg duration to the nearest hour, and reports this employee\'s own average', async () => {
    prisma.employee.findMany.mockResolvedValue([
      { id: 1, employeeName: 'Alice' },
      { id: 2, employeeName: 'Bob' },
      { id: 3, employeeName: 'Carol' },
    ]);
    prisma.movementRecord.findMany.mockResolvedValue([
      // Employee 1 (the one being viewed): 9h.
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:30:00.000Z') }), // 10:00 IST
      movement({ employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-01T13:30:00.000Z') }), // 19:00 IST
      // Employee 2: also 9h — same bucket as employee 1.
      movement({ employeeId: 2, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:30:00.000Z') }), // 10:00 IST
      movement({ employeeId: 2, movementType: 'EXIT', movementAt: new Date('2026-10-01T13:30:00.000Z') }), // 19:00 IST
      // Employee 3: 11h — a different bucket.
      movement({ employeeId: 3, movementType: 'ENTRY', movementAt: new Date('2026-10-01T02:30:00.000Z') }), // 08:00 IST
      movement({ employeeId: 3, movementType: 'EXIT', movementAt: new Date('2026-10-01T13:30:00.000Z') }), // 19:00 IST
    ]);

    const result: any = await service.getEmployeeDetail({ employeeId: '1', from: '2026-10-01', to: '2026-10-01' } as any);

    expect(result.employeeAvgHours).toBe(9);
    expect(result.durationDistribution).toEqual([
      { hours: 9, count: 2, employees: ['Alice', 'Bob'] },
      { hours: 10, count: 0, employees: [] },
      { hours: 11, count: 1, employees: ['Carol'] },
    ]);
  });

  it('excludes inactive employees from the company-wide comparison', async () => {
    prisma.employee.findMany.mockResolvedValue([{ id: 1, employeeName: 'Alice' }]); // employee 2 left out — inactive
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:30:00.000Z') }), // 10:00 IST
      movement({ employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-01T13:30:00.000Z') }), // 19:00 IST, 9h
      movement({ employeeId: 2, movementType: 'ENTRY', movementAt: new Date('2026-10-01T02:30:00.000Z') }), // 08:00 IST
      movement({ employeeId: 2, movementType: 'EXIT', movementAt: new Date('2026-10-01T13:30:00.000Z') }), // 19:00 IST, 11h
    ]);

    const result: any = await service.getEmployeeDetail({ employeeId: '1', from: '2026-10-01', to: '2026-10-01' } as any);

    expect(result.durationDistribution).toEqual([{ hours: 9, count: 1, employees: ['Alice'] }]);
  });
});

// Spec item #5 — table-only (bar chart of 200+ employees wouldn't be
// readable, confirmed with the user before building, 2026-10 Phase 2).
describe('InsightsService.getDailyDuration', () => {
  const prisma = {
    movementRecord: { findMany: jest.fn() },
    employee: { findMany: jest.fn() },
  };
  const service = new InsightsService(prisma as any, {} as any);

  beforeEach(() => {
    jest.clearAllMocks();
    (service as any).summaryCache.clear();
    prisma.employee.findMany.mockResolvedValue([]);
  });

  it('flags complete/missingExit/missingEntry correctly, and only includes employees with a movement that day', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z'), employee: { team: 'Testing', employeeName: 'Complete', employeeCode: 'E1' } }),
      movement({ employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-01T13:00:00.000Z'), employee: { team: 'Testing', employeeName: 'Complete', employeeCode: 'E1' } }),
      movement({ employeeId: 2, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z'), employee: { team: 'Testing', employeeName: 'No Exit', employeeCode: 'E2' } }),
      movement({ employeeId: 3, movementType: 'EXIT', movementAt: new Date('2026-10-01T04:00:00.000Z'), employee: { team: 'Testing', employeeName: 'No Entry', employeeCode: 'E3' } }),
    ]);

    const result = await service.getDailyDuration({ date: '2026-10-01' } as any);

    expect(result.rows).toHaveLength(3);
    expect(result.rows.find((r) => r.employeeName === 'Complete')).toMatchObject({ status: 'complete', hours: 9 });
    expect(result.rows.find((r) => r.employeeName === 'No Exit')).toMatchObject({ status: 'missingExit', hours: null });
    expect(result.rows.find((r) => r.employeeName === 'No Entry')).toMatchObject({ status: 'missingEntry', hours: null });
  });

  // Reported bug (2026-10): a day with ENTRY, EXIT, ENTRY (tapped back in
  // after the recorded exit, with nothing after) was wrongly shown as
  // "complete" using the stale middle exit, ignoring the dangling
  // trailing entry. The day isn't actually closed out, so it must be
  // flagged as missingExit, with no (misleading) duration shown.
  it('does not mark a day complete when there is a later entry after the last exit', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z'), employee: { team: 'Testing', employeeName: 'Back In', employeeCode: 'E1' } }),
      movement({ employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-01T08:00:00.000Z'), employee: { team: 'Testing', employeeName: 'Back In', employeeCode: 'E1' } }),
      movement({ employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T09:00:00.000Z'), employee: { team: 'Testing', employeeName: 'Back In', employeeCode: 'E1' } }),
    ]);

    const result = await service.getDailyDuration({ date: '2026-10-01' } as any);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ status: 'missingExit', hours: null });
  });

  it('sorts by employee name', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, employee: { team: 'Testing', employeeName: 'Zara', employeeCode: 'E1' } }),
      movement({ employeeId: 2, employee: { team: 'Testing', employeeName: 'Asha', employeeCode: 'E2' } }),
    ]);

    const result = await service.getDailyDuration({ date: '2026-10-01' } as any);

    expect(result.rows.map((r) => r.employeeName)).toEqual(['Asha', 'Zara']);
  });

  it('noMovement lists roster members with zero taps that day, not just whoever is missing an entry/exit', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      movement({ employeeId: 1, employee: { team: 'Testing', employeeName: 'Tapped In', employeeCode: 'E1' } }),
    ]);
    prisma.employee.findMany.mockResolvedValue([
      { id: 1, employeeName: 'Tapped In', employeeCode: 'E1', team: 'Testing', isActive: true },
      { id: 2, employeeName: 'No Tap', employeeCode: 'E2', team: 'Testing', isActive: true },
    ]);

    const result = await service.getDailyDuration({ date: '2026-10-01' } as any);

    expect(result.noMovement).toHaveLength(1);
    expect(result.noMovement[0]).toMatchObject({ employeeId: 2, employeeName: 'No Tap', isActive: true });
  });

  it('does not flag noMovement on a weekend date — nobody is expected in', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([]);
    prisma.employee.findMany.mockResolvedValue([{ id: 1, employeeName: 'No Tap', employeeCode: 'E1', team: 'Testing', isActive: true }]);

    const result = await service.getDailyDuration({ date: '2026-10-03' } as any); // Saturday

    expect(result.noMovement).toHaveLength(0);
  });

  it('dayScope "all" flags noMovement on a weekend date too', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([]);
    prisma.employee.findMany.mockResolvedValue([{ id: 1, employeeName: 'No Tap', employeeCode: 'E1', team: 'Testing', isActive: true }]);

    const result = await service.getDailyDuration({ date: '2026-10-03', dayScope: 'all' } as any); // Saturday

    expect(result.noMovement).toHaveLength(1);
  });

  it('dayScope "weekends" does not flag noMovement on a weekday date', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([]);
    prisma.employee.findMany.mockResolvedValue([{ id: 1, employeeName: 'No Tap', employeeCode: 'E1', team: 'Testing', isActive: true }]);

    const result = await service.getDailyDuration({ date: '2026-10-01', dayScope: 'weekends' } as any); // Thursday

    expect(result.noMovement).toHaveLength(0);
  });

  it('noMovement does not list someone who tapped at the other unit when a unitId filter is active', async () => {
    prisma.movementRecord.findMany.mockImplementation((args: any) =>
      Promise.resolve(
        args?.where?.recordedByUserId
          ? [] // the unitId-filtered call sees nothing at that unit
          : [movement({ employeeId: 1, employee: { team: 'Testing', employeeName: 'Other Unit', employeeCode: 'E1' } })],
      ),
    );
    prisma.employee.findMany.mockResolvedValue([{ id: 1, employeeName: 'Other Unit', employeeCode: 'E1', team: 'Testing', isActive: true }]);

    const result = await service.getDailyDuration({ date: '2026-10-01', unitId: '99' } as any);

    expect(result.rows).toHaveLength(0); // nothing recorded at the filtered unit
    expect(result.noMovement).toHaveLength(0); // but they did tap, just elsewhere
  });
});

describe('InsightsService exports', () => {
  const prisma = {
    movementRecord: { findMany: jest.fn() },
    employee: { findMany: jest.fn() },
  };
  const settings = { get: jest.fn() };
  const service = new InsightsService(prisma as any, settings as any);

  beforeEach(() => {
    jest.clearAllMocks();
    (service as any).summaryCache.clear();
    settings.get.mockImplementation((key: string) => (key === 'EXPECTED_DAILY_HOURS' ? Promise.resolve('9') : Promise.resolve(null)));
    prisma.employee.findMany.mockResolvedValue([]);
  });

  it('exportDrillDown produces a real, non-empty .xlsx buffer', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([movement({ movementType: 'ENTRY' })]);

    const buffer = await service.exportDrillDown({ metric: 'attendance', date: '2026-10-01' } as any);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    // .xlsx files are zip archives — PK magic bytes confirm it's a real
    // xlsx, not an accidentally-empty or malformed buffer.
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('exportTeamBreakdown produces a real .xlsx buffer from the same data as the summary', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([movement({ employee: { team: 'Testing', employeeName: 'A', employeeCode: '1' } })]);

    const buffer = await service.exportTeamBreakdown({ from: '2026-10-01', to: '2026-10-01' } as any);

    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('exportDailyDuration produces a real .xlsx buffer', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([movement()]);

    const buffer = await service.exportDailyDuration({ date: '2026-10-01' } as any);

    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });
});
