// Shared loading placeholder for every data table in the app (Dashboard,
// Employees, Corrections, Audit Log). Previously these pages tracked a
// loading flag only to suppress a false "empty" flash — nothing was ever
// shown *during* the fetch itself, so a slow connection looked identical
// to a frozen page. Renders both the desktop `.records-table` and the
// mobile `.record-cards` shape (same responsive switch every real table
// already uses) so it never looks out of place at any width.
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  const widths = ['70%', '45%', '85%', '55%', '65%'];
  return (
    <div aria-hidden="true">
      <table className="records-table">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: columns }).map((_, c) => (
                <td key={c}>
                  <div className="skeleton skeleton-text" style={{ width: widths[(r + c) % widths.length] }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="record-cards">
        {Array.from({ length: rows }).map((_, r) => (
          <div className="record-card" key={r}>
            <div className="skeleton skeleton-text" style={{ width: '55%' }} />
            <div className="skeleton skeleton-pill" />
          </div>
        ))}
      </div>
    </div>
  );
}
