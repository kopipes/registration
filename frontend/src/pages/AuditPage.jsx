import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import Pagination from '../components/Pagination'

const PAGE_SIZE = 50

// Human-readable labels + badge colour per action
const ACTION_META = {
  LOGIN:                 { label: 'Login',              tone: 'muted' },
  LOGOUT:                { label: 'Logout',             tone: 'muted' },
  LOGIN_FAILED:          { label: 'Login Gagal',        tone: 'danger' },
  LOGIN_RATE_LIMITED:    { label: 'Login Diblokir',     tone: 'danger' },
  CHANGE_PASSWORD:       { label: 'Ganti Password',     tone: 'warning' },
  CHECKIN:               { label: 'Check-in',           tone: 'success' },
  UNREGISTER:            { label: 'Unregister',         tone: 'danger' },
  ADD_PESERTA:           { label: 'Tambah Peserta',     tone: 'success' },
  EDIT_PESERTA:          { label: 'Edit Peserta',       tone: 'warning' },
  DELETE_PESERTA:        { label: 'Hapus Peserta',      tone: 'danger' },
  BULK_EDIT_PESERTA:     { label: 'Bulk Edit',          tone: 'warning' },
  BULK_DELETE_PESERTA:   { label: 'Bulk Hapus',         tone: 'danger' },
  UPLOAD_EXCEL:          { label: 'Upload Excel',       tone: 'primary' },
  DELETE_BATCH:          { label: 'Hapus Batch',        tone: 'danger' },
  CREATE_USER:           { label: 'Buat User',          tone: 'success' },
  EDIT_USER:             { label: 'Edit User',          tone: 'warning' },
  DEACTIVATE_USER:       { label: 'Nonaktifkan User',   tone: 'danger' },
  DELETE_USER:           { label: 'Hapus User',         tone: 'danger' },
  CREATE_PROJECT:        { label: 'Buat Project',       tone: 'success' },
  EDIT_PROJECT:          { label: 'Edit Project',       tone: 'warning' },
  ARCHIVE_PROJECT:       { label: 'Arsip Project',      tone: 'warning' },
  UNARCHIVE_PROJECT:     { label: 'Aktifkan Project',   tone: 'success' },
  DELETE_PROJECT:        { label: 'Hapus Project',      tone: 'danger' },
  UPDATE_PROJECT_SETTINGS:{ label: 'Setting Project',   tone: 'muted' },
  UPLOAD_LOGO:           { label: 'Upload Logo',        tone: 'primary' },
  UPLOAD_PROJECT_LOGO:   { label: 'Upload Logo',        tone: 'primary' },
}

const TONE_CLASS = {
  success: 'badge-success',
  danger: 'badge-danger',
  warning: 'badge-warning',
  primary: 'badge-primary',
  muted: 'badge-muted',
}

function prettyDetail(detail) {
  if (!detail) return '—'
  try {
    const d = JSON.parse(detail)
    const parts = []
    if (d.peserta_nama) parts.push(d.peserta_nama)
    if (d.nama && !d.peserta_nama) parts.push(d.nama)
    if (d.filename) parts.push(d.filename)
    if (d.count !== undefined) parts.push(`${d.count} data`)
    if (d.inserted !== undefined) parts.push(`${d.inserted} masuk, ${d.skipped ?? 0} dilewati`)
    if (d.removed !== undefined) parts.push(`${d.removed} dihapus`)
    if (d.reason) parts.push(`alasan: ${d.reason}`)
    if (d.username) parts.push(`user: ${d.username}`)
    if (d.name && !d.peserta_nama) parts.push(d.name)
    return parts.length ? parts.join(' · ') : '—'
  } catch {
    return detail
  }
}

export default function AuditPage() {
  const [q, setQ] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [action, setAction] = useState('')
  const [username, setUsername] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)

  const { data: filters } = useQuery({
    queryKey: ['audit-filters'],
    queryFn: () => api.get('/audit/filters').then(r => r.data),
    staleTime: 60_000,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['audit', searchTerm, action, username, from, to, page],
    queryFn: () => api.get('/audit', {
      params: {
        q: searchTerm || undefined,
        action: action || undefined,
        username: username || undefined,
        from: from || undefined,
        to: to ? `${to} 23:59:59` : undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
    }).then(r => r.data),
    keepPreviousData: true,
  })

  const logs = data?.data || []
  const hasFilter = !!(action || username || from || to)

  function resetFilters() {
    setAction(''); setUsername(''); setFrom(''); setTo(''); setPage(1)
  }

  return (
    <>
      <div className="page-header">
        <h1>Audit Log</h1>
        <p>Riwayat semua aktivitas sistem</p>
      </div>

      <div className="page-body">
        <div className="filter-row" style={{ marginBottom: 12 }}>
          <div className="search-wrapper" style={{ flex: 1 }}>
            <span className="search-icon">⌕</span>
            <input
              type="search"
              placeholder="Cari nama, file, keterangan..."
              value={q}
              onChange={e => {
                setQ(e.target.value)
                clearTimeout(window.__auditT)
                window.__auditT = setTimeout(() => { setSearchTerm(e.target.value); setPage(1) }, 300)
              }}
            />
          </div>
          <button
            className={`btn ${showFilters ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setShowFilters(s => !s)}
            style={{ position: 'relative' }}
          >
            ⚙ Filter
            {hasFilter && (
              <span style={{
                position: 'absolute', top: -4, right: -4, width: 8, height: 8,
                borderRadius: '50%', background: 'var(--danger)', border: '1.5px solid var(--surface)',
              }} />
            )}
          </button>
        </div>

        {showFilters && (
          <div style={{
            display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16,
            padding: '14px 16px', background: 'var(--bg)',
            borderRadius: 'var(--radius)', border: '1px solid var(--border)',
            animation: 'slideDown 0.15s ease',
          }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ display: 'block', marginBottom: 4 }}>Aksi</label>
              <select value={action} onChange={e => { setAction(e.target.value); setPage(1) }}>
                <option value="">Semua Aksi</option>
                {(filters?.actions || []).map(a => (
                  <option key={a} value={a}>{ACTION_META[a]?.label || a}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ display: 'block', marginBottom: 4 }}>User</label>
              <select value={username} onChange={e => { setUsername(e.target.value); setPage(1) }}>
                <option value="">Semua User</option>
                {(filters?.usernames || []).map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={{ display: 'block', marginBottom: 4 }}>Dari Tanggal</label>
              <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1) }} />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={{ display: 'block', marginBottom: 4 }}>Sampai Tanggal</label>
              <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1) }} />
            </div>
            {hasFilter && (
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button className="btn btn-outline btn-sm" onClick={resetFilters}>Reset</button>
              </div>
            )}
          </div>
        )}

        <div style={{ marginBottom: 12, fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>
          {isLoading ? 'Memuat...' : `${data?.total ?? 0} aktivitas`}
        </div>

        <div className="card">
          <div className="table-wrapper">
            {isLoading
              ? <div className="empty-state"><p>Memuat...</p></div>
              : logs.length === 0
                ? <div className="empty-state"><p>Tidak ada aktivitas ditemukan</p></div>
                : (
                  <table>
                    <thead>
                      <tr>
                        <th>Waktu</th>
                        <th>Aksi</th>
                        <th>User</th>
                        <th>Keterangan</th>
                        <th className="hide-mobile">IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map(l => {
                        const meta = ACTION_META[l.action] || { label: l.action, tone: 'muted' }
                        return (
                          <tr key={l.id}>
                            <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {l.created_at}
                            </td>
                            <td>
                              <span className={`badge ${TONE_CLASS[meta.tone]}`}>{meta.label}</span>
                            </td>
                            <td style={{ fontSize: '0.8rem' }}>{l.username || '—'}</td>
                            <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                              {prettyDetail(l.detail)}
                            </td>
                            <td className="hide-mobile" style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', fontFamily: 'monospace' }}>
                              {l.ip_address || '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
            }
          </div>
        </div>

        <Pagination
          total={data?.total ?? 0}
          page={page}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      </div>
    </>
  )
}
