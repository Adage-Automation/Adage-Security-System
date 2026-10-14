import { Link } from 'react-router-dom';

// The one place that builds an /employee-details link — reused everywhere
// an employee name appears as a link (Dashboard's table/cards/summary
// modal, Insights' drill-downs/team breakdown/daily duration), so the URL
// shape only ever needs to change in one place.
export function EmployeeLink({ employeeId, employeeName, date }: { employeeId: number; employeeName: string; date: string }) {
  return (
    <Link className="employee-name-link" to={`/employee-details?employeeId=${employeeId}&date=${date}`}>
      {employeeName}
    </Link>
  );
}
