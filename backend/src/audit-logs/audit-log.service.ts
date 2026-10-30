import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { dayRange, formatDateTimeInAppTimezone } from '../common/utils/day-range';
import { styleHeaderRow, workbookToBuffer } from '../common/utils/excel';

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
  // Shared by list() and exportToExcel() below — was duplicated inline in
  // list() only, before export needed the exact same filter set.
  private buildWhere(params: { entityType?: string; entityId?: number; userId?: number; from?: string; to?: string; q?: string }) {
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
    return where;
  }

  async list(params: { entityType?: string; entityId?: number; userId?: number; from?: string; to?: string; q?: string; take?: number; skip?: number }) {
    return this.prisma.auditLog.findMany({
      where: this.buildWhere(params),
      orderBy: { createdAt: 'desc' },
      // Capped regardless of what the caller asks for — an ADMIN session
      // could otherwise pass an arbitrarily large `take` and force one huge
      // query/response. Found in the 2026-09-25 audit.
      take: Math.min(params.take ?? 50, 200),
      skip: params.skip ?? 0,
      include: { user: { select: { id: true, name: true } } },
    });
  }

  // An admin investigating an incident had no way to pull matching rows
  // out of the app at all — every other table (Employees, Insights) has an
  // Export to Excel, this was the one left without it. Found in the
  // 2026-10-27 admin role-flow audit. Same filters as list() (whatever's
  // currently on screen), uncapped by the UI's own 50-row page size but
  // still bounded — an unbounded export is its own resource-exhaustion
  // risk on a long-lived production log.
  async exportToExcel(params: { entityType?: string; entityId?: number; userId?: number; from?: string; to?: string; q?: string }): Promise<Buffer> {
    const EXPORT_CAP = 5000;
    // Fetches one extra row so `rows.length === EXPORT_CAP + 1` can tell
    // "truncated" apart from "exactly EXPORT_CAP rows exist" — `take:
    // EXPORT_CAP` alone can't distinguish them, which previously showed the
    // capped-export warning on a result that wasn't actually cut off. The
    // extra row itself is sliced off before writing. Found in the
    // 2026-10-29 review.
    const fetched = await this.prisma.auditLog.findMany({
      where: this.buildWhere(params),
      orderBy: { createdAt: 'desc' },
      take: EXPORT_CAP + 1,
      include: { user: { select: { id: true, name: true } } },
    });
    const truncated = fetched.length > EXPORT_CAP;
    const rows = fetched.slice(0, EXPORT_CAP);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Audit Log');
    sheet.columns = [
      { header: 'Time', key: 'time', width: 22 },
      { header: 'Action', key: 'action', width: 24 },
      { header: 'Entity', key: 'entity', width: 20 },
      { header: 'Performed By', key: 'performedBy', width: 24 },
      { header: 'IP Address', key: 'ipAddress', width: 18 },
    ];
    styleHeaderRow(sheet);

    for (const row of rows) {
      sheet.addRow({
        // Was row.createdAt.toISOString() — raw UTC, while the same row
        // on screen renders via toLocaleString('en-IN') (browser-local,
        // effectively IST). A 2am IST row exported 5h30m off and on the
        // previous calendar date. Found in the 2026-10-28 audit.
        time: formatDateTimeInAppTimezone(row.createdAt),
        action: row.action,
        entity: row.entityType ? `${row.entityType}${row.entityId ? ` #${row.entityId}` : ''}` : '',
        performedBy: row.user?.name ?? '',
        ipAddress: row.ipAddress ?? '',
      });
    }

    // The cap above is deliberate (an unbounded export is its own
    // resource-exhaustion risk), but nothing told the admin it was hit —
    // an unfiltered export past this many rows silently handed back only
    // the newest ones in a file that looks complete. Found in the
    // 2026-10-28 audit.
    if (truncated) {
      sheet.addRow({ time: '', action: '', entity: '', performedBy: '', ipAddress: '' });
      const warningRow = sheet.addRow({
        time: `Export capped at ${EXPORT_CAP} rows — narrow the filters (date range, entity, user) to see older entries.`,
      });
      // Merged + filled across every column (not just italic text in col 1)
      // so this reads as a system notice to whoever opens the file — an
      // admin, a client, an auditor — rather than a stray data row.
      // Found in the 2026-10-28 audit.
      sheet.mergeCells(warningRow.number, 1, warningRow.number, sheet.columns.length);
      warningRow.font = { italic: true, color: { argb: 'FFB45309' } };
      warningRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
    }

    return workbookToBuffer(workbook);
  }
}
