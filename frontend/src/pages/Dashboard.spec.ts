import { getSummaryModalRows } from './Dashboard';

describe('getSummaryModalRows', () => {
  it('deduplicates employees by latest movement and keeps the recorded-by metadata', () => {
    const records = [
      {
        id: 1,
        employeeId: 7,
        movementType: 'ENTRY',
        movementAt: '2026-09-10T08:00:00.000Z',
        employee: { id: 7, employeeName: 'Alpha', employeeCode: 'A1' },
        recordedBy: { id: 2, name: 'Guard One' },
      },
      {
        id: 2,
        employeeId: 7,
        movementType: 'EXIT',
        movementAt: '2026-09-10T17:00:00.000Z',
        employee: { id: 7, employeeName: 'Alpha', employeeCode: 'A1' },
        recordedBy: { id: 3, name: 'Guard Two' },
      },
      {
        id: 3,
        employeeId: 9,
        movementType: 'ENTRY',
        movementAt: '2026-09-10T09:30:00.000Z',
        employee: { id: 9, employeeName: 'Bravo', employeeCode: 'B2' },
        recordedBy: { id: 4, name: 'Guard Three' },
      },
    ] as any;

    const result = getSummaryModalRows('employees', records);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.employeeId)).toEqual([7, 9]);
    expect(result[0].recordedBy?.name).toBe('Guard Two');
    expect(result[1].recordedBy?.name).toBe('Guard Three');
  });

  it('keeps the most recent movement per employee for the currently-inside count', () => {
    const records = [
      {
        id: 1,
        employeeId: 5,
        movementType: 'ENTRY',
        movementAt: '2026-09-10T08:00:00.000Z',
        employee: { id: 5, employeeName: 'Carl', employeeCode: 'C1' },
        recordedBy: { id: 2, name: 'Guard One' },
      },
      {
        id: 2,
        employeeId: 5,
        movementType: 'EXIT',
        movementAt: '2026-09-10T11:00:00.000Z',
        employee: { id: 5, employeeName: 'Carl', employeeCode: 'C1' },
        recordedBy: { id: 3, name: 'Guard Two' },
      },
      {
        id: 3,
        employeeId: 6,
        movementType: 'ENTRY',
        movementAt: '2026-09-10T12:00:00.000Z',
        employee: { id: 6, employeeName: 'Dora', employeeCode: 'D1' },
        recordedBy: { id: 4, name: 'Guard Three' },
      },
    ] as any;

    const result = getSummaryModalRows('inside', records);

    expect(result).toHaveLength(1);
    expect(result[0].employeeId).toBe(6);
    expect(result[0].recordedBy?.name).toBe('Guard Three');
  });
});
