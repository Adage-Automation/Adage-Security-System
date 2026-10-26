import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MovementsService } from './movements.service';

function makeService() {
  const prisma = {
    employee: { findUnique: jest.fn() },
    movementRecord: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    // createMovement wraps its per-employee advisory lock + duplicate
    // check + create in an interactive transaction (2026-09-22 audit fix
    // for the concurrent-device race). The mock's "tx" is just this same
    // prisma object plus a no-op $queryRaw (the advisory-lock call) — the
    // service code only cares that tx.movementRecord.* and tx.$queryRaw
    // exist, not that it's a real separate connection.
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: any) => fn(prisma));
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
  return { service: new MovementsService(prisma as any, auditLog as any), prisma, auditLog };
}

describe('MovementsService.createMovement', () => {
  it('warns on a repeated movement without writing, including when it last happened', async () => {
    const { service, prisma, auditLog } = makeService();
    const lastMovementAt = new Date('2026-09-22T09:03:00.000Z');
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.findUnique.mockResolvedValue(null);
    prisma.movementRecord.findFirst.mockResolvedValue({ movementType: 'ENTRY', movementAt: lastMovementAt });

    await expect(service.createMovement({ employeeId: 7, movementType: 'ENTRY' }, 3)).resolves.toEqual({
      created: false,
      requiresConfirmation: true,
      lastMovementType: 'ENTRY',
      lastMovementAt,
    });
    expect(prisma.movementRecord.create).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('returns the existing record for an idempotency replay', async () => {
    const { service, prisma, auditLog } = makeService();
    const existing = { id: 20, employeeId: 7, movementType: 'ENTRY', recordedByUserId: 3 };
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.findUnique.mockResolvedValue(existing);

    await expect(service.createMovement({ employeeId: 7, movementType: 'ENTRY', clientRequestId: 'tap-1' }, 3)).resolves.toEqual({
      created: true,
      requiresConfirmation: false,
      record: existing,
    });
    expect(prisma.movementRecord.create).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('creates a confirmed movement with a server-side timestamp and audit entry', async () => {
    const { service, prisma, auditLog } = makeService();
    const record = { id: 21, employeeId: 7, movementType: 'ENTRY' };
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.findUnique.mockResolvedValue(null);
    prisma.movementRecord.findFirst.mockResolvedValue({ movementType: 'EXIT' });
    prisma.movementRecord.create.mockResolvedValue(record);

    const result = await service.createMovement(
      { employeeId: 7, movementType: 'ENTRY', confirmed: true, clientRequestId: 'tap-2' },
      3,
      '127.0.0.1',
      'test-agent',
    );

    expect(result.record).toBe(record);
    expect(prisma.movementRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 7,
        movementType: 'ENTRY',
        recordedByUserId: 3,
        clientRequestId: 'tap-2',
        movementAt: expect.any(Date),
        recordedOffline: false,
      }),
      include: { employee: true },
    });
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ENTRY_RECORDED', entityId: 21 }));
  });

  it('uses a plausible client-supplied timestamp from the offline queue and flags it', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.findUnique.mockResolvedValue(null);
    prisma.movementRecord.findFirst.mockResolvedValue({ movementType: 'EXIT' });
    prisma.movementRecord.create.mockResolvedValue({ id: 30 });

    // 2 hours ago — well within the 48h window.
    const clientMovementAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await service.createMovement({ employeeId: 7, movementType: 'ENTRY', confirmed: true, clientMovementAt }, 3);

    expect(prisma.movementRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        movementAt: new Date(clientMovementAt),
        recordedOffline: true,
      }),
      include: { employee: true },
    });
  });

  it('accepts a client-supplied timestamp several days in the past, within the 7-day window', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.findUnique.mockResolvedValue(null);
    prisma.movementRecord.findFirst.mockResolvedValue({ movementType: 'EXIT' });
    prisma.movementRecord.create.mockResolvedValue({ id: 33 });

    // 3 days ago — within the 7-day window (an extended-leave/broken-phone case).
    const clientMovementAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await service.createMovement({ employeeId: 7, movementType: 'ENTRY', confirmed: true, clientMovementAt }, 3);

    expect(prisma.movementRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        movementAt: new Date(clientMovementAt),
        recordedOffline: true,
      }),
      include: { employee: true },
    });
  });

  it('discards a client-supplied timestamp that is implausibly far in the past', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.findUnique.mockResolvedValue(null);
    prisma.movementRecord.findFirst.mockResolvedValue({ movementType: 'EXIT' });
    prisma.movementRecord.create.mockResolvedValue({ id: 31 });

    // 10 days ago — outside the 7-day window.
    const clientMovementAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await service.createMovement({ employeeId: 7, movementType: 'ENTRY', confirmed: true, clientMovementAt }, 3);

    const call = prisma.movementRecord.create.mock.calls[0][0];
    expect(call.data.recordedOffline).toBe(false);
    expect(call.data.movementAt).not.toEqual(new Date(clientMovementAt));
    expect(Date.now() - call.data.movementAt.getTime()).toBeLessThan(5000);
  });

  it('discards a client-supplied timestamp that is in the future beyond clock-skew tolerance', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.findUnique.mockResolvedValue(null);
    prisma.movementRecord.findFirst.mockResolvedValue({ movementType: 'EXIT' });
    prisma.movementRecord.create.mockResolvedValue({ id: 32 });

    // 1 hour in the future — outside the 5-minute tolerance.
    const clientMovementAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await service.createMovement({ employeeId: 7, movementType: 'ENTRY', confirmed: true, clientMovementAt }, 3);

    const call = prisma.movementRecord.create.mock.calls[0][0];
    expect(call.data.recordedOffline).toBe(false);
    expect(Date.now() - call.data.movementAt.getTime()).toBeLessThan(5000);
  });

  it('recovers a concurrent idempotency conflict by returning the committed row', async () => {
    const { service, prisma } = makeService();
    const existing = { id: 22, employeeId: 7, movementType: 'EXIT', recordedByUserId: 3 };
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    prisma.movementRecord.findFirst.mockResolvedValue({ movementType: 'ENTRY' });
    prisma.movementRecord.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.createMovement({ employeeId: 7, movementType: 'EXIT', clientRequestId: 'tap-3' }, 3)).resolves.toEqual({
      created: true,
      requiresConfirmation: false,
      record: existing,
    });
  });

  it('serializes the check-then-write per employee behind a Postgres advisory lock', async () => {
    // Guards against the concurrent-device race (2026-09-22 audit): two
    // near-simultaneous taps for the same employee must not both read
    // "last movement" before either commits. We can't simulate real
    // concurrency in a unit test, but we can assert the lock is acquired,
    // scoped to this employeeId, and acquired BEFORE the duplicate-type
    // check runs — the ordering that actually closes the race.
    const { service, prisma } = makeService();
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.findUnique.mockResolvedValue(null);
    prisma.movementRecord.findFirst.mockResolvedValue({ movementType: 'EXIT' });
    prisma.movementRecord.create.mockResolvedValue({ id: 30, employeeId: 7, movementType: 'ENTRY' });

    const callOrder: string[] = [];
    prisma.$executeRaw.mockImplementation(() => {
      callOrder.push('lock');
      return Promise.resolve(undefined);
    });
    prisma.movementRecord.findFirst.mockImplementation(() => {
      callOrder.push('duplicate-check');
      return Promise.resolve({ movementType: 'EXIT' });
    });

    await service.createMovement({ employeeId: 7, movementType: 'ENTRY' }, 3);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // The advisory-lock key must be this employee's id — a lock scoped to
    // the wrong id (or a shared/global key) would either not protect this
    // employee at all, or needlessly serialize unrelated employees'
    // requests against each other.
    const [strings, ...values] = prisma.$executeRaw.mock.calls[0];
    expect(strings.join('?')).toContain('pg_advisory_xact_lock');
    expect(values).toEqual([7]);
    expect(callOrder).toEqual(['lock', 'duplicate-check']);
  });
});

describe('MovementsService.addMissingRecord', () => {
  // "Correct" an existing record was removed entirely (2026-10-23) — only
  // a genuinely missing ENTRY/EXIT can be added, never an edit of a record
  // that already has a real recorded time. correctMovement() no longer
  // exists; these tests replace the old 'MovementsService corrections'
  // describe block.
  it('adds a missing record when nothing of that type is recorded for the employee that day', async () => {
    const { service, prisma, auditLog } = makeService();
    const record = { id: 12, employeeId: 7, movementType: 'ENTRY' };
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.findFirst.mockResolvedValue(null);
    prisma.movementRecord.create.mockResolvedValue(record);

    await expect(
      service.addMissingRecord(
        { employeeId: 7, movementType: 'ENTRY', movementAt: '2026-09-10T08:00:00.000Z', correctionReason: 'Forgotten tap' },
        9,
      ),
    ).resolves.toBe(record);
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 9, action: 'MISSING_MOVEMENT_ADDED', entityType: 'MovementRecord', entityId: 12, newValue: record }),
    );
  });

  it('adds a missing record with no reason at all — optional, not required, since 2026-10-26', async () => {
    const { service, prisma, auditLog } = makeService();
    const record = { id: 13, employeeId: 7, movementType: 'EXIT', correctionReason: null };
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.findFirst.mockResolvedValue(null);
    prisma.movementRecord.create.mockResolvedValue(record);

    await expect(
      service.addMissingRecord({ employeeId: 7, movementType: 'EXIT', movementAt: '2026-09-10T08:00:00.000Z' } as any, 9),
    ).resolves.toBe(record);
    expect(prisma.movementRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ correctionReason: undefined }) }));
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'MISSING_MOVEMENT_ADDED', entityId: 13 }));
  });

  it('rejects adding a movement type that is already recorded for this employee that day — nothing missing to add', async () => {
    const { service, prisma, auditLog } = makeService();
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.findFirst.mockResolvedValue({ id: 5, employeeId: 7, movementType: 'ENTRY' });

    await expect(
      service.addMissingRecord(
        { employeeId: 7, movementType: 'ENTRY', movementAt: '2026-09-10T08:00:00.000Z', correctionReason: 'Thought it was missing' },
        9,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.movementRecord.create).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('serializes the duplicate-type check and the insert under a per-employee advisory lock, so a concurrent live tap cannot land in between and recreate the duplicate the check is meant to prevent', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.findFirst.mockResolvedValue(null);
    prisma.movementRecord.create.mockResolvedValue({ id: 12, employeeId: 7, movementType: 'ENTRY' });

    await service.addMissingRecord(
      { employeeId: 7, movementType: 'ENTRY', movementAt: '2026-09-10T08:00:00.000Z', correctionReason: 'Forgotten tap' },
      9,
    );

    // Same lock-scoping check as createMovement's own test — the key must
    // be this employee's id, not a shared/global one.
    const [strings, ...values] = prisma.$executeRaw.mock.calls[0];
    expect(strings.join('?')).toContain('pg_advisory_xact_lock');
    expect(values).toEqual([7]);
  });

  it('rejects adding a record for a missing employee', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findUnique.mockResolvedValue(null);

    await expect(
      service.addMissingRecord(
        { employeeId: 99, movementType: 'ENTRY', movementAt: '2026-09-10T08:00:00.000Z', correctionReason: 'Forgotten tap' },
        9,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.movementRecord.findFirst).not.toHaveBeenCalled();
    expect(prisma.movementRecord.create).not.toHaveBeenCalled();
  });
});

describe('MovementsService.missingInRange', () => {
  // Backs the Missing Movements page's own list — scoped to
  // CORRECT_RECORDS so Security (who has that but not VIEW_REPORTS) can
  // use it without reaching into Insights. Presence-only PER CALENDAR
  // DAY, same simple rule addMissingRecord itself uses (not Insights'
  // stricter isDayComplete). Added 2026-10-26, by request; widened from a
  // single `date` to a `from`/`to` range the same day so the page's
  // Attendance Month view can list gaps across a whole cycle.
  it('lists only employees with exactly one of ENTRY/EXIT that day, labeled by whichever is missing', async () => {
    const { service, prisma } = makeService();
    prisma.movementRecord.findMany.mockResolvedValue([
      // Alice: only ENTRY -> missing EXIT.
      { employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z'), employee: { employeeName: 'Alice', employeeCode: 'E1', team: 'Testing' } },
      // Bob: only EXIT -> missing ENTRY.
      { employeeId: 2, movementType: 'EXIT', movementAt: new Date('2026-10-01T10:00:00.000Z'), employee: { employeeName: 'Bob', employeeCode: 'E2', team: null } },
      // Carol: both -> not missing anything, excluded entirely.
      { employeeId: 3, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z'), employee: { employeeName: 'Carol', employeeCode: 'E3', team: 'Testing' } },
      { employeeId: 3, movementType: 'EXIT', movementAt: new Date('2026-10-01T10:00:00.000Z'), employee: { employeeName: 'Carol', employeeCode: 'E3', team: 'Testing' } },
    ]);

    const result = await service.missingInRange('2026-10-01', '2026-10-01');

    expect(result).toEqual([
      { date: '2026-10-01', employeeId: 1, employeeName: 'Alice', employeeCode: 'E1', team: 'Testing', status: 'missingExit' },
      { date: '2026-10-01', employeeId: 2, employeeName: 'Bob', employeeCode: 'E2', team: null, status: 'missingEntry' },
    ]);
  });

  it('returns an empty list when nobody is missing a movement in range', async () => {
    const { service, prisma } = makeService();
    prisma.movementRecord.findMany.mockResolvedValue([]);

    await expect(service.missingInRange('2026-10-01', '2026-10-01')).resolves.toEqual([]);
  });

  it('evaluates presence per calendar day across a multi-day range — present on one day never covers a gap on another', async () => {
    const { service, prisma } = makeService();
    prisma.movementRecord.findMany.mockResolvedValue([
      // Day 1: Alice has only ENTRY -> missing EXIT that day.
      { employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-01T04:00:00.000Z'), employee: { employeeName: 'Alice', employeeCode: 'E1', team: 'Testing' } },
      // Day 2: the same Alice has both -> not missing anything that day.
      { employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-10-02T04:00:00.000Z'), employee: { employeeName: 'Alice', employeeCode: 'E1', team: 'Testing' } },
      { employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-10-02T10:00:00.000Z'), employee: { employeeName: 'Alice', employeeCode: 'E1', team: 'Testing' } },
    ]);

    const result = await service.missingInRange('2026-10-01', '2026-10-02');

    expect(result).toEqual([{ date: '2026-10-01', employeeId: 1, employeeName: 'Alice', employeeCode: 'E1', team: 'Testing', status: 'missingExit' }]);
  });
});
