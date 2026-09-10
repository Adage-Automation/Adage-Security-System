import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { EmailService } from '../email/email.service';
import { SettingsService } from '../settings/settings.service';

// 1 hour — long enough that a legitimate user has time to receive and
// click the email, short enough to limit the damage if a link ends up
// forwarded, cached, or sitting unread in an inbox.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private emailService: EmailService,
    private settings: SettingsService,
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

  // Deliberately never reveals whether the email matched an account, and
  // never rejects/throws for "not found" — both would let a caller
  // enumerate which addresses have accounts. The controller always
  // returns the same generic response regardless of what happens here.
  async requestPasswordReset(email: string, ip?: string, userAgent?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return;
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetTokenHash: tokenHash, resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
    });

    const senderName = (await this.settings.get('EMAIL_SENDER_NAME')) ?? 'Adage Security System';
    const resetLink = `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/reset-password?token=${rawToken}`;

    try {
      await this.emailService.sendPasswordResetEmail({ to: user.email, name: user.name, resetLink, senderName });
    } catch (err) {
      // Logged, not thrown: the controller must still return its generic
      // "if that email exists..." response either way, so a caller can't
      // distinguish "no such account" from "account exists but the email
      // provider is down" by timing or response shape.
      this.logger.error(`Failed to send password reset email to user ${user.id}`, err as Error);
    }

    await this.auditLog.record({
      userId: user.id,
      action: 'PASSWORD_RESET_REQUESTED',
      ipAddress: ip,
      userAgent,
    });
  }

  async completePasswordReset(rawToken: string, newPassword: string, ip?: string, userAgent?: string): Promise<void> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const user = await this.prisma.user.findUnique({ where: { resetTokenHash: tokenHash } });

    if (!user || !user.isActive || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
      throw new BadRequestException('This reset link is invalid or has expired. Request a new one.');
    }

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      // Single-use: clearing the hash means this exact link can't be
      // replayed even if it leaks (e.g. from a browser history or a
      // forwarded email) after a successful reset.
      data: { passwordHash, resetTokenHash: null, resetTokenExpiresAt: null },
    });

    await this.auditLog.record({
      userId: user.id,
      action: 'USER_PASSWORD_RESET',
      entityType: 'User',
      entityId: user.id,
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
