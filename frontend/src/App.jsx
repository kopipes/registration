import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
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

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading-screen">Memuat...</div>

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={user.role === 'crew' ? '/checkin' : '/'} replace /> : <LoginPage />} />
      <Route path="/" element={
        <ProtectedRoute>
          <Layout />
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
      <Route path="*" element={<Navigate to={user?.role === 'crew' ? '/checkin' : '/'} replace />} />
    </Routes>
  )
}
