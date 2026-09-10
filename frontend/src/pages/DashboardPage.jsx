import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import Pagination from '../components/Pagination'

const ACTIVITY_PAGE_SIZE = 10

export default function DashboardPage() {
  const { user } = useAuth()
  const [activityPage, setActivityPage] = useState(1)

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(r => r.data),
    refetchInterval: 15_000,
  })

  if (isLoading) return <div className="page-body"><p>Memuat data...</p></div>
  if (error) return <div className="page-body"><div className="alert alert-danger">Gagal memuat dashboard</div></div>

  const { total = 0, registered = 0, pending = 0, percentage = 0, by_section = [], recent_activity = [] } = data || {}

  // Client-side pagination for activity
  const activityStart = (activityPage - 1) * ACTIVITY_PAGE_SIZE
  const activitySlice = recent_activity.slice(activityStart, activityStart + ACTIVITY_PAGE_SIZE)

  return (
    <>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Selamat datang, {user?.full_name} — pantau progress check-in secara real-time</p>
      </div>
      <div className="page-body">

        {/* Stats */}
        <div className="stats-grid" style={{ marginBottom: 24 }}>
          <div className="stat-card primary">
            <div className="stat-label">Total Peserta</div>
            <div className="stat-value">{total}</div>
          </div>
          <div className="stat-card success">
            <div className="stat-label">Sudah Check-in</div>
            <div className="stat-value">{registered}</div>
            <div className="stat-sub">{percentage}% dari total</div>
          </div>
          <div className="stat-card warning">
            <div className="stat-label">Belum Check-in</div>
            <div className="stat-value">{pending}</div>
          </div>
        </div>

        {/* Progress */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header"><h2>Progress Check-in</h2></div>
          <div className="card-body">
            <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
              <span>{registered} dari {total} peserta</span>
              <strong>{percentage}%</strong>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${percentage}%` }} />
            </div>
          </div>
        </div>

        <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* By Section */}
          {by_section.length > 0 && (
            <div className="card">
              <div className="card-header"><h2>Per Section</h2></div>
              <div className="card-body">
                <div className="section-bars">
                  {by_section.map(s => {
                    const pct = s.total > 0 ? Math.round((s.registered / s.total) * 100) : 0
                    return (
                      <div key={s.section} className="section-bar-row">
                        <div className="section-bar-label">{s.section}</div>
                        <div className="section-bar-track">
                          <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="section-bar-count">{s.registered}/{s.total}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Recent Activity */}
          <div className="card">
            <div className="card-header">
              <h2>Aktivitas Terbaru</h2>
              {recent_activity.length > 0 && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {recent_activity.length} aktivitas
                </span>
              )}
            </div>
            <div style={{ padding: 0 }}>
              {recent_activity.length === 0
                ? <div className="empty-state"><p>Belum ada aktivitas</p></div>
                : (
                  <>
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Aksi</th>
                            <th>Oleh</th>
                            <th>Waktu</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activitySlice.map(a => (
                            <tr key={a.id}>
                              <td>
                                <span className={`badge ${a.action === 'CHECKIN' ? 'badge-success' : 'badge-danger'}`}>
                                  {a.action === 'CHECKIN' ? 'Check-in' : 'Unregister'}
                                </span>
                                <span style={{ marginLeft: 6, fontSize: '0.8rem' }}>{a.peserta_nama || '—'}</span>
                              </td>
                              <td style={{ fontSize: '0.8rem' }}>{a.username}</td>
                              <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {new Date(a.created_at).toLocaleTimeString('id-ID')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Pagination inside card */}
                    {recent_activity.length > ACTIVITY_PAGE_SIZE && (
                      <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
                        <Pagination
                          total={recent_activity.length}
                          page={activityPage}
                          pageSize={ACTIVITY_PAGE_SIZE}
                          onChange={setActivityPage}
                        />
                      </div>
                    )}
                  </>
                )
              }
            </div>
          </div>
        </div>

      </div>
    </>
  )
}
