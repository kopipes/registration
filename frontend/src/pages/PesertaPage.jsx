import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { getSectionStyle } from '../lib/sectionColor'
import Pagination from '../components/Pagination'

const PAGE_SIZE = 50

export default function PesertaPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState(null)
  const [uploadResult, setUploadResult] = useState(null)
  const fileRef = useRef()
  const searchTimer = useRef()

  const { data, isLoading } = useQuery({
    queryKey: ['peserta-admin', searchTerm, sectionFilter, page],
    queryFn: () => api.get('/peserta', {
      params: { q: searchTerm || undefined, section: sectionFilter || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }
    }).then(r => r.data),
    keepPreviousData: true,
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/peserta/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['peserta-admin'] }),
  })

  function handleSearch(val) {
    setQuery(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearchTerm(val); setPage(1) }, 300)
  }

  function handleSectionChange(val) {
    setSectionFilter(val)
    setPage(1)
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadResult(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await api.post('/peserta/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setUploadResult({ success: true, ...res.data })
      qc.invalidateQueries({ queryKey: ['peserta-admin'] })
    } catch (err) {
      setUploadResult({ success: false, error: err.response?.data?.error || 'Upload gagal' })
    }
    e.target.value = ''
  }

  async function handleExport() {
    const res = await api.get('/export/peserta', { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `laporan-registrasi-${new Date().toISOString().slice(0,10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const pesertaList = data?.data || []

  const SectionBadge = ({ section }) => section
    ? <span style={{ ...getSectionStyle(section), borderRadius: '99px', padding: '2px 9px', fontSize: '0.68rem', fontWeight: 700, display: 'inline-block', whiteSpace: 'nowrap' }}>{section}</span>
    : null

  const StatusBadge = ({ status }) => {
    if (status === 'registered') return <span className="badge badge-success">Check-in</span>
    if (status === 'cancelled')  return <span className="badge badge-danger">Dibatalkan</span>
    return <span className="badge badge-muted">Belum</span>
  }

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1>Data Peserta</h1>
            <p>Kelola data peserta event</p>
          </div>
          {user?.role === 'admin' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>Upload Excel</button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleUpload} />
              <button className="btn btn-outline btn-sm" onClick={() => setModal({ type: 'add' })}>+ Tambah</button>
              <button className="btn btn-outline btn-sm" onClick={handleExport}>Export</button>
            </div>
          )}
        </div>
      </div>

      <div className="page-body">
        {uploadResult && (
          <div className={`alert ${uploadResult.success ? 'alert-success' : 'alert-danger'}`} style={{ marginBottom: 16 }}>
            {uploadResult.success
              ? `Upload berhasil: ${uploadResult.inserted} data baru, ${uploadResult.skipped} duplikat (total ${uploadResult.total} baris)`
              : uploadResult.error}
          </div>
        )}

        {/* Search + filter */}
        <div className="filter-row" style={{ marginBottom: 16 }}>
          <div className="search-wrapper" style={{ flex: 1 }}>
            <span className="search-icon">⌕</span>
            <input type="search" placeholder="Cari nama, NIK, email..." value={query} onChange={e => handleSearch(e.target.value)} />
          </div>
          <select value={sectionFilter} onChange={e => handleSectionChange(e.target.value)} style={{ minWidth: 130 }}>
            <option value="">Semua Section</option>
            {['BLUE','ORANGE','YELLOW','RED','GREEN','WHITE','PURPLE','PINK'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Count */}
        <div style={{ marginBottom: 12, fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>
          {isLoading ? 'Memuat...' : `${data?.total ?? 0} peserta`}
        </div>

        {/* Desktop table */}
        <div className="card desktop-only">
          <div className="table-wrapper">
            {isLoading
              ? <div className="empty-state"><p>Memuat...</p></div>
              : pesertaList.length === 0
                ? <div className="empty-state"><p>Tidak ada data peserta</p></div>
                : (
                  <table>
                    <thead>
                      <tr>
                        <th>Nama</th>
                        <th>NIK</th>
                        <th>Email</th>
                        <th>Telepon</th>
                        <th>Seat</th>
                        <th>Status</th>
                        {user?.role === 'admin' && <th>Aksi</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {pesertaList.map(p => (
                        <tr key={p.id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{p.nama}</div>
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{p.nik}</td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{p.email || '—'}</td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{p.no_telpon || '—'}</td>
                          <td>
                            {p.seat
                              ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <SectionBadge section={p.section} />
                                  <span style={{ fontSize: '0.78rem' }}>{p.seat_number}</span>
                                </div>
                              : '—'}
                          </td>
                          <td><StatusBadge status={p.reg_status} /></td>
                          {user?.role === 'admin' && (
                            <td>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button className="btn btn-outline btn-sm" onClick={() => setModal({ type: 'edit', peserta: p })}>Edit</button>
                                <button className="btn btn-danger btn-sm" onClick={() => { if (confirm(`Hapus peserta "${p.nama}"?`)) deleteMutation.mutate(p.id) }}>Hapus</button>
                              </div>
                            </td>
                          )}
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
            : pesertaList.length === 0
              ? <div className="empty-state"><p>Tidak ada data peserta</p></div>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {pesertaList.map(p => (
                    <div key={p.id} className="card" style={{ overflow: 'hidden' }}>
                      <div style={{ display: 'flex', overflow: 'hidden' }}>
                        {/* Status stripe */}
                        <div style={{
                          width: 4, flexShrink: 0,
                          background: p.reg_status === 'registered' ? 'var(--success)'
                            : p.reg_status === 'cancelled' ? 'var(--danger)' : 'var(--border)'
                        }} />
                        <div style={{ flex: 1, padding: '12px 14px' }}>
                          {/* Name + seat */}
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>{p.nama}</div>
                            {p.section && <SectionBadge section={p.section} />}
                          </div>
                          {/* Details */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
                            {p.nik && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.nik}</div>}
                            {p.email && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.email}</div>}
                            {p.no_telpon && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.no_telpon}</div>}
                          </div>
                          {/* Footer */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                            <StatusBadge status={p.reg_status} />
                            {user?.role === 'admin' && (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button className="btn btn-outline btn-sm" onClick={() => setModal({ type: 'edit', peserta: p })}>Edit</button>
                                <button className="btn btn-danger btn-sm" onClick={() => { if (confirm(`Hapus "${p.nama}"?`)) deleteMutation.mutate(p.id) }}>Hapus</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
          }
        </div>
      </div>

      {/* Pagination */}
      <Pagination
        total={data?.total ?? 0}
        page={page}
        pageSize={PAGE_SIZE}
        onChange={setPage}
      />

      {modal && (modal.type === 'add' || modal.type === 'edit') && (
        <PesertaFormModal
          peserta={modal.type === 'edit' ? modal.peserta : null}
          onClose={() => setModal(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['peserta-admin'] }); setModal(null) }}
        />
      )}
    </>
  )
}

function PesertaFormModal({ peserta, onClose, onSaved }) {
  const [form, setForm] = useState({
    nama: peserta?.nama || '', nik: peserta?.nik || '',
    email: peserta?.email || '', no_telpon: peserta?.no_telpon || '', seat: peserta?.seat || '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const isEdit = !!peserta

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      isEdit ? await api.put(`/peserta/${peserta.id}`, form) : await api.post('/peserta', form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error || 'Terjadi kesalahan')
    } finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{isEdit ? 'Edit Peserta' : 'Tambah Peserta'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-danger">{error}</div>}
            <div className="form-group"><label>Nama Lengkap *</label><input value={form.nama} onChange={e => setForm(f => ({ ...f, nama: e.target.value }))} required /></div>
            <div className="form-group"><label>NIK *</label><input value={form.nik} onChange={e => setForm(f => ({ ...f, nik: e.target.value }))} required /></div>
            <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div className="form-group"><label>No. Telepon</label><input value={form.no_telpon} onChange={e => setForm(f => ({ ...f, no_telpon: e.target.value }))} /></div>
            <div className="form-group"><label>Seat</label><input value={form.seat} onChange={e => setForm(f => ({ ...f, seat: e.target.value }))} placeholder="BLUE - 001" /></div>
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
