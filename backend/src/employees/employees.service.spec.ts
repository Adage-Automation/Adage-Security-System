import { EmployeesService } from './employees.service';

describe('EmployeesService search', () => {
  const prisma = { employee: { findMany: jest.fn() } };
  const auditLog = {};
  const service = new EmployeesService(prisma as any, auditLog as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns no results for a blank query', async () => {
    await expect(service.search('  ')).resolves.toEqual([]);
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
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
