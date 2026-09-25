import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { dayRange } from '../common/utils/day-range';

interface RecordAuditLogInput {
  userId?: number | null;
  action: string;
  entityType?: string;
  entityId?: number;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

const SENSITIVE_AUDIT_KEYS = new Set([
  'password',
  'passwordhash',
  'passwordsalt',
  'token',
  'tokens',
  'refreshtoken',
  'accesstoken',
  'session',
  'sessionid',
  'secret',
  'apikey',
  'clientsecret',
  'rawrequestbody',
  'requestbody',
]);

function isSensitiveAuditKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    SENSITIVE_AUDIT_KEYS.has(normalized) ||
    normalized.endsWith('password') ||
    normalized.endsWith('token') ||
    normalized.endsWith('secret') ||
    normalized.includes('session') ||
    normalized.includes('cookie')
  );
}

function compactEmployeeSummary(value: Record<string, unknown>) {
  return {
    ...(value.id !== undefined ? { id: value.id } : {}),
    ...(value.employeeName !== undefined ? { employeeName: value.employeeName } : {}),
    ...(value.employeeCode !== undefined ? { employeeCode: value.employeeCode } : {}),
    ...(value.carNumber !== undefined ? { carNumber: value.carNumber } : {}),
    ...(value.isActive !== undefined ? { isActive: value.isActive } : {}),
  };
}

function sanitizeAuditValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item));
  }

  if (typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;

  if (record.employeeName !== undefined || record.employeeCode !== undefined || record.carNumber !== undefined) {
    return compactEmployeeSummary(record);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(record)) {
    if (isSensitiveAuditKey(key)) {
      continue;
    }

    const cleaned = sanitizeAuditValue(nestedValue);
    if (cleaned !== undefined) {
      sanitized[key] = cleaned;
    }
  }

  return sanitized;
}

@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  async record(input: RecordAuditLogInput) {
    await this.prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        oldValue: sanitizeAuditValue(input.oldValue) as any,
        newValue: sanitizeAuditValue(input.newValue) as any,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  // `from`/`to` (both optional, `YYYY-MM-DD`) let an admin scope an
  // investigation to a window instead of scrolling through the entire
  // history — found missing in the 2026-09-22 UX audit, the log was the
  // only major table with no date filter at all. `q` is a keyword search
  // across the fields an admin would actually be looking for something
  // by: the action name, the entity type, the performing user's name, and
  // IP address. Always newest-first — no separate "sort" option needed.
  async list(params: { entityType?: string; entityId?: number; userId?: number; from?: string; to?: string; q?: string; take?: number; skip?: number }) {
    const where: any = {
      entityType: params.entityType,
      entityId: params.entityId,
      userId: params.userId,
    };
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = dayRange(params.from).start;
      if (params.to) where.createdAt.lt = dayRange(params.to).end;
    }
    const q = params.q?.trim();
    if (q) {
      where.OR = [
        { action: { contains: q, mode: 'insensitive' as const } },
        { entityType: { contains: q, mode: 'insensitive' as const } },
        { ipAddress: { contains: q, mode: 'insensitive' as const } },
        { user: { name: { contains: q, mode: 'insensitive' as const } } },
      ];
    }
    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      // Capped regardless of what the caller asks for — an ADMIN session
      // could otherwise pass an arbitrarily large `take` and force one huge
      // query/response. Found in the 2026-09-25 audit.
      take: Math.min(params.take ?? 50, 200),
      skip: params.skip ?? 0,
      include: { user: { select: { id: true, name: true } } },
    });
  }
}
