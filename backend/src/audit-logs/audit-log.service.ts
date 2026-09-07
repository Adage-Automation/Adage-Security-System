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
        oldValue: input.oldValue as any,
        newValue: input.newValue as any,
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
