import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-logs/audit-log.service';

// Key/value store so company config (name, timezone, etc.) is never
// hard-coded throughout the app (spec §56).
@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async getAll() {
    const rows = await this.prisma.setting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async get(key: string): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async set(key: string, value: string, actingUserId: number) {
    const before = await this.get(key);
    const row = await this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    await this.auditLog.record({
      userId: actingUserId,
      action: 'SETTING_UPDATED',
      entityType: 'Setting',
      oldValue: { key, value: before },
      newValue: { key, value },
    });
    return row;
  }
}
