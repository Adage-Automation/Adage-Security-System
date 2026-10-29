import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { useAuth } from './auth/useAuth';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Header } from './components/Header';
import { ErrorBoundary } from './components/ErrorBoundary';
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
import { Insights } from './pages/Insights';

function Shell() {
  const { user } = useAuth();
  const location = useLocation();
  return (
    <>
      {user && <Header />}
      {/* Route switches used to hard-cut — the old page vanished and the new
          one appeared in the same frame, which reads as an abrupt jump
          between tabs (e.g. Users -> Corrections). Keying on pathname
          remounts this wrapper on every navigation, which replays the
          fade/slide-in below instead of nothing at all. Found/added
          2026-10-29, by request. */}
      <div key={location.pathname} className="page-transition">
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
          <Route path="/insights" element={<ProtectedRoute permission="VIEW_REPORTS"><Insights /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
        </Routes>
      </div>
    </>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ErrorBoundary>
  );
}
