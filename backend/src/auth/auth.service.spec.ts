import * as argon2 from 'argon2';
import { AuthService } from './auth.service';

jest.mock('argon2', () => ({
  verify: jest.fn(),
}));

describe('AuthService.validateUser', () => {
  const prisma = { user: { findUnique: jest.fn(), findFirst: jest.fn() } };
  const auditLog = {};
  const emailService = {};
  const settings = {};
  const service = new AuthService(prisma as any, auditLog as any, emailService as any, settings as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('authenticates an active user by username', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 1,
      name: 'Admin User',
      email: 'admin@example.com',
      username: 'admin',
      passwordHash: 'hash',
      isActive: true,
      role: {
        name: 'ADMIN',
        rolePermissions: [{ permission: { name: 'MANAGE_USERS' } }],
      },
    });
    (argon2.verify as jest.Mock).mockResolvedValue(true);

    await expect(service.validateUser('admin', 'password')).resolves.toEqual({
      id: 1,
      name: 'Admin User',
      email: 'admin@example.com',
      username: 'admin',
      role: 'ADMIN',
      permissions: ['MANAGE_USERS'],
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ username: 'admin' }, { email: { equals: 'admin', mode: 'insensitive' } }] },
      }),
    );
  });

  it('authenticates an active user by email, case-insensitively', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 1,
      name: 'Admin User',
      email: 'admin@example.com',
      username: 'admin',
      passwordHash: 'hash',
      isActive: true,
      role: { name: 'ADMIN', rolePermissions: [] },
    });
    (argon2.verify as jest.Mock).mockResolvedValue(true);

    await expect(service.validateUser('Admin@Example.com', 'password')).resolves.toEqual(
      expect.objectContaining({ id: 1, username: 'admin' }),
    );
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ username: 'Admin@Example.com' }, { email: { equals: 'Admin@Example.com', mode: 'insensitive' } }] },
      }),
    );
  });

  it('rejects a blank identifier without querying the database', async () => {
    await expect(service.validateUser('   ', 'password')).resolves.toBeNull();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('rejects inactive users and invalid passwords', async () => {
    prisma.user.findFirst.mockResolvedValue({ isActive: false });
    await expect(service.validateUser('disabled', 'password')).resolves.toBeNull();

    prisma.user.findFirst.mockResolvedValue({ isActive: true, passwordHash: 'hash' });
    (argon2.verify as jest.Mock).mockResolvedValue(false);
    await expect(service.validateUser('user', 'wrong')).resolves.toBeNull();
  });
});
