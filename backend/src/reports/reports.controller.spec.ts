import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

describe('ReportsController', () => {
  let controller: ReportsController;
  let reportsService: {
    downloadPng: jest.Mock;
    downloadPdf: jest.Mock;
    emailDailyRecord: jest.Mock;
    listEmailLogs: jest.Mock;
    getSignedUrlForEmailLog: jest.Mock;
  };
  let auditLog: { record: jest.Mock };

  beforeEach(() => {
    reportsService = {
      downloadPng: jest.fn(),
      downloadPdf: jest.fn(),
      emailDailyRecord: jest.fn(),
      listEmailLogs: jest.fn(),
      getSignedUrlForEmailLog: jest.fn(),
    };
    auditLog = { record: jest.fn() };

    controller = new ReportsController(
      reportsService as unknown as ReportsService,
      auditLog as any,
    );
  });

  it('downloads PNG and records the audit event', async () => {
    const response = {
      set: jest.fn(),
      send: jest.fn(),
    } as any;
    reportsService.downloadPng.mockResolvedValue({
      buffer: Buffer.from('png'),
      filename: 'report.png',
    });
    auditLog.record.mockResolvedValue(undefined);

    await controller.image(7, '2026-09-10', { id: 9 } as any, response);

    expect(reportsService.downloadPng).toHaveBeenCalledWith(7, '2026-09-10');
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 9,
        action: 'REPORT_DOWNLOADED',
        entityType: 'Employee',
        entityId: 7,
      }),
    );
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'Content-Type': 'image/png' }),
    );
    expect(response.send).toHaveBeenCalledWith(Buffer.from('png'));
  });

  it('downloads PDF and records the audit event', async () => {
    const response = {
      set: jest.fn(),
      send: jest.fn(),
    } as any;
    reportsService.downloadPdf.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      filename: 'report.pdf',
    });
    auditLog.record.mockResolvedValue(undefined);

    await controller.pdf(7, '2026-09-10', { id: 9 } as any, response);

    expect(reportsService.downloadPdf).toHaveBeenCalledWith(7, '2026-09-10');
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REPORT_DOWNLOADED', newValue: { format: 'PDF', date: '2026-09-10' } }),
    );
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'Content-Type': 'application/pdf' }),
    );
  });

  it('delegates email sending to the reports service', async () => {
    reportsService.emailDailyRecord.mockResolvedValue({ status: 'SENT' });

    await expect(controller.email(7, '2026-09-10', { id: 9 } as any)).resolves.toEqual({ status: 'SENT' });
    expect(reportsService.emailDailyRecord).toHaveBeenCalledWith(7, '2026-09-10', 9);
  });

  it('lists email logs with parsed employee id', async () => {
    reportsService.listEmailLogs.mockResolvedValue([]);

    await expect(controller.emailLogs('7')).resolves.toEqual([]);
    expect(reportsService.listEmailLogs).toHaveBeenCalledWith(7);
  });

  it('resolves signed URLs for previous emailed reports', async () => {
    reportsService.getSignedUrlForEmailLog.mockResolvedValue('https://example.test/file.png');

    await expect(controller.downloadEmailedReport(12)).resolves.toEqual({ url: 'https://example.test/file.png' });
    expect(reportsService.getSignedUrlForEmailLog).toHaveBeenCalledWith(12);
  });
});
