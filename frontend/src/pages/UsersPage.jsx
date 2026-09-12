import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'

export default function UsersPage() {
  const { user: currentUser } = useAuth()
  const qc = useQueryClient()
  const [modal, setModal] = useState(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then(r => r.data),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id) => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
  const activateMutation = useMutation({
    mutationFn: (id) => api.put(`/users/${id}`, { is_active: 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
  const hardDeleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/users/${id}/permanent`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const ROLE_LABEL = { admin: 'Admin', official: 'Official', crew: 'Crew' }
  const ROLE_BADGE = { admin: 'badge-danger', official: 'badge-warning', crew: 'badge-primary' }

  function UserActions({ u }) {
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-outline btn-sm" onClick={() => setModal({ type: 'edit', user: u })}>Edit</button>
        <button className="btn btn-outline btn-sm" onClick={() => setModal({ type: 'password', user: u })}>Password</button>
        {u.id !== currentUser?.id && (
          <>
            {u.is_active
              ? <button className="btn btn-danger btn-sm" onClick={() => { if (confirm(`Nonaktifkan "${u.username}"?`)) deactivateMutation.mutate(u.id) }}>Nonaktifkan</button>
              : <button className="btn btn-success btn-sm" onClick={() => activateMutation.mutate(u.id)}>Aktifkan</button>
            }
            <button className="btn btn-danger btn-sm" onClick={() => { if (confirm(`HAPUS PERMANEN "${u.username}"?\n\nTidak bisa dibatalkan.`)) hardDeleteMutation.mutate(u.id) }}>Hapus</button>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1>Kelola User</h1>
            <p>Akun bersifat <strong>global</strong> — satu akun bisa dipakai di semua project</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'add' })}>+ Tambah User</button>
        </div>
      </div>

      <div className="page-body">
        {/* Desktop table */}
        <div className="card desktop-only">
          <div className="table-wrapper">
            {isLoading
              ? <div className="empty-state"><p>Memuat...</p></div>
              : (
                <table>
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Username</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Dibuat</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td><strong>{u.full_name}</strong></td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{u.username}</td>
                        <td><span className={`badge ${ROLE_BADGE[u.role]}`}>{ROLE_LABEL[u.role]}</span></td>
                        <td>
                          {u.is_active
                            ? <span className="badge badge-success">Aktif</span>
                            : <span className="badge badge-muted">Nonaktif</span>}
                        </td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {new Date(u.created_at).toLocaleDateString('id-ID')}
                        </td>
                        <td><UserActions u={u} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>
        </div>

        {/* Mobile card list */}
        <div className="mobile-only">
          {isLoading
            ? <div className="empty-state"><p>Memuat...</p></div>
            : users.length === 0
              ? <div className="empty-state"><p>Belum ada user</p></div>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {users.map(u => (
                    <div key={u.id} className="card">
                      <div className="card-body">
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                          <div style={{
                            width: 40, height: 40, borderRadius: '50%',
                            background: 'var(--primary)', color: '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 700, fontSize: '0.9rem', flexShrink: 0,
                          }}>
                            {u.full_name?.charAt(0)?.toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{u.full_name}</div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>@{u.username}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                            <span className={`badge ${ROLE_BADGE[u.role]}`}>{ROLE_LABEL[u.role]}</span>
                            {u.is_active
                              ? <span className="badge badge-success">Aktif</span>
                              : <span className="badge badge-muted">Nonaktif</span>}
                          </div>
                        </div>
                        {/* Actions */}
                        <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                          <UserActions u={u} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
          }
        </div>
      </div>

      {modal?.type === 'add' && (
        <UserFormModal onClose={() => setModal(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['users'] }); setModal(null) }} />
      )}
      {modal?.type === 'edit' && (
        <UserFormModal user={modal.user} onClose={() => setModal(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['users'] }); setModal(null) }} />
      )}
      {modal?.type === 'password' && (
        <ChangePasswordModal user={modal.user} onClose={() => setModal(null)} />
      )}
    </>
  )
}

function UserFormModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({
    username: user?.username || '', full_name: user?.full_name || '',
    role: user?.role || 'crew', password: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const isEdit = !!user

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const payload = isEdit ? { username: form.username, full_name: form.full_name, role: form.role } : form
      isEdit ? await api.put(`/users/${user.id}`, payload) : await api.post('/users', payload)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error || 'Terjadi kesalahan')
    } finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{isEdit ? 'Edit User' : 'Tambah User'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-danger">{error}</div>}
            <div className="form-group"><label>Nama Lengkap *</label><input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} required /></div>
            <div className="form-group">
              <label>Username *</label>
              <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required minLength={3} />
              {isEdit && <div className="form-hint">Mengubah username akan memaksa user login ulang</div>}
            </div>
            {!isEdit && (
              <div className="form-group">
                <label>Password *</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={6} />
                <div className="form-hint">Minimal 6 karakter</div>
              </div>
            )}
            <div className="form-group">
              <label>Role *</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="crew">Crew</option>
                <option value="official">Official</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={loading}>Batal</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Menyimpan...' : 'Simpan'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ChangePasswordModal({ user, onClose }) {
  const [form, setForm] = useState({ new_password: '', confirm: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (form.new_password !== form.confirm) return setError('Konfirmasi password tidak cocok')
    setError(''); setLoading(true)
    try {
      await api.put(`/users/${user.id}`, { password: form.new_password })
      setSuccess(true)
    } catch (err) {
      setError(err.response?.data?.error || 'Gagal mengubah password')
    } finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>Reset Password — {user.username}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-danger">{error}</div>}
            {success && <div className="alert alert-success">Password berhasil diubah</div>}
            <div className="form-group"><label>Password Baru *</label><input type="password" value={form.new_password} onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))} required minLength={6} /></div>
            <div className="form-group"><label>Konfirmasi Password *</label><input type="password" value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} required /></div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline" onClick={onClose}>Tutup</button>
            {!success && <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Menyimpan...' : 'Ubah Password'}</button>}
          </div>
        </form>
      </div>
    </div>
  )
}
