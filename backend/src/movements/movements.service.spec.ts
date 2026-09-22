import { NotFoundException } from '@nestjs/common';
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

describe('MovementsService corrections', () => {
  it('corrects append-only by superseding the original and linking a new record', async () => {
    const { service, prisma, auditLog } = makeService();
    const original = { id: 10, employeeId: 7, movementType: 'ENTRY', recordedByUserId: 3 };
    const corrected = { id: 11, employeeId: 7, movementType: 'EXIT' };
    prisma.movementRecord.findUnique.mockResolvedValueOnce(original);
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.$transaction.mockResolvedValue([{}, corrected]);

    await expect(
      service.correctMovement(
        10,
        { employeeId: 7, movementType: 'EXIT', movementAt: '2026-09-10T08:00:00.000Z', correctionReason: 'Wrong tap' },
        9,
      ),
    ).resolves.toBe(corrected);

    expect(prisma.$transaction).toHaveBeenCalledWith([
      expect.objectContaining({}),
      expect.objectContaining({}),
    ]);
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'RECORD_CORRECTED', entityId: 11 }));
  });

  it('rejects corrections for a missing employee', async () => {
    const { service, prisma } = makeService();
    prisma.movementRecord.findUnique.mockResolvedValue({ id: 10, employeeId: 7 });
    prisma.employee.findUnique.mockResolvedValue(null);

    await expect(
      service.correctMovement(
        10,
        { employeeId: 99, movementType: 'EXIT', movementAt: '2026-09-10T08:00:00.000Z', correctionReason: 'Wrong tap' },
        9,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('adds a missing record and audits it', async () => {
    const { service, prisma, auditLog } = makeService();
    const record = { id: 12, employeeId: 7, movementType: 'ENTRY' };
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.create.mockResolvedValue(record);

    await expect(
      service.addMissingRecord(
        { employeeId: 7, movementType: 'ENTRY', movementAt: '2026-09-10T08:00:00.000Z', correctionReason: 'Forgotten tap' },
        9,
      ),
    ).resolves.toBe(record);
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'MISSING_RECORD_ADDED', entityId: 12 }));
  });
});
