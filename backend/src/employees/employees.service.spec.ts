import { ConflictException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { EmployeesService } from './employees.service';

async function buildWorkbook(headers: string[], rows: (string | undefined)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Employees');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

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

// A caller could otherwise pass an arbitrarily large `take` and force one
// huge query/response — same class of gap already fixed for GET
// /audit-logs (2026-09-25), missed here. Found in the 2026-09-28 security
// audit.
describe('EmployeesService findAll — take cap', () => {
  const prisma = { employee: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) } };
  const service = new EmployeesService(prisma as any, {} as any);

  beforeEach(() => jest.clearAllMocks());

  it('caps take at 200 regardless of what the caller requests', async () => {
    await service.findAll({ take: 999_999 });
    expect(prisma.employee.findMany.mock.calls[0][0].take).toBe(200);
  });

  it('defaults take to 50 when not specified', async () => {
    await service.findAll({});
    expect(prisma.employee.findMany.mock.calls[0][0].take).toBe(50);
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

  // Untrimmed whitespace would defeat the case-insensitive checks above —
  // "EMP001" and "EMP001 " aren't equal strings even though they look
  // identical to HR typing/pasting the code. Found in the 2026-10-05
  // HR-workflow audit.
  it('trims employeeCode/employeeName/email/carNumber before checking uniqueness and creating', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    prisma.employee.create.mockResolvedValue({ id: 3, employeeCode: 'EMP004' });

    await service.create(
      { employeeCode: '  EMP004 ', employeeName: ' New Person ', email: ' new@example.com ', carNumber: ' MH12 AB1234 ' } as any,
      1,
    );

    expect(prisma.employee.findFirst.mock.calls[0][0].where.employeeCode.equals).toBe('EMP004');
    expect(prisma.employee.create).toHaveBeenCalledWith({
      data: { employeeCode: 'EMP004', employeeName: 'New Person', email: 'new@example.com', carNumber: 'MH12 AB1234' },
    });
  });
});

// Bulk import — row-by-row so one bad row doesn't block the rest. Found in
// the 2026-10-05 bulk-add request.
describe('EmployeesService importFromExcel', () => {
  const prisma = {
    employee: { findFirst: jest.fn(), create: jest.fn() },
  };
  const auditLog = { record: jest.fn() };
  const service = new EmployeesService(prisma as any, auditLog as any);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.employee.findFirst.mockResolvedValue(null); // no clash by default
    prisma.employee.create.mockImplementation(({ data }: any) => Promise.resolve({ id: Math.random(), ...data }));
  });

  it('creates every valid row and reports the summary', async () => {
    const buffer = await buildWorkbook(
      ['Employee Code', 'Name', 'Email', 'Car Number'],
      [
        ['EMP101', 'Asha Rao', 'asha@example.com', 'MH12AB1111'],
        ['EMP102', 'Vikram Shah', '', ''],
      ],
    );

    const result = await service.importFromExcel(buffer, 1);

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(prisma.employee.create).toHaveBeenCalledTimes(2);
  });

  it('skips rows missing a required field and still creates the rest', async () => {
    const buffer = await buildWorkbook(
      ['Employee Code', 'Name', 'Email', 'Car Number'],
      [
        ['EMP201', '', '', ''], // missing name
        ['EMP202', 'Good Row', '', ''],
      ],
    );

    const result = await service.importFromExcel(buffer, 1);

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.results[0]).toMatchObject({ row: 2, status: 'skipped', reason: expect.stringContaining('required') });
    expect(result.results[1]).toMatchObject({ row: 3, status: 'created' });
  });

  it('skips a row with an invalid email without blocking other rows', async () => {
    const buffer = await buildWorkbook(
      ['Employee Code', 'Name', 'Email', 'Car Number'],
      [['EMP301', 'Bad Email', 'not-an-email', '']],
    );

    const result = await service.importFromExcel(buffer, 1);

    expect(result.created).toBe(0);
    expect(result.results[0]).toMatchObject({ status: 'skipped', reason: 'Invalid email format' });
  });

  it('skips a row whose code already exists, reporting the conflict reason', async () => {
    prisma.employee.findFirst.mockResolvedValueOnce({ id: 1, employeeCode: 'EMP001' });
    const buffer = await buildWorkbook(['Employee Code', 'Name', 'Email', 'Car Number'], [['EMP001', 'Dup Code', '', '']]);

    const result = await service.importFromExcel(buffer, 1);

    expect(result.created).toBe(0);
    expect(result.results[0]).toMatchObject({ status: 'skipped', reason: 'Employee code already exists' });
  });

  it('silently ignores fully blank rows instead of reporting them as skipped', async () => {
    const buffer = await buildWorkbook(
      ['Employee Code', 'Name', 'Email', 'Car Number'],
      [
        ['', '', '', ''],
        ['EMP401', 'Only Real Row', '', ''],
      ],
    );

    const result = await service.importFromExcel(buffer, 1);

    expect(result.results).toHaveLength(1);
    expect(result.created).toBe(1);
  });

  it('rejects a file missing the required headers', async () => {
    const buffer = await buildWorkbook(['Code', 'Full Name'], [['EMP501', 'Someone']]);

    await expect(service.importFromExcel(buffer, 1)).rejects.toThrow('Employee Code" and "Name" columns');
  });
});
