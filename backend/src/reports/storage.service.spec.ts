import { StorageService } from './storage.service';

describe('StorageService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('propagates upload failures from the S3 client', async () => {
    process.env.STORAGE_BUCKET = 'reports';
    process.env.STORAGE_REGION = 'auto';
    process.env.STORAGE_ENDPOINT = 'https://storage.example.com/s3';
    process.env.STORAGE_ACCESS_KEY = 'access';
    process.env.STORAGE_SECRET_KEY = 'secret';

    const service = new StorageService();
    // Client is created lazily on first use — pre-seed it with a fake so
    // no real S3Client is constructed for this test.
    (service as any).client = { send: jest.fn().mockRejectedValue(new Error('storage unavailable')) };

    await expect(service.uploadReport('report.png', Buffer.from('png'), 'image/png')).rejects.toThrow('storage unavailable');
  });

  // Found in the 2026-09-21 audit: missing STORAGE_* env vars used to build
  // an S3Client with empty-string bucket/credentials that only failed deep
  // inside the AWS SDK at send-time with an opaque error, instead of
  // failing clearly up front like EmailService.requireConfig() does.
  it('fails fast with a clear message when storage is not configured', async () => {
    delete process.env.STORAGE_BUCKET;
    delete process.env.STORAGE_ACCESS_KEY;
    delete process.env.STORAGE_SECRET_KEY;

    const service = new StorageService();

    await expect(service.uploadReport('report.png', Buffer.from('png'), 'image/png')).rejects.toThrow(
      'Report storage is not configured',
    );
    await expect(service.getSignedDownloadUrl('report.png')).rejects.toThrow('Report storage is not configured');
  });
});
