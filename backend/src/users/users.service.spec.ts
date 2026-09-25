import { UsersService } from './users.service';

function makeUserRow(overrides: Partial<{ id: number; email: string; roleId: number; roleName: string; manageUsers: boolean }> = {}) {
  const manageUsers = overrides.manageUsers ?? true;
  return {
    id: overrides.id ?? 1,
    name: 'Some User',
    email: overrides.email ?? 'user@example.com',
    phone: null,
    username: 'someuser',
    isActive: true,
    role: {
      id: overrides.roleId ?? 1,
      name: overrides.roleName ?? 'ADMIN',
      rolePermissions: manageUsers ? [{ permission: { name: 'MANAGE_USERS' } }] : [],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('UsersService', () => {
  const prisma = {
    user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
    role: { findUnique: jest.fn() },
  };
  const auditLog = { record: jest.fn() };
  const service = new UsersService(prisma as any, auditLog as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('update — email uniqueness', () => {
    it('rejects a clean 409 instead of a raw Prisma error when the email is already taken', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUserRow({ id: 2 }));
      prisma.user.findFirst.mockResolvedValue(makeUserRow({ id: 5, email: 'taken@example.com' }));

      await expect(service.update(2, { email: 'taken@example.com' }, 1)).rejects.toThrow(
        'That email address is already in use by another user.',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows keeping your own existing email unchanged', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUserRow({ id: 2, email: 'me@example.com' }));
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(makeUserRow({ id: 2, email: 'me@example.com' }));

      await expect(service.update(2, { email: 'me@example.com' }, 1)).resolves.toBeTruthy();
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: { equals: 'me@example.com', mode: 'insensitive' }, NOT: { id: 2 } },
      });
    });

    // Login (AuthService.validateUser) matches email case-insensitively —
    // without this, "HR@adage.com" and "hr@adage.com" could otherwise both
    // be created/kept, leaving one account effectively unreachable by
    // email login. Found in the 2026-09-25 audit.
    it('rejects an email that differs only by case from an existing account', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUserRow({ id: 2, email: 'me@example.com' }));
      prisma.user.findFirst.mockResolvedValue(makeUserRow({ id: 5, email: 'taken@example.com' }));

      await expect(service.update(2, { email: 'TAKEN@example.com' }, 1)).rejects.toThrow(
        'That email address is already in use by another user.',
      );
    });
  });

  describe('create — email/username uniqueness', () => {
    it('rejects an email that differs only by case from an existing account', async () => {
      prisma.user.findFirst.mockResolvedValue(makeUserRow({ email: 'taken@example.com' }));

      await expect(
        service.create({ name: 'New', email: 'TAKEN@example.com', username: 'newuser', password: 'x', roleId: 1 } as any, 1),
      ).rejects.toThrow('Username or email already in use');
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ username: 'newuser' }, { email: { equals: 'TAKEN@example.com', mode: 'insensitive' } }] },
      });
    });
  });

  describe('setActive — last-admin lockout protection', () => {
    it('blocks disabling the last active user who can manage users', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(makeUserRow({ id: 3 })).mockResolvedValueOnce(makeUserRow({ id: 3 }));
      prisma.user.count.mockResolvedValue(0);

      await expect(service.setActive(3, false, 1)).rejects.toThrow('last active user who can manage users');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows disabling an admin when another active admin remains', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUserRow({ id: 3 }));
      prisma.user.count.mockResolvedValue(1);
      prisma.user.update.mockResolvedValue(makeUserRow({ id: 3 }));

      await expect(service.setActive(3, false, 1)).resolves.toBeTruthy();
    });

    it('allows disabling a non-admin regardless of admin count', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUserRow({ id: 4, manageUsers: false }));
      prisma.user.update.mockResolvedValue(makeUserRow({ id: 4, manageUsers: false }));

      await expect(service.setActive(4, false, 1)).resolves.toBeTruthy();
      expect(prisma.user.count).not.toHaveBeenCalled();
    });
  });

  describe('update — last-admin role-change protection', () => {
    it('blocks reassigning the last admin to a non-admin role', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(makeUserRow({ id: 3, roleId: 1 })) // findById(before)
        .mockResolvedValueOnce(makeUserRow({ id: 3, roleId: 1 })); // userHasManageUsers lookup
      prisma.role.findUnique.mockResolvedValue({ rolePermissions: [] });
      prisma.user.count.mockResolvedValue(0);

      await expect(service.update(3, { roleId: 2 }, 1)).rejects.toThrow('last active user who can manage users');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows reassigning an admin to a non-admin role when another admin remains', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUserRow({ id: 3, roleId: 1 }));
      prisma.role.findUnique.mockResolvedValue({ rolePermissions: [] });
      prisma.user.count.mockResolvedValue(1);
      prisma.user.update.mockResolvedValue(makeUserRow({ id: 3, roleId: 2 }));

      await expect(service.update(3, { roleId: 2 }, 1)).resolves.toBeTruthy();
    });
  });
});
