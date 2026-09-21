import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok when the database responds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const controller = new HealthController(prisma as any);

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(typeof result.time).toBe('string');
  });

  it('throws 503 when the database is unreachable', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('connection refused')) };
    const controller = new HealthController(prisma as any);

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
  });
});
