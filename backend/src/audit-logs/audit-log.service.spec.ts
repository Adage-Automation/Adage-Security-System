import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  it('sanitizes sensitive payload fields before storing audit entries', async () => {
    const prisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    const service = new AuditLogService(prisma as any);

    await service.record({
      action: 'USER_UPDATED',
      entityType: 'User',
      entityId: 42,
      oldValue: {
        id: 42,
        name: 'Alice',
        email: 'alice@example.com',
        passwordHash: 'secret-hash',
        refreshToken: 'token-value',
      },
      newValue: {
        id: 42,
        name: 'Alice Updated',
        email: 'alice@example.com',
        isActive: true,
      },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: null,
        action: 'USER_UPDATED',
        entityType: 'User',
        entityId: 42,
        oldValue: {
          id: 42,
          name: 'Alice',
          email: 'alice@example.com',
        },
        newValue: {
          id: 42,
          name: 'Alice Updated',
          email: 'alice@example.com',
          isActive: true,
        },
        ipAddress: undefined,
        userAgent: undefined,
      },
    });
  });

  it('retains compact summaries for employee records without storing full objects', async () => {
    const prisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    };

    const service = new AuditLogService(prisma as any);

    await service.record({
      action: 'EMPLOYEE_UPDATED',
      entityType: 'Employee',
      entityId: 7,
      oldValue: {
        id: 7,
        employeeName: 'Asha',
        employeeCode: 'EMP-7',
        carNumber: 'MH12AB1234',
        isActive: true,
        passwordHash: 'should-not-store',
      },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        oldValue: {
          id: 7,
          employeeName: 'Asha',
          employeeCode: 'EMP-7',
          carNumber: 'MH12AB1234',
          isActive: true,
        },
      }),
    });
  });
});
