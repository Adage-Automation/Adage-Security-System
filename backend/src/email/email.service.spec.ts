import { EmailService } from './email.service';

describe('EmailService Graph failures', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.AZURE_TENANT_ID;
    delete process.env.AZURE_CLIENT_ID;
    delete process.env.AZURE_CLIENT_SECRET;
    delete process.env.MAIL_FROM_ADDRESS;
  });

  it('fails clearly when Graph configuration is missing', async () => {
    await expect(
      new EmailService().sendPasswordResetEmail({
        to: 'user@example.com',
        name: 'Test User',
        resetLink: 'http://localhost/reset',
        senderName: 'Adage Security System',
      }),
    ).rejects.toThrow('Microsoft Graph email is not configured');
  });

  it('surfaces token acquisition failures', async () => {
    process.env.AZURE_TENANT_ID = 'tenant';
    process.env.AZURE_CLIENT_ID = 'client';
    process.env.AZURE_CLIENT_SECRET = 'secret';
    process.env.MAIL_FROM_ADDRESS = 'security@example.com';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid client' }) as any;

    await expect(
      new EmailService().sendPasswordResetEmail({
        to: 'user@example.com',
        name: 'Test User',
        resetLink: 'http://localhost/reset',
        senderName: 'Adage Security System',
      }),
    ).rejects.toThrow('Failed to acquire Microsoft Graph access token: 401 invalid client');
  });
});
