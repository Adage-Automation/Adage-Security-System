import { calcWorkingHours } from './EmployeeDetails';

describe('calcWorkingHours', () => {
  it('returns null when the day has no exit yet', () => {
    const result = calcWorkingHours([
      { movementType: 'ENTRY', movementAt: '2026-09-10T09:00:00.000Z' },
    ] as any);

    expect(result).toBeNull();
  });

  it('returns a concise string for a span with only minutes', () => {
    const result = calcWorkingHours([
      { movementType: 'ENTRY', movementAt: '2026-09-10T09:00:00.000Z' },
      { movementType: 'EXIT', movementAt: '2026-09-10T09:45:00.000Z' },
    ] as any);

    expect(result).toBe('45m');
  });

  it('returns a full hours-and-minutes string', () => {
    const result = calcWorkingHours([
      { movementType: 'ENTRY', movementAt: '2026-09-10T08:15:00.000Z' },
      { movementType: 'ENTRY', movementAt: '2026-09-10T08:45:00.000Z' },
      { movementType: 'EXIT', movementAt: '2026-09-10T16:00:00.000Z' },
    ] as any);

    expect(result).toBe('7h 45m');
  });
});
