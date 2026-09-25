import { AuditLogService } from './audit-log.service';
import { dayRange } from '../common/utils/day-range';

describe('AuditLogService', () => {
  it('sanitizes sensitive payload fields before storing audit entries', async () => {
    const prisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    const service = new AuditLogService(prisma as any);

    await service.record({
      action: 'USER_UPDATED',
      entityType: 'User',
      entityId: 42,
      oldValue: {
        id: 42,
        name: 'Alice',
        email: 'alice@example.com',
        passwordHash: 'secret-hash',
        refreshToken: 'token-value',
      },
      newValue: {
        id: 42,
        name: 'Alice Updated',
        email: 'alice@example.com',
        isActive: true,
      },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        action: 'USER_UPDATED',
        entityType: 'User',
        entityId: 42,
        oldValue: {
          id: 42,
          name: 'Alice',
          email: 'alice@example.com',
        },
        newValue: {
          id: 42,
          name: 'Alice Updated',
          email: 'alice@example.com',
          isActive: true,
        },
        ipAddress: undefined,
        userAgent: undefined,
      },
    });
  });

  it('retains compact summaries for employee records without storing full objects', async () => {
    const prisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    const service = new AuditLogService(prisma as any);

    await service.record({
      action: 'EMPLOYEE_UPDATED',
      entityType: 'Employee',
      entityId: 7,
      oldValue: {
        id: 7,
        employeeName: 'Asha',
        employeeCode: 'EMP-7',
        carNumber: 'MH12AB1234',
        isActive: true,
        passwordHash: 'should-not-store',
      },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        oldValue: {
          id: 7,
          employeeName: 'Asha',
          employeeCode: 'EMP-7',
          carNumber: 'MH12AB1234',
          isActive: true,
        },
      }),
    });
  });

  describe('list', () => {
    function makeService() {
      const prisma = { auditLog: { findMany: jest.fn().mockResolvedValue([]) } };
      return { service: new AuditLogService(prisma as any), prisma };
    }

    it('always orders newest-first', async () => {
      const { service, prisma } = makeService();
      await service.list({});
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' } }));
    });

    it('filters by a from/to date range, using the same local-day boundaries as every other date-scoped query', async () => {
      const { service, prisma } = makeService();
      await service.list({ from: '2026-09-01', to: '2026-09-10' });
      const call = prisma.auditLog.findMany.mock.calls[0][0];
      expect(call.where.createdAt.gte).toEqual(dayRange('2026-09-01').start);
      // `to` is exclusive of the day AFTER, so a full day's worth of
      // entries on the `to` date itself are still included.
      expect(call.where.createdAt.lt).toEqual(dayRange('2026-09-10').end);
    });

    it('rejects a malformed from/to date the same way every other date-scoped query does', async () => {
      const { service } = makeService();
      await expect(service.list({ from: 'not-a-date' })).rejects.toThrow(/Invalid date/);
    });

    it('searches action, entity type, IP address, and performing-user name by keyword', async () => {
      const { service, prisma } = makeService();
      await service.list({ q: 'entry' });
      const call = prisma.auditLog.findMany.mock.calls[0][0];
      expect(call.where.OR).toEqual([
        { action: { contains: 'entry', mode: 'insensitive' } },
        { entityType: { contains: 'entry', mode: 'insensitive' } },
        { ipAddress: { contains: 'entry', mode: 'insensitive' } },
        { user: { name: { contains: 'entry', mode: 'insensitive' } } },
      ]);
    });

    it('omits the OR clause entirely when q is blank/whitespace', async () => {
      const { service, prisma } = makeService();
      await service.list({ q: '   ' });
      const call = prisma.auditLog.findMany.mock.calls[0][0];
      expect(call.where.OR).toBeUndefined();
    });

    // A caller could otherwise pass an arbitrarily large `take` and force
    // one huge query/response. Found in the 2026-09-25 audit.
    it('caps take at 200 regardless of what the caller requests', async () => {
      const { service, prisma } = makeService();
      await service.list({ take: 999_999 });
      expect(prisma.auditLog.findMany.mock.calls[0][0].take).toBe(200);
    });

    it('defaults take to 50 when not specified', async () => {
      const { service, prisma } = makeService();
      await service.list({});
      expect(prisma.auditLog.findMany.mock.calls[0][0].take).toBe(50);
    });
  });
});
