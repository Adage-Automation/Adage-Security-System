import { StorageService } from './storage.service';

describe('StorageService', () => {
  it('propagates upload failures from the S3 client', async () => {
    process.env.STORAGE_BUCKET = 'reports';
    process.env.STORAGE_REGION = 'auto';
    process.env.STORAGE_ENDPOINT = 'https://storage.example.com/s3';
    process.env.STORAGE_ACCESS_KEY = 'access';
    process.env.STORAGE_SECRET_KEY = 'secret';

    const service = new StorageService();
    (service as any).client.send = jest.fn().mockRejectedValue(new Error('storage unavailable'));

    await expect(service.uploadReport('report.png', Buffer.from('png'), 'image/png')).rejects.toThrow('storage unavailable');
  });
});
