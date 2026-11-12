import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const prisma = {
    employee: { findUnique: jest.fn() },
    movementRecord: { findMany: jest.fn() },
    emailLog: { create: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  const settings = {
    get: jest.fn(),
  };

  const auditLog = { record: jest.fn() };
  const generator = { generatePng: jest.fn(), generatePdf: jest.fn(), generateDashboardPdf: jest.fn() };
  const storage = { uploadReport: jest.fn(), getSignedDownloadUrl: jest.fn() };
  const email = { sendMovementRecordEmail: jest.fn() };
  const movements = { listWithFilters: jest.fn() };

  let service: ReportsService;

  beforeEach(() => {
    jest.clearAllMocks();

    settings.get.mockImplementation(async (key: string) => {
      if (key === 'COMPANY_NAME') return 'Adage';
      return null;
    });
    // The sending account's own login email is the CC — the unit that
    // account belongs to (2026-09-25 multi-unit change), not a settings
    // value.
    prisma.user.findUnique.mockResolvedValue({ email: 'securityunit1@adage-automation.com' });
    prisma.employee.findUnique.mockResolvedValue({
      id: 1,
      employeeName: 'Test Employee',
      employeeCode: 'ADG1024',
      email: 'employee@example.com',
    });
    prisma.movementRecord.findMany.mockResolvedValue([]);
    prisma.emailLog.create.mockResolvedValue({ id: 77 });
    prisma.emailLog.update.mockImplementation(async (_args: any) => ({
      id: 77,
      status: 'SENT',
      reportFileUrl: 'email-reports/ADG1024/2026-09-10-77.png',
      reportFileFormat: 'PNG',
    }));
    generator.generatePng.mockResolvedValue(Buffer.from('png'));
    generator.generateDashboardPdf.mockResolvedValue(Buffer.from('pdf'));
    movements.listWithFilters.mockResolvedValue([]);
    storage.uploadReport.mockResolvedValue(undefined);
    // Resolves with the address actually used as sender (2026-09-28) —
    // may differ from the intended `from` if EmailService fell back.
    email.sendMovementRecordEmail.mockResolvedValue('securityunit1@adage-automation.com');
    auditLog.record.mockResolvedValue(undefined);

    service = new ReportsService(
      prisma as any,
      settings as any,
      auditLog as any,
      generator as any,
      storage as any,
      email as any,
      movements as any,
    );
  });

  it('collapses a filtered employee day down to first entry and last exit', async () => {
    movements.listWithFilters.mockResolvedValue([
      {
        employeeId: 1,
        movementAt: new Date('2026-09-10T12:00:00Z'),
        movementType: 'EXIT',
        employee: { employeeName: 'Test Employee', employeeCode: 'ADG1024' },
        recordedBy: { id: 3, name: 'Unit 1' },
      },
      {
        employeeId: 1,
        movementAt: new Date('2026-09-10T04:00:00Z'),
        movementType: 'ENTRY',
        employee: { employeeName: 'Test Employee', employeeCode: 'ADG1024' },
        recordedBy: { id: 3, name: 'Unit 1' },
      },
      {
        employeeId: 1,
        movementAt: new Date('2026-09-10T08:00:00Z'),
        movementType: 'ENTRY',
        employee: { employeeName: 'Test Employee', employeeCode: 'ADG1024' },
        recordedBy: { id: 3, name: 'Unit 1' },
      },
    ]);

    const result = await service.downloadDashboardPdf({ date: '2026-09-10', employeeId: 1, recordedByUserId: 3 });

    expect(movements.listWithFilters).toHaveBeenCalledWith({ date: '2026-09-10', employeeId: 1, movementType: undefined, recordedByUserId: 3 });
    expect(generator.generateDashboardPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        filterLabel: 'Employee: Test Employee · Recorded By: Unit 1',
        rows: [
          {
            employeeName: 'Test Employee',
            employeeCode: 'ADG1024',
            firstEntry: new Date('2026-09-10T04:00:00Z'),
            lastExit: new Date('2026-09-10T12:00:00Z'),
          },
        ],
      }),
    );
    expect(result).toEqual({ buffer: Buffer.from('pdf'), filename: 'attendance_2026-09-10.pdf' });
  });

  it('falls back to a direct lookup for the filter label when no rows match', async () => {
    movements.listWithFilters.mockResolvedValue([]);
    prisma.employee.findUnique.mockResolvedValue({ employeeName: 'Test Employee' });

    await service.downloadDashboardPdf({ date: '2026-09-10', employeeId: 1 });

    expect(prisma.employee.findUnique).toHaveBeenCalledWith({ where: { id: 1 }, select: { employeeName: true } });
    expect(generator.generateDashboardPdf).toHaveBeenCalledWith(expect.objectContaining({ filterLabel: 'Employee: Test Employee' }));
  });

  it('sends the daily record email and marks the log as SENT', async () => {
    const result = await service.emailDailyRecord(1, '2026-09-10', 9);

    expect(prisma.emailLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ employeeId: 1, movementDate: expect.any(Date), status: 'PENDING' }),
      }),
    );
    expect(generator.generatePng).toHaveBeenCalledTimes(1);
    expect(storage.uploadReport).toHaveBeenCalledWith(
      'email-reports/ADG1024/2026-09-10-77.png',
      expect.any(Buffer),
      'image/png',
    );
    expect(email.sendMovementRecordEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'employee@example.com',
        cc: 'securityunit1@adage-automation.com',
        from: 'securityunit1@adage-automation.com',
      }),
    );
    expect(prisma.emailLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 77 },
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EMAIL_SENT' }),
    );
    expect(result.status).toBe('SENT');
  });

  it('CCs and sends from whichever unit account actually triggered it, not a fixed address', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'securityunit2@adage-automation.com' });

    await service.emailDailyRecord(1, '2026-09-10', 14);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 14 }, select: { email: true } });
    expect(email.sendMovementRecordEmail).toHaveBeenCalledWith(
      expect.objectContaining({ cc: 'securityunit2@adage-automation.com', from: 'securityunit2@adage-automation.com' }),
    );
  });

  it('sends with no CC and no dynamic from when the sending account has no email on file', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await service.emailDailyRecord(1, '2026-09-10', 9);

    expect(email.sendMovementRecordEmail).toHaveBeenCalledWith(
      expect.objectContaining({ cc: undefined, from: undefined }),
    );
  });

  it('persists the address actually used as sender, even when it differs from the intended one', async () => {
    // EmailService silently falls back to the fixed MAIL_FROM_ADDRESS when
    // the dynamic "from" is rejected (e.g. not yet in the Exchange access
    // policy's scope group) — the intended sender (cc) and the actual
    // sender can legitimately differ. Found in the 2026-09-28 security
    // audit: previously this fallback was only ever a Render log line,
    // with no way to reconstruct after the fact which address a given
    // email actually came from.
    email.sendMovementRecordEmail.mockResolvedValue('security@adage-automation.com');

    await service.emailDailyRecord(1, '2026-09-10', 9);

    expect(prisma.emailLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 77 },
        data: expect.objectContaining({ status: 'SENT', senderAddress: 'security@adage-automation.com' }),
      }),
    );
  });

  it('marks the email log as FAILED when sending throws', async () => {
    generator.generatePng.mockRejectedValue(new Error('png generation failed'));
    prisma.emailLog.update.mockResolvedValue({ id: 77, status: 'FAILED', errorMessage: 'png generation failed' });

    // The real cause is persisted on the FAILED row (asserted below) —
    // what's thrown to the client is a friendlier, generic message so
    // internals aren't leaked. See reports.service.ts.
    await expect(service.emailDailyRecord(1, '2026-09-10', 9)).rejects.toThrow('Failed to send email');

    expect(prisma.emailLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 77 },
        data: expect.objectContaining({ status: 'FAILED', errorMessage: 'png generation failed' }),
      }),
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EMAIL_FAILED' }),
    );
  });
});
