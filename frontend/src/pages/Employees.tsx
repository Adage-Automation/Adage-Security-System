import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api/client';
import { Employee } from '../types';
import { IconUsers } from '../components/icons';
import { AdminNav } from '../components/AdminNav';

export function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState({ employeeCode: '', employeeName: '', email: '' });
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Employee[]>('/employees').then(setEmployees).catch(() => setEmployees([]));
  }

  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/employees', form);
      setForm({ employeeCode: '', employeeName: '', email: '' });
      load();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create employee.');
    }
  }

  async function toggleActive(emp: Employee) {
    const path = emp.isActive ? 'deactivate' : 'reactivate';
    try {
      await api.patch(`/employees/${emp.id}/${path}`);
      load();
    } catch (err: any) {
      setError(err?.message ?? `Failed to ${path} employee.`);
    }
  }

  return (
    <div className="page-wide">
      <AdminNav />

      <div className="page-heading">
        <IconUsers />
        Employee Management
      </div>

      <div className="section-card">
        <h3>Add Employee</h3>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>Employee Code</label>
            <input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} required />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>Name</label>
            <input value={form.employeeName} onChange={(e) => setForm({ ...form, employeeName: e.target.value })} required />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
            <label>Email</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="submit" className="primary-button" style={{ width: 'auto', padding: '12px 20px' }}>
              Add Employee
            </button>
          </div>
        </form>
        {error && <div className="error-text">{error}</div>}
      </div>

      <table className="records-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Email</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => (
            <tr key={emp.id}>
              <td>{emp.employeeCode}</td>
              <td>{emp.employeeName}</td>
              <td>{emp.email}</td>
              <td>
                <span className={`status-pill ${emp.isActive ? 'active' : 'inactive'}`}>
                  {emp.isActive ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td>
                <button className="table-action-btn" onClick={() => toggleActive(emp)}>
                  {emp.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
