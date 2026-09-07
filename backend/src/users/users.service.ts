import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: dto.email }] },
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
