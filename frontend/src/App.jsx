import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { useProject } from './context/ProjectContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import ProjectsPage from './pages/ProjectsPage'
import DashboardPage from './pages/DashboardPage'
import CheckinPage from './pages/CheckinPage'
import PesertaPage from './pages/PesertaPage'
import UsersPage from './pages/UsersPage'
import SettingsPage from './pages/SettingsPage'

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen">Memuat...</div>
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  return children
}

// Crew can only access /checkin
function CrewGuard({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen">Memuat...</div>
  if (user?.role === 'crew') return <Navigate to="/checkin" replace />
  return children
}

// Requires an active project; otherwise send to project picker
function ProjectRoute({ children }) {
  const { projectId, isLoading } = useProject()
  if (isLoading) return <div className="loading-screen">Memuat project...</div>
  if (!projectId) return <Navigate to="/projects" replace />
  return children
}

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen">Memuat...</div>

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/projects" replace /> : <LoginPage />} />
      <Route path="/projects" element={
        <ProtectedRoute>
          <ProjectsPage />
        </ProtectedRoute>
      } />
      <Route path="/" element={
        <ProtectedRoute>
          <ProjectRoute>
            <Layout />
          </ProjectRoute>
        </ProtectedRoute>
      }>
        <Route index element={<CrewGuard><DashboardPage /></CrewGuard>} />
        <Route path="checkin" element={<CheckinPage />} />
        <Route path="peserta" element={
          <ProtectedRoute roles={['admin', 'official']}>
            <PesertaPage />
          </ProtectedRoute>
        } />
        <Route path="users" element={
          <ProtectedRoute roles={['admin']}>
            <UsersPage />
          </ProtectedRoute>
        } />
        <Route path="settings" element={
          <ProtectedRoute roles={['admin']}>
            <SettingsPage />
          </ProtectedRoute>
        } />
      </Route>
      <Route path="*" element={<Navigate to={user ? '/projects' : '/login'} replace />} />
    </Routes>
  )
}
