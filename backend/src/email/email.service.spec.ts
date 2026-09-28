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

describe('EmailService dynamic "from" (2026-09-28 multi-unit sender change)', () => {
  const attachment = { filename: 'record.png', content: Buffer.from('png') };
  const baseInput = {
    to: 'employee@example.com',
    employeeName: 'Test Employee',
    dateLabel: '10 September 2026',
    senderName: 'Adage Security System',
    attachment,
  };

  beforeEach(() => {
    process.env.AZURE_TENANT_ID = 'tenant';
    process.env.AZURE_CLIENT_ID = 'client';
    process.env.AZURE_CLIENT_SECRET = 'secret';
    process.env.MAIL_FROM_ADDRESS = 'security@adage-automation.com';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.AZURE_TENANT_ID;
    delete process.env.AZURE_CLIENT_ID;
    delete process.env.AZURE_CLIENT_SECRET;
    delete process.env.MAIL_FROM_ADDRESS;
  });

  function mockFetch(sendMailHandler: (url: string) => { ok: boolean; status?: number }) {
    return jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('login.microsoftonline.com')) {
        return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
      }
      const result = sendMailHandler(url);
      return { ok: result.ok, status: result.status ?? (result.ok ? 202 : 500), text: async () => 'error' };
    });
  }

  it('sends from the dynamic unit address when provided and Graph accepts it', async () => {
    const fetchMock = mockFetch((url) => ({ ok: url.includes(encodeURIComponent('securityunit1@adage-automation.com')) }));
    global.fetch = fetchMock as any;

    await new EmailService().sendMovementRecordEmail({ ...baseInput, from: 'securityunit1@adage-automation.com' });

    const sendMailCalls = fetchMock.mock.calls.filter(([url]: [string]) => url.includes('/sendMail'));
    expect(sendMailCalls).toHaveLength(1);
    expect(sendMailCalls[0][0]).toContain(encodeURIComponent('securityunit1@adage-automation.com'));
  });

  it('falls back to the fixed MAIL_FROM_ADDRESS if the dynamic unit address is rejected', async () => {
    // Simulates the real-world case this exists for: a unit's mailbox not
    // yet added to the Exchange application access policy's scope group.
    const fetchMock = mockFetch((url) => ({ ok: url.includes(encodeURIComponent('security@adage-automation.com')) }));
    global.fetch = fetchMock as any;

    await new EmailService().sendMovementRecordEmail({ ...baseInput, from: 'securityunit2@adage-automation.com' });

    const sendMailCalls = fetchMock.mock.calls.filter(([url]: [string]) => url.includes('/sendMail'));
    expect(sendMailCalls).toHaveLength(2);
    expect(sendMailCalls[0][0]).toContain(encodeURIComponent('securityunit2@adage-automation.com'));
    expect(sendMailCalls[1][0]).toContain(encodeURIComponent('security@adage-automation.com'));
  });

  it('throws if both the dynamic address and the fallback fail', async () => {
    const fetchMock = mockFetch(() => ({ ok: false, status: 403 }));
    global.fetch = fetchMock as any;

    await expect(
      new EmailService().sendMovementRecordEmail({ ...baseInput, from: 'securityunit2@adage-automation.com' }),
    ).rejects.toThrow('Microsoft Graph sendMail failed');

    const sendMailCalls = fetchMock.mock.calls.filter(([url]: [string]) => url.includes('/sendMail'));
    expect(sendMailCalls).toHaveLength(2);
  });

  it('sends directly from the fixed address, with no retry, when no dynamic from is given', async () => {
    const fetchMock = mockFetch((url) => ({ ok: url.includes(encodeURIComponent('security@adage-automation.com')) }));
    global.fetch = fetchMock as any;

    await new EmailService().sendMovementRecordEmail({ ...baseInput });

    const sendMailCalls = fetchMock.mock.calls.filter(([url]: [string]) => url.includes('/sendMail'));
    expect(sendMailCalls).toHaveLength(1);
    expect(sendMailCalls[0][0]).toContain(encodeURIComponent('security@adage-automation.com'));
  });
});
