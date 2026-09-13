import { createContext, useContext, useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const qc = useQueryClient()
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('user')
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      api.get('/auth/me')
        .then(res => {
          if (res.data.role === 'crew' && res.data.project_id) {
            localStorage.setItem('project_id', String(res.data.project_id))
          }
          setUser(res.data)
          localStorage.setItem('user', JSON.stringify(res.data))
        })
        .catch(() => {
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          setUser(null)
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  async function login(username, password) {
    const res = await api.post('/auth/login', { username, password })
    const { token, user: userData } = res.data
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(userData))
    if (userData.role === 'crew' && userData.project_id) {
      localStorage.setItem('project_id', String(userData.project_id))
    }
    setUser(userData)
    // Drop pre-login cached queries (e.g. failed unauthenticated fetches)
    // so everything refetches fresh with the new session.
    await qc.invalidateQueries()
    return userData
  }

  async function logout() {
    try { await api.post('/auth/logout') } catch { /* ignore */ }
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem('project_id')
    // Clear cached data so the previous user's data never leaks
    // into the next session.
    qc.clear()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
