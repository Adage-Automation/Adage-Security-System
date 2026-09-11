import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

describe('EmployeesController', () => {
  let controller: EmployeesController;
  let employeesService: {
    search: jest.Mock;
    searchIncludingInactive: jest.Mock;
    findAll: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    setActive: jest.Mock;
  };

  beforeEach(() => {
    employeesService = {
      search: jest.fn(),
      searchIncludingInactive: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      setActive: jest.fn(),
    };

    controller = new EmployeesController(employeesService as unknown as EmployeesService);
  });

  it('searches active employees by query', async () => {
    const rows = [{ id: 1, employeeCode: 'ADG1024' }];
    employeesService.search.mockResolvedValue(rows);

    await expect(controller.search('ADG')).resolves.toEqual(rows);
    expect(employeesService.search).toHaveBeenCalledWith('ADG');
  });

  it('searches inactive employees for admin corrections', async () => {
    const rows = [{ id: 2, employeeCode: 'INACTIVE-1' }];
    employeesService.searchIncludingInactive.mockResolvedValue(rows);

    await expect(controller.searchAll('inactive')).resolves.toEqual(rows);
    expect(employeesService.searchIncludingInactive).toHaveBeenCalledWith('inactive');
  });

  it('finds all employees with parsed pagination inputs', async () => {
    const rows = { rows: [], total: 0 };
    employeesService.findAll.mockResolvedValue(rows);

    await expect(controller.findAll('1', '25', 'abc')).resolves.toEqual(rows);
    expect(employeesService.findAll).toHaveBeenCalledWith({
      skip: 1,
      take: 25,
      q: 'abc',
    });
  });

  it('finds one employee by id', async () => {
    const employee = { id: 7, employeeCode: 'ADG1024' };
    employeesService.findById.mockResolvedValue(employee);

    await expect(controller.findOne(7)).resolves.toEqual(employee);
    expect(employeesService.findById).toHaveBeenCalledWith(7);
  });

  it('creates an employee with the current user id', async () => {
    const dto = { employeeCode: 'ADG1024', employeeName: 'Test Employee' };
    const created = { id: 5, ...dto };
    employeesService.create.mockResolvedValue(created);

    await expect(controller.create(dto as any, { id: 9 })).resolves.toEqual(created);
    expect(employeesService.create).toHaveBeenCalledWith(dto, 9);
  });

  it('updates an employee with the current user id', async () => {
    const dto = { carNumber: 'ABC-123' };
    const updated = { id: 5, carNumber: 'ABC-123' };
    employeesService.update.mockResolvedValue(updated);

    await expect(controller.update(5, dto as any, { id: 9 })).resolves.toEqual(updated);
    expect(employeesService.update).toHaveBeenCalledWith(5, dto, 9);
  });

  it('deactivates an employee', async () => {
    employeesService.setActive.mockResolvedValue({ id: 5, isActive: false });

    await expect(controller.deactivate(5, { id: 9 })).resolves.toEqual({ id: 5, isActive: false });
    expect(employeesService.setActive).toHaveBeenCalledWith(5, false, 9);
  });

  it('reactivates an employee', async () => {
    employeesService.setActive.mockResolvedValue({ id: 5, isActive: true });

    await expect(controller.reactivate(5, { id: 9 })).resolves.toEqual({ id: 5, isActive: true });
    expect(employeesService.setActive).toHaveBeenCalledWith(5, true, 9);
  });
});
