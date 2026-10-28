import ExcelJS from 'exceljs';
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

  describe('exportToExcel', () => {
    function makeService() {
      const prisma = { auditLog: { findMany: jest.fn() } };
      return { service: new AuditLogService(prisma as any), prisma };
    }

    async function firstSheetRows(buffer: Buffer) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const sheet = workbook.getWorksheet('Audit Log')!;
      const rows: string[][] = [];
      sheet.eachRow((row) => rows.push(row.values as any));
      return rows;
    }

    // Was `row.createdAt.toISOString()` — raw UTC, while the same row on
    // screen renders in the app's timezone (effectively IST). A 2am IST
    // row exported 5h30m off and on the previous calendar date. Found in
    // the 2026-10-28 audit.
    it('renders the Time column in the app timezone, not raw UTC', async () => {
      process.env.APP_TIMEZONE = 'Asia/Kolkata';
      const { service, prisma } = makeService();
      // 2026-10-27T02:00:00+05:30 == 2026-10-26T20:30:00.000Z
      prisma.auditLog.findMany.mockResolvedValue([
        { createdAt: new Date('2026-10-26T20:30:00.000Z'), action: 'USER_LOGIN', entityType: null, entityId: null, ipAddress: null, user: null },
      ]);

      const buffer = await service.exportToExcel({});
      const rows = await firstSheetRows(buffer);

      expect(rows[1][1]).toContain('27/10/2026');
      expect(rows[1][1]).not.toContain('2026-10-26');
    });

    // The cap is deliberate (an unbounded export is its own resource-
    // exhaustion risk), but nothing told the admin it was hit — an
    // unfiltered export past this many rows silently handed back only the
    // newest ones in a file that looked complete. Found in the 2026-10-28
    // audit.
    it('appends a visible warning row when the export hits the row cap', async () => {
      const { service, prisma } = makeService();
      const rows = Array.from({ length: 5000 }, (_, i) => ({
        createdAt: new Date('2026-10-26T04:00:00.000Z'),
        action: 'USER_LOGIN',
        entityType: null,
        entityId: null,
        ipAddress: null,
        user: null,
        id: i,
      }));
      prisma.auditLog.findMany.mockResolvedValue(rows);

      const buffer = await service.exportToExcel({});
      const sheetRows = await firstSheetRows(buffer);

      expect(sheetRows.some((r) => r.join(' ').includes('capped at 5000'))).toBe(true);
    });

    it('does not append a warning row when the export is under the cap', async () => {
      const { service, prisma } = makeService();
      prisma.auditLog.findMany.mockResolvedValue([
        { createdAt: new Date('2026-10-26T04:00:00.000Z'), action: 'USER_LOGIN', entityType: null, entityId: null, ipAddress: null, user: null },
      ]);

      const buffer = await service.exportToExcel({});
      const sheetRows = await firstSheetRows(buffer);

      expect(sheetRows.some((r) => r.join(' ').includes('capped'))).toBe(false);
    });
  });
});
