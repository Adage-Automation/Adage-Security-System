import { Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Header } from './components/Header';
import { Login } from './pages/Login';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { SecurityHome } from './pages/SecurityHome';
import { Dashboard } from './pages/Dashboard';
import { EmployeeDetails } from './pages/EmployeeDetails';
import { Employees } from './pages/Employees';
import { Users } from './pages/Users';
import { Settings } from './pages/Settings';
import { Corrections } from './pages/Corrections';
import { AuditLog } from './pages/AuditLog';

function Shell() {
  const { user } = useAuth();
  return (
    <>
      {user && <Header />}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/" element={<ProtectedRoute><SecurityHome /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute permission="VIEW_DASHBOARD"><Dashboard /></ProtectedRoute>} />
        <Route path="/employee-details" element={<ProtectedRoute permission="VIEW_EMPLOYEE_HISTORY"><EmployeeDetails /></ProtectedRoute>} />
        <Route path="/employees" element={<ProtectedRoute permission="MANAGE_EMPLOYEES"><Employees /></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute permission="MANAGE_USERS"><Users /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute permission="MANAGE_SETTINGS"><Settings /></ProtectedRoute>} />
        <Route path="/corrections" element={<ProtectedRoute permission="CORRECT_RECORDS"><Corrections /></ProtectedRoute>} />
        <Route path="/audit-log" element={<ProtectedRoute permission="MANAGE_SETTINGS"><AuditLog /></ProtectedRoute>} />
      </Routes>
    </>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
