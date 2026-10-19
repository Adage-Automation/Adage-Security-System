import { SortState } from '../utils/sort';

// Sortable column header — click toggles asc/desc on the same column, or
// switches to a new one. Ported from Insights.tsx's local `Th`; see
// utils/sort.ts for why that one wasn't refactored to share this instead.
export function Th({ label, sortKey, sort, onSort }: { label: string; sortKey: string; sort: SortState; onSort?: (key: string) => void }) {
  const active = sort?.key === sortKey;
  if (!onSort) return <th>{label}</th>;
  return (
    <th onClick={() => onSort(sortKey)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {label}
      {active ? (sort!.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );
}
