import * as argon2 from 'argon2';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

jest.mock('argon2', () => ({
  verify: jest.fn(),
  hash: jest.fn(),
}));

describe('AuthService password reset', () => {
  const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
  const emailService = { sendPasswordResetEmail: jest.fn() };
  const settings = { get: jest.fn().mockResolvedValue('Adage Security System') };
  const service = new AuthService(prisma as any, auditLog as any, emailService as any, settings as any);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FRONTEND_URL = 'http://localhost:5173';
    (argon2.hash as jest.Mock).mockResolvedValue('new-hash');
  });

  it('returns safely for an unknown account without sending email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.requestPasswordReset('unknown@example.com')).resolves.toBeUndefined();
    expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('creates a reset hash and sends a reset link for an active account', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 4, email: 'user@example.com', name: 'Test User', isActive: true });
    await service.requestPasswordReset('user@example.com');

    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 4 },
      data: expect.objectContaining({ resetTokenHash: expect.any(String), resetTokenExpiresAt: expect.any(Date) }),
    }));
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      resetLink: expect.stringContaining('http://localhost:5173/reset-password?token='),
    }));
  });

  it('rejects expired or missing reset tokens', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.completePasswordReset('bad-token', 'new-password')).rejects.toBeInstanceOf(BadRequestException);

    prisma.user.findUnique.mockResolvedValue({
      id: 4,
      isActive: true,
      resetTokenExpiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.completePasswordReset('expired-token', 'new-password')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hashes the new password and clears the token after a valid reset', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 4,
      isActive: true,
      resetTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    await service.completePasswordReset('valid-token', 'new-password');

    expect(argon2.hash).toHaveBeenCalledWith('new-password');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { passwordHash: 'new-hash', resetTokenHash: null, resetTokenExpiresAt: null },
    });
  });
});
