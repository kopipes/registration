import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'

const NAV_ITEMS = [
  { to: '/',        end: true,  icon: '▦', label: 'Dashboard', roles: null },
  { to: '/checkin',             icon: '✓', label: 'Check-in',  roles: null },
  { to: '/peserta',             icon: '☰', label: 'Peserta',   roles: ['admin', 'official'] },
  { to: '/users',               icon: '👤', label: 'Users',    roles: ['admin'] },
  { to: '/settings',            icon: '⚙', label: 'Settings',  roles: ['admin'] },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const { activeProject } = useProject()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    localStorage.removeItem('project_id')
    navigate('/login')
  }

  function switchProject() {
    navigate('/projects')
  }

  const visibleItems = NAV_ITEMS.filter(
    item => !item.roles || item.roles.includes(user?.role)
  )

  const projectLabel = activeProject?.event_name || activeProject?.name || 'Project'
  const logoUrl = activeProject?.logo_url

  return (
    <div className="layout">
      {/* Desktop sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          {logoUrl
            ? <img src={logoUrl} alt="Logo" className="sidebar-logo" />
            : <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>🎫</div>
          }
          <div className="sidebar-title">{projectLabel}</div>
          <button
            className="btn-switch-project"
            onClick={switchProject}
            title="Ganti project"
          >
            ⇄ Ganti Project
          </button>
        </div>

        <nav className="sidebar-nav">
          {visibleItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">
              {user?.full_name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div className="user-info-text">
              <strong>{user?.full_name}</strong>
              <span className="user-role">{user?.role}</span>
            </div>
          </div>
          <button className="btn-logout" onClick={handleLogout}>Keluar</button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {visibleItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <span className="bottom-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
          <button className="nav-btn" onClick={switchProject}>
            <span className="bottom-nav-icon">⇄</span>
            <span>Project</span>
          </button>
        </div>
      </nav>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
