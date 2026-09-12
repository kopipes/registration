import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * App-level shell — pages here are NOT scoped to a project
 * (project picker, user management, audit log).
 */
export default function AppLayout({ children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    localStorage.removeItem('project_id')
    navigate('/login')
  }

  const isAdmin = user?.role === 'admin'

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="app-topbar-logo">🎫</div>
          <div>
            <strong style={{ fontSize: '0.92rem' }}>Event Registration</strong>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {user?.full_name} · {user?.role}
            </div>
          </div>
        </div>

        <nav className="app-topbar-nav">
          <NavLink to="/projects">Projects</NavLink>
          {isAdmin && <NavLink to="/users">Kelola User</NavLink>}
          {isAdmin && <NavLink to="/audit">Audit Log</NavLink>}
          <button className="btn btn-outline btn-sm" onClick={handleLogout}>Keluar</button>
        </nav>
      </header>

      <main className="app-shell-body">{children}</main>
    </div>
  )
}
