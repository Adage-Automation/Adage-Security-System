import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const prisma = {
    employee: { findUnique: jest.fn() },
    movementRecord: { findMany: jest.fn() },
    emailLog: { create: jest.fn(), update: jest.fn() },
  };

  const settings = {
    get: jest.fn(),
    getSecurityEmail: jest.fn(),
  };

  const auditLog = { record: jest.fn() };
  const generator = { generatePng: jest.fn(), generatePdf: jest.fn() };
  const storage = { uploadReport: jest.fn(), getSignedDownloadUrl: jest.fn() };
  const email = { sendMovementRecordEmail: jest.fn() };

  let service: ReportsService;

  beforeEach(() => {
    jest.clearAllMocks();

    settings.get.mockImplementation(async (key: string) => {
      if (key === 'COMPANY_NAME') return 'Adage';
      return null;
    });
    settings.getSecurityEmail.mockResolvedValue('security@example.com');
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
    storage.uploadReport.mockResolvedValue(undefined);
    email.sendMovementRecordEmail.mockResolvedValue(undefined);
    auditLog.record.mockResolvedValue(undefined);

    service = new ReportsService(
      prisma as any,
      settings as any,
      auditLog as any,
      generator as any,
      storage as any,
      email as any,
    );
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
        cc: 'security@example.com',
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

  it('marks the email log as FAILED when sending throws', async () => {
    generator.generatePng.mockRejectedValue(new Error('png generation failed'));
    prisma.emailLog.update.mockResolvedValue({ id: 77, status: 'FAILED', errorMessage: 'png generation failed' });

    await expect(service.emailDailyRecord(1, '2026-09-10', 9)).rejects.toThrow('png generation failed');

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
