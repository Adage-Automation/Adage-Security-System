// Shared by every sortable table's onSort handler — ported from the
// click-to-sort pattern already used throughout Insights.tsx (Team
// Breakdown, Daily Roster, every drill-down variant) so a second page
// (Employees) needing the same behavior doesn't reinvent it differently.
// Insights.tsx keeps its own local copy rather than being refactored to
// import this — it's large and already working, not worth the risk for a
// code-reuse-only change. Added 2026-10-16.
export type SortState = { key: string; dir: 'asc' | 'desc' } | null;

export function toggleSort(prev: SortState, key: string): SortState {
  return prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
}

export function sortRows<T extends Record<string, any>>(rows: T[], sort: SortState): T[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    const cmp = typeof av === 'number' || typeof bv === 'number' ? (av ?? -Infinity) - (bv ?? -Infinity) : String(av ?? '').localeCompare(String(bv ?? ''));
    return sort.dir === 'asc' ? cmp : -cmp;
  });
}
