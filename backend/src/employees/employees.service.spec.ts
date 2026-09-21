import { ConflictException } from '@nestjs/common';
import { EmployeesService } from './employees.service';

describe('EmployeesService search', () => {
  const prisma = { employee: { findMany: jest.fn() } };
  const auditLog = {};
  const service = new EmployeesService(prisma as any, auditLog as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // A blank query used to return [] without even querying the DB — the
  // dropdown then stayed empty until the guard typed something, so
  // clicking/focusing the search box looked unresponsive. Changed in the
  // 2026-09-21 UX pass to return a browse list (first page, alphabetical)
  // instead, so the frontend can show something immediately on focus.
  it('returns the first page of active employees, alphabetically, for a blank query', async () => {
    prisma.employee.findMany.mockResolvedValue([]);

    await service.search('  ');

    expect(prisma.employee.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      take: 10,
      orderBy: { employeeName: 'asc' },
    });
  });

  it('searches active employees by name, code, email, or car number', async () => {
    prisma.employee.findMany.mockResolvedValue([]);

    await service.search('MH12AB1234');

    expect(prisma.employee.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        OR: [
          { employeeName: { contains: 'MH12AB1234', mode: 'insensitive' } },
          { employeeCode: { contains: 'MH12AB1234', mode: 'insensitive' } },
          { email: { contains: 'MH12AB1234', mode: 'insensitive' } },
          { carNumber: { contains: 'MH12AB1234', mode: 'insensitive' } },
        ],
      },
      take: 10,
      orderBy: { employeeName: 'asc' },
    });
  });
});

// Case-insensitive employeeCode/email collision checks — found in the
// 2026-09-21 audit: the DB's uniqueness constraint on employeeCode is
// case-sensitive while every search matches case-insensitively, so
// "EMP001" and "emp001" could otherwise both be created as distinct
// employees. Employee email had no uniqueness constraint at all.
describe('EmployeesService create/update — case-insensitive uniqueness', () => {
  const prisma = {
    employee: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const auditLog = { record: jest.fn() };
  const service = new EmployeesService(prisma as any, auditLog as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects creating an employee whose code only differs in case from an existing one', async () => {
    prisma.employee.findFirst.mockResolvedValueOnce({ id: 1, employeeCode: 'EMP001' });

    await expect(
      service.create({ employeeCode: 'emp001', employeeName: 'New Person' } as any, 1),
    ).rejects.toThrow(ConflictException);
    expect(prisma.employee.create).not.toHaveBeenCalled();
  });

  it('rejects creating an employee whose email only differs in case from an existing one', async () => {
    prisma.employee.findFirst
      .mockResolvedValueOnce(null) // code check passes
      .mockResolvedValueOnce({ id: 2, employeeName: 'Existing Person', employeeCode: 'EMP002' }); // email clash

    await expect(
      service.create({ employeeCode: 'EMP003', employeeName: 'New Person', email: 'Existing@Example.com' } as any, 1),
    ).rejects.toThrow('Existing Person');
    expect(prisma.employee.create).not.toHaveBeenCalled();
  });

  it('allows updating an employee to keep its own email unchanged', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 1, employeeCode: 'EMP001', employeeName: 'Same Person' });
    prisma.employee.findFirst.mockResolvedValue(null); // no clash once excluding self
    prisma.employee.update.mockResolvedValue({ id: 1, employeeCode: 'EMP001', email: 'same@example.com' });

    await expect(service.update(1, { email: 'same@example.com' } as any, 1)).resolves.toBeTruthy();
  });
});
