import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

  async list(params: { entityType?: string; entityId?: number; userId?: number; take?: number; skip?: number }) {
    return this.prisma.auditLog.findMany({
      where: {
        entityType: params.entityType,
        entityId: params.entityId,
        userId: params.userId,
      },
      orderBy: { createdAt: 'desc' },
      take: params.take ?? 50,
      skip: params.skip ?? 0,
      include: { user: { select: { id: true, name: true } } },
    });
  }
}
