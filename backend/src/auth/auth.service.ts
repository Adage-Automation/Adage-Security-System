import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-logs/audit-log.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async validateUser(username: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });

    if (!user || !user.isActive) {
      return null;
    }

    const passwordValid = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!passwordValid) {
      return null;
    }

    return this.toAuthenticatedUser(user);
  }

  async findAuthenticatedUserById(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });
    if (!user || !user.isActive) {
      return null;
    }
    return this.toAuthenticatedUser(user);
  }

  async logLogin(userId: number, ip?: string, userAgent?: string) {
    await this.auditLog.record({
      userId,
      action: 'USER_LOGIN',
      ipAddress: ip,
      userAgent,
    });
  }

  async logLogout(userId: number, ip?: string, userAgent?: string) {
    await this.auditLog.record({
      userId,
      action: 'USER_LOGOUT',
      ipAddress: ip,
      userAgent,
    });
  }

  private toAuthenticatedUser(user: any) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role.name,
      permissions: user.role.rolePermissions.map((rp: any) => rp.permission.name),
    };
  }
}
