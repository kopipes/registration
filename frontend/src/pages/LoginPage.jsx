import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: settings } = useQuery({
    queryKey: ['settings-public'],
    queryFn: () => api.get('/settings').then(r => r.data).catch(() => ({})),
    staleTime: 60_000,
  })

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(form.username.trim(), form.password)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Login gagal. Periksa username dan password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-bg-shapes" />
      <div className="login-card-wrap">
        <div className="login-card">
          {settings?.logo_url
            ? (
              <div className="login-logo-wrap">
                <img src={settings.logo_url} alt="Logo" className="login-logo" />
              </div>
            )
            : (
              <div className="login-logo-wrap">
                <div className="login-icon">🎫</div>
              </div>
            )
          }
          <div className="login-title">
            {settings?.event_name || 'Event Check-in'}
          </div>
          <div className="login-sub">Sistem Registrasi Peserta</div>

          {error && <div className="alert alert-danger">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                required
                autoFocus
                placeholder="Masukkan username..."
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                placeholder="Masukkan password..."
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary login-btn"
              disabled={loading}
            >
              {loading ? 'Memuat...' : 'Masuk'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
