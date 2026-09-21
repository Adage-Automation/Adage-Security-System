import { useAuth } from '../auth/useAuth';
import { IconLogOut } from './icons';

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="app-header">
      <div className="brand-group">
        <span className="logo-badge">
          <img src="/logo.png" alt="Adage" className="logo-img" />
        </span>
        <span className="brand">
          <small>Security System</small>
        </span>
      </div>
      {user && (
        <div className="user-info">
          <div className="who">
            <div>{user.name}</div>
            <span className="role-pill">{user.role}</span>
          </div>
          <button onClick={() => logout()}>
            <IconLogOut style={{ width: 15, height: 15, marginRight: 5, verticalAlign: -3 }} />
            Logout
          </button>
        </div>
      )}
    </header>
  );
}
