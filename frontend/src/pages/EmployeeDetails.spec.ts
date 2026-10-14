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

  it('rounds a span a few seconds under a clean hour up to that hour', () => {
    // 10:00:00.000 to 18:59:58.000 is 8h 59m 58s — effectively 9h once
    // ordinary tap-timing noise is accounted for, so it should display "9h".
    const result = calcWorkingHours([
      { movementType: 'ENTRY', movementAt: '2026-09-10T10:00:00.000Z' },
      { movementType: 'EXIT', movementAt: '2026-09-10T18:59:58.000Z' },
    ] as any);

    expect(result).toBe('9h');
  });
});
