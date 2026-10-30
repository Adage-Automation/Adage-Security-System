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

  // 2026-10-30, by request: a day ending on a dangling open ENTRY with no
  // same-day exit used to show null — even once Insights/Corrections
  // already credit the overnight shift to this day via stitching. This
  // page now shows the same total, by accepting that next-day EXIT as a
  // second parameter (the page itself decides whether one applies).
  it('credits an overnight exit on the next day when this day ends on a still-open entry', () => {
    const result = calcWorkingHours(
      [
        { movementType: 'ENTRY', movementAt: '2026-10-06T04:15:00.000Z' },
        { movementType: 'ENTRY', movementAt: '2026-10-06T06:43:00.000Z' },
      ] as any,
      { movementType: 'EXIT', movementAt: '2026-10-06T20:15:00.000Z' } as any,
    );

    // From the day's LAST entry (06:43 UTC), not the first — mirrors
    // stitchOvernightSessions crediting from the entry still open at the
    // day's end, not an earlier duplicate tap.
    expect(result).toBe('13h 32m');
  });

  it('ignores a provided overnight exit when the day already closed itself out normally', () => {
    const result = calcWorkingHours(
      [
        { movementType: 'ENTRY', movementAt: '2026-10-06T04:00:00.000Z' },
        { movementType: 'EXIT', movementAt: '2026-10-06T12:00:00.000Z' },
      ] as any,
      { movementType: 'EXIT', movementAt: '2026-10-07T01:00:00.000Z' } as any,
    );

    expect(result).toBe('8h');
  });
});
