import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'

export default function ProjectsPage() {
  const { user, logout } = useAuth()
  const { projects, isLoading, refetchProjects } = useProject()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [modal, setModal] = useState(null)
  const [showArchived, setShowArchived] = useState(false)

  const isAdmin = user?.role === 'admin'

  const { data: archived = [] } = useQuery({
    queryKey: ['projects-archived'],
    queryFn: () => api.get('/projects', { params: { archived: 1 } }).then(r => r.data),
    select: rows => rows.filter(r => r.status === 'archived'),
    enabled: isAdmin,
  })

  const archiveMutation = useMutation({
    mutationFn: (id) => api.post(`/projects/${id}/archive`),
    onSuccess: () => { refetchProjects(); qc.invalidateQueries({ queryKey: ['projects-archived'] }) },
  })

  const unarchiveMutation = useMutation({
    mutationFn: (id) => api.post(`/projects/${id}/unarchive`),
    onSuccess: () => { refetchProjects(); qc.invalidateQueries({ queryKey: ['projects-archived'] }) },
  })

  const deleteMutation = useMutation({
    mutationFn: ({ id, confirmName }) => api.delete(`/projects/${id}`, { data: { confirm_name: confirmName } }),
    onSuccess: () => { refetchProjects(); qc.invalidateQueries({ queryKey: ['projects-archived'] }) },
  })

  function openProject(p) {
    localStorage.setItem('project_id', String(p.id))
    navigate('/')
    window.location.reload()
  }

  return (
    <div className="projects-page">
      <header className="projects-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="login-icon" style={{ width: 36, height: 36, fontSize: '1rem', borderRadius: 10 }}>🎫</div>
          <div>
            <strong style={{ fontSize: '0.95rem' }}>Pilih Project</strong>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Login sebagai {user?.full_name} ({user?.role})
            </div>
          </div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => { logout(); navigate('/login') }}>
          Keluar
        </button>
      </header>

      <main className="projects-body">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ fontSize: '1.3rem', fontWeight: 800, letterSpacing: '-0.02em' }}>Project Aktif</h1>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Pilih project untuk mulai registrasi
            </p>
          </div>
          {isAdmin && (
            <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'create' })}>
              + Project Baru
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="empty-state"><p>Memuat...</p></div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>📋</div>
            <p>Belum ada project aktif</p>
            {isAdmin && (
              <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => setModal({ type: 'create' })}>
                Buat Project Pertama
              </button>
            )}
          </div>
        ) : (
          <div className="project-grid">
            {projects.map(p => (
              <button key={p.id} className="project-card" onClick={() => openProject(p)}>
                <div className="project-card-logo">
                  {p.logo_url
                    ? <img src={p.logo_url} alt={p.name} />
                    : <span style={{ fontSize: '1.6rem' }}>🎫</span>}
                </div>
                <div className="project-card-body">
                  <div className="project-card-name">{p.event_name || p.name}</div>
                  {p.description && <div className="project-card-desc">{p.description}</div>}
                  <div className="project-card-stats">
                    <span className="badge badge-primary">{p.peserta_count} peserta</span>
                    <span className="badge badge-success">{p.registered_count} check-in</span>
                  </div>
                  <div className="project-card-meta">
                    Dibuat {new Date(p.created_at).toLocaleDateString('id-ID')}
                  </div>
                </div>
                {isAdmin && (
                  <div
                    className="project-card-actions"
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => setModal({ type: 'edit', project: p })}
                    >Edit</button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        if (confirm(`Arsipkan project "${p.event_name || p.name}"?\n\nProject tidak akan muncul di daftar aktif.`)) {
                          archiveMutation.mutate(p.id)
                        }
                      }}
                    >Arsipkan</button>
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={() => setModal({ type: 'delete', project: p })}
                    >Hapus</button>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {isAdmin && archived.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setShowArchived(s => !s)}
            >
              {showArchived ? '▾' : '▸'} Project Terarsip ({archived.length})
            </button>
            {showArchived && (
              <div className="project-grid" style={{ marginTop: 14 }}>
                {archived.map(p => (
                  <div key={p.id} className="project-card project-card-archived">
                    <div className="project-card-logo">
                      {p.logo_url
                        ? <img src={p.logo_url} alt={p.name} style={{ opacity: 0.5 }} />
                        : <span style={{ fontSize: '1.6rem', opacity: 0.5 }}>🎫</span>}
                    </div>
                    <div className="project-card-body">
                      <div className="project-card-name">{p.event_name || p.name}</div>
                      <div className="project-card-stats">
                        <span className="badge badge-muted">Terarsip</span>
                        <span className="badge badge-muted">{p.peserta_count} peserta</span>
                      </div>
                    </div>
                    <div className="project-card-actions">
                      <button
                        className="btn btn-success btn-sm"
                        onClick={() => unarchiveMutation.mutate(p.id)}
                      >Aktifkan</button>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                        onClick={() => setModal({ type: 'delete', project: p })}
                      >Hapus</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {modal && (modal.type === 'create' || modal.type === 'edit') && (
        <ProjectFormModal
          project={modal.type === 'edit' ? modal.project : null}
          onClose={() => setModal(null)}
          onSaved={() => { refetchProjects(); setModal(null) }}
        />
      )}
      {modal?.type === 'delete' && (
        <DeleteProjectModal
          project={modal.project}
          deleting={deleteMutation.isPending}
          error={deleteMutation.error?.response?.data?.error}
          onClose={() => { deleteMutation.reset(); setModal(null) }}
          onConfirm={(confirmName) => deleteMutation.mutate(
            { id: modal.project.id, confirmName },
            { onSuccess: () => setModal(null) }
          )}
        />
      )}
    </div>
  )
}

function DeleteProjectModal({ project, deleting, error, onClose, onConfirm }) {
  const projectName = project.event_name || project.name
  const [typed, setTyped] = useState('')
  const matches = typed.trim().toLowerCase() === projectName.trim().toLowerCase()

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>Hapus Project Permanen</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-danger">{error}</div>}

          <div className="alert alert-danger" style={{ marginBottom: 16 }}>
            <div>
              <strong>Peringatan:</strong> tindakan ini <strong>tidak bisa dibatalkan</strong>.
              Semua data berikut akan dihapus permanen:
              <ul style={{ margin: '8px 0 0 18px', fontSize: '0.82rem' }}>
                <li>{project.peserta_count || 0} peserta</li>
                <li>{project.registered_count || 0} riwayat check-in</li>
                <li>Semua batch upload & pemetaan kolom</li>
              </ul>
            </div>
          </div>

          <p style={{ fontSize: '0.85rem', marginBottom: 10 }}>
            Ketik nama project berikut untuk konfirmasi:
            <br />
            <strong style={{ fontSize: '0.95rem' }}>{projectName}</strong>
          </p>
          <input
            type="text"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder={projectName}
            autoFocus
            style={{ borderColor: typed && !matches ? 'var(--danger)' : undefined }}
          />
          {typed && !matches && (
            <div className="form-error">Nama tidak cocok</div>
          )}
          <div className="form-hint" style={{ marginTop: 8 }}>
            Tip: bisa juga arsipkan project ini jika hanya ingin menyembunyikannya.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose} disabled={deleting}>Batal</button>
          <button
            className="btn btn-danger"
            onClick={() => matches && onConfirm(typed)}
            disabled={!matches || deleting}
          >
            {deleting ? 'Menghapus...' : 'Hapus Permanen'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProjectFormModal({ project, onClose, onSaved }) {
  const [name, setName] = useState(project?.name || '')
  const [description, setDescription] = useState(project?.description || '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const isEdit = !!project

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      if (isEdit) {
        await api.put(`/projects/${project.id}`, { name, description })
      } else {
        await api.post('/projects', { name, description })
      }
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error || 'Terjadi kesalahan')
    } finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{isEdit ? 'Edit Project' : 'Project Baru'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-danger">{error}</div>}
            <div className="form-group">
              <label>Nama Project *</label>
              <input value={name} onChange={e => setName(e.target.value)} required placeholder="Contoh: iQIYI Starship 2026" />
            </div>
            <div className="form-group">
              <label>Deskripsi</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Opsional" />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={loading}>Batal</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
