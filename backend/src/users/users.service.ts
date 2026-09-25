import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

const SELECT_SAFE_FIELDS = {
  id: true,
  name: true,
  email: true,
  phone: true,
  username: true,
  isActive: true,
  role: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async findAll() {
    return this.prisma.user.findMany({ select: SELECT_SAFE_FIELDS, orderBy: { name: 'asc' } });
  }

  async findById(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: SELECT_SAFE_FIELDS });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async create(dto: CreateUserDto, actingUserId: number) {
    // Matched case-insensitively — the DB's unique constraint on email is
    // case-sensitive, but login (AuthService.validateUser) matches email
    // case-insensitively. Without this, "HR@adage.com" and "hr@adage.com"
    // could both be created as distinct accounts, leaving one unreachable
    // by email login. Found in the 2026-09-25 audit.
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: { equals: dto.email, mode: 'insensitive' } }] },
    });
    if (existing) {
      throw new ConflictException('Username or email already in use');
    }

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        username: dto.username,
        passwordHash,
        roleId: dto.roleId,
      },
      select: SELECT_SAFE_FIELDS,
    });

    await this.auditLog.record({
      userId: actingUserId,
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: user.id,
      newValue: user,
    });

    return user;
  }

  async update(id: number, dto: UpdateUserDto, actingUserId: number) {
    const before = await this.findById(id);

    // Prisma's unique constraint on email would otherwise surface as a raw
    // P2002 — a 500 with no useful message — instead of a clean 409. Found
    // in the 2026-09-21 audit.
    if (dto.email) {
      const clash = await this.prisma.user.findFirst({ where: { email: { equals: dto.email, mode: 'insensitive' }, NOT: { id } } });
      if (clash) {
        throw new ConflictException('That email address is already in use by another user.');
      }
    }

    // Changing roleId away from a MANAGE_USERS-holding role can lock every
    // admin out of user management exactly like disabling the last admin
    // (below) — same guard applies. Found in the 2026-09-21 audit.
    if (dto.roleId !== undefined && dto.roleId !== before.role.id) {
      await this.assertRoleChangeKeepsAnAdmin(id, dto.roleId);
    }

    const user = await this.prisma.user.update({ where: { id }, data: dto, select: SELECT_SAFE_FIELDS });
    await this.auditLog.record({
      userId: actingUserId,
      action: 'USER_UPDATED',
      entityType: 'User',
      entityId: user.id,
      oldValue: before,
      newValue: user,
    });
    return user;
  }

  async setActive(id: number, isActive: boolean, actingUserId: number) {
    const before = await this.findById(id);

    // Nothing previously stopped an Admin from disabling every other Admin
    // account one-by-one and then their own — a total, unrecoverable
    // lockout from Users/Settings/Audit Log short of direct DB access. The
    // frontend's self-disable confirm dialog only catches the very last
    // step, not the cumulative outcome. Found in the 2026-09-21 audit.
    if (!isActive) {
      await this.assertNotLastActiveAdmin(id);
    }

    const user = await this.prisma.user.update({ where: { id }, data: { isActive }, select: SELECT_SAFE_FIELDS });
    await this.auditLog.record({
      userId: actingUserId,
      action: isActive ? 'USER_ENABLED' : 'USER_DISABLED',
      entityType: 'User',
      entityId: user.id,
      oldValue: before,
      newValue: user,
    });
    return user;
  }

  // Counts other active users who could still manage users if this one is
  // disabled/reassigned. "Admin" here means "holds MANAGE_USERS", not the
  // ADMIN role name specifically — matches how permissions actually gate
  // the Users/Settings/Audit Log screens, in case a future role is granted
  // that permission too.
  private async countOtherActiveUsersWithManageUsers(excludingUserId: number): Promise<number> {
    return this.prisma.user.count({
      where: {
        id: { not: excludingUserId },
        isActive: true,
        role: { rolePermissions: { some: { permission: { name: 'MANAGE_USERS' } } } },
      },
    });
  }

  private async userHasManageUsers(id: number): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { role: { select: { rolePermissions: { select: { permission: { select: { name: true } } } } } } },
    });
    return user?.role.rolePermissions.some((rp) => rp.permission.name === 'MANAGE_USERS') ?? false;
  }

  private async assertNotLastActiveAdmin(id: number): Promise<void> {
    if (!(await this.userHasManageUsers(id))) return; // disabling a non-admin never affects admin coverage
    const remaining = await this.countOtherActiveUsersWithManageUsers(id);
    if (remaining === 0) {
      throw new BadRequestException(
        'You cannot disable this account — it is the last active user who can manage users. Promote or enable another admin first.',
      );
    }
  }

  private async assertRoleChangeKeepsAnAdmin(id: number, newRoleId: number): Promise<void> {
    if (!(await this.userHasManageUsers(id))) return; // wasn't an admin, so reassigning them changes nothing
    const newRole = await this.prisma.role.findUnique({
      where: { id: newRoleId },
      select: { rolePermissions: { select: { permission: { select: { name: true } } } } },
    });
    const newRoleHasManageUsers = newRole?.rolePermissions.some((rp) => rp.permission.name === 'MANAGE_USERS') ?? false;
    if (newRoleHasManageUsers) return; // still an admin under the new role

    const remaining = await this.countOtherActiveUsersWithManageUsers(id);
    if (remaining === 0) {
      throw new BadRequestException(
        'You cannot change this account\'s role — it is the last active user who can manage users. Promote or enable another admin first.',
      );
    }
  }

  async resetPassword(id: number, newPassword: string, actingUserId: number) {
    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    await this.auditLog.record({
      userId: actingUserId,
      action: 'USER_PASSWORD_RESET',
      entityType: 'User',
      entityId: id,
    });
    return { success: true };
  }
}
