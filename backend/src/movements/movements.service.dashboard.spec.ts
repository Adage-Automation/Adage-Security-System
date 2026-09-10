import { MovementsService } from './movements.service';

describe('MovementsService dashboard queries', () => {
  const prisma = {
    movementRecord: { findMany: jest.fn() },
  };
  const service = new MovementsService(prisma as any, {} as any);

  beforeEach(() => jest.clearAllMocks());

  it('applies date, employee, and movement-type filters', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([]);

    await service.listWithFilters({ date: '2026-09-10', employeeId: 7, movementType: 'ENTRY' });

    expect(prisma.movementRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isSuperseded: false, employeeId: 7, movementType: 'ENTRY', movementAt: expect.any(Object) }),
      orderBy: { movementAt: 'desc' },
    }));
  });

  it('summarizes unique employees, entries, exits, and currently inside', async () => {
    prisma.movementRecord.findMany.mockResolvedValue([
      { employeeId: 1, movementType: 'ENTRY', movementAt: new Date('2026-09-10T08:00:00Z') },
      { employeeId: 1, movementType: 'EXIT', movementAt: new Date('2026-09-10T12:00:00Z') },
      { employeeId: 2, movementType: 'ENTRY', movementAt: new Date('2026-09-10T09:00:00Z') },
    ]);

    await expect(service.summaryForDate('2026-09-10')).resolves.toEqual({
      totalEmployees: 2,
      totalEntries: 2,
      totalExits: 1,
      currentlyInside: 1,
    });
  });
});
