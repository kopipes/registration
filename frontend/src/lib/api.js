import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

// Attach JWT token + active project id to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`

  const projectId = localStorage.getItem('project_id')
  if (projectId) config.headers['X-Project-Id'] = projectId

  return config
})

// Handle auth/project errors globally
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status
    const url = err.config?.url || ''

    // Never hijack login/auth endpoints
    const isAuthCall = url.includes('/auth/') || url.includes('/projects')

    if (status === 401 && !window.location.pathname.includes('/login')) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      localStorage.removeItem('project_id')
      window.location.href = '/login'
    }

    // Project archived/missing → drop selection and go to project list
    if ((status === 403 || status === 404) && !isAuthCall &&
        String(err.response?.data?.error || '').match(/project/i)) {
      localStorage.removeItem('project_id')
      if (!window.location.pathname.startsWith('/projects')) {
        window.location.href = '/projects'
      }
    }

    return Promise.reject(err)
  }
)

export default api
