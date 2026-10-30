import { SortState } from '../utils/sort';

// Sortable column header — click toggles asc/desc on the same column, or
// switches to a new one. Ported from Insights.tsx's local `Th`; see
// utils/sort.ts for why that one wasn't refactored to share this instead.
export function Th({ label, sortKey, sort, onSort }: { label: string; sortKey: string; sort: SortState; onSort?: (key: string) => void }) {
  const active = sort?.key === sortKey;
  if (!onSort) return <th>{label}</th>;
  // tabIndex/role/onKeyDown added 2026-10-29 — an onClick-only <th> is
  // mouse-only, the same gap Escape-to-close just closed on every dropdown.
  // role="button" + Enter/Space mirrors how a real <button> behaves, so a
  // keyboard user can reach and trigger sorting like everyone else.
  return (
    <th
      onClick={() => onSort(sortKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSort(sortKey);
        }
      }}
      tabIndex={0}
      role="button"
      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {label}
      {active ? (sort!.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
}
