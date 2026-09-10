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
    $transaction: jest.fn(),
  };
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
  return { service: new MovementsService(prisma as any, auditLog as any), prisma, auditLog };
}

describe('MovementsService.createMovement', () => {
  it('warns on a repeated movement without writing', async () => {
    const { service, prisma, auditLog } = makeService();
    prisma.employee.findUnique.mockResolvedValue({ id: 7 });
    prisma.movementRecord.findUnique.mockResolvedValue(null);
    prisma.movementRecord.findFirst.mockResolvedValue({ movementType: 'ENTRY' });

    await expect(service.createMovement({ employeeId: 7, movementType: 'ENTRY' }, 3)).resolves.toEqual({
      created: false,
      requiresConfirmation: true,
      lastMovementType: 'ENTRY',
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
      }),
      include: { employee: true },
    });
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ENTRY_RECORDED', entityId: 21 }));
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
