import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import { getSectionStyle } from '../lib/sectionColor'
import Pagination from '../components/Pagination'

const PAGE_SIZE = 50

export default function PesertaPage() {
  const { user } = useAuth()
  const { activeProject } = useProject()
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [batchFilter, setBatchFilter] = useState('')
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState(null)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const fileRef = useRef()
  const searchTimer = useRef()

  const isAdmin = user?.role === 'admin'
  // When searching/filtering, fetch all matches (no pagination). When browsing, paginate.
  const isFiltering = !!searchTerm || !!sectionFilter || !!batchFilter

  const { data, isLoading } = useQuery({
    queryKey: ['peserta-admin', searchTerm, sectionFilter, batchFilter, isFiltering ? 0 : page],
    queryFn: () => api.get('/peserta', {
      params: {
        q: searchTerm || undefined,
        section: sectionFilter || undefined,
        batch_id: batchFilter || undefined,
        limit: isFiltering ? 500 : PAGE_SIZE,
        offset: isFiltering ? 0 : (page - 1) * PAGE_SIZE,
      }
    }).then(r => r.data),
    keepPreviousData: true,
  })

  const { data: batches = [] } = useQuery({
    queryKey: ['batches'],
    queryFn: () => api.get('/peserta/batches').then(r => r.data).catch(() => []),
    enabled: isAdmin,
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/peserta/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['peserta-admin'] }),
  })

  const bulkUpdateMutation = useMutation({
    mutationFn: (payload) => api.post('/peserta/bulk-update', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['peserta-admin'] })
      setSelected(new Set())
      setModal(null)
    },
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids) => api.post('/peserta/bulk-delete', { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['peserta-admin'] })
      setSelected(new Set())
      setModal(null)
    },
  })

  const deleteBatchMutation = useMutation({
    mutationFn: (id) => api.delete(`/peserta/batches/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['peserta-admin'] })
      qc.invalidateQueries({ queryKey: ['batches'] })
      if (String(batchFilter) === String(deletingBatchId)) setBatchFilter('')
    },
  })

  const [deletingBatchId, setDeletingBatchId] = useState(null)

  function handleSearch(val) {
    setQuery(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearchTerm(val); setPage(1) }, 300)
  }

  function handleSectionChange(val) {
    setSectionFilter(val)
    setPage(1)
    setSelected(new Set())
  }

  function handleBatchChange(val) {
    setBatchFilter(val)
    setPage(1)
    setSelected(new Set())
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadResult(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post('/peserta/upload/preview', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      // Open mapping modal with preview data + the file for final import
      setModal({ type: 'upload-mapping', preview: res.data, file })
    } catch (err) {
      setUploadResult({ success: false, error: err.response?.data?.error || 'Gagal membaca file' })
    } finally {
      setUploading(false)
    }
    e.target.value = ''
  }

  async function performImport(mapping, uniqueFields) {
    const { file } = modal
    const form = new FormData()
    form.append('file', file)
    form.append('mapping', JSON.stringify(mapping))
    form.append('unique_fields', JSON.stringify(uniqueFields))
    const res = await api.post('/peserta/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    setUploadResult({ success: true, ...res.data })
    qc.invalidateQueries({ queryKey: ['peserta-admin'] })
    qc.invalidateQueries({ queryKey: ['batches'] })
    qc.invalidateQueries({ queryKey: ['projects'] })
    setModal(null)
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

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    const ids = pesertaList.map(p => p.id)
    const allSelected = ids.every(id => selected.has(id))
    setSelected(allSelected ? new Set() : new Set(ids))
  }

  const SectionBadge = ({ section }) => section
    ? <span style={{ ...getSectionStyle(section), borderRadius: '99px', padding: '2px 9px', fontSize: '0.68rem', fontWeight: 700, display: 'inline-block', whiteSpace: 'nowrap' }}>{section}</span>
    : null

  const StatusBadge = ({ status }) => {
    if (status === 'registered') return <span className="badge badge-success">Check-in</span>
    if (status === 'cancelled')  return <span className="badge badge-danger">Dibatalkan</span>
    return <span className="badge badge-muted">Belum</span>
  }

  const selectedCount = selected.size
  const allOnPageSelected = pesertaList.length > 0 && pesertaList.every(p => selected.has(p.id))

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1>Data Peserta</h1>
            <p>Kelola data peserta event</p>
          </div>
          {isAdmin && (
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
              ? `Upload berhasil: ${uploadResult.inserted} data baru, ${uploadResult.skipped} dilewati (email/NIK sudah ada, tidak tertimpa) — batch #${uploadResult.batch_id}`
              : uploadResult.error}
          </div>
        )}

        {/* Search + filters */}
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
          {isAdmin && (
            <select value={batchFilter} onChange={e => handleBatchChange(e.target.value)} style={{ minWidth: 150 }}>
              <option value="">Semua Batch Upload</option>
              {batches.map(b => (
                <option key={b.id} value={b.id}>
                  #{b.id} — {b.filename?.slice(0, 20)} ({new Date(b.uploaded_at).toLocaleDateString('id-ID')})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Bulk actions bar */}
        {isAdmin && selectedCount > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '10px 14px', marginBottom: 16,
            background: 'var(--primary)', borderRadius: 'var(--radius-lg)',
            color: '#fff', animation: 'slideDown 0.15s ease',
          }}>
            <strong style={{ fontSize: '0.85rem' }}>{selectedCount} dipilih</strong>
            <div style={{ flex: 1 }} />
            <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }} onClick={() => setModal({ type: 'bulk-edit' })}>
              ✎ Bulk Edit
            </button>
            <button className="btn btn-sm" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }} onClick={() => setSelected(new Set())}>
              Batal
            </button>
            <button className="btn btn-danger btn-sm" onClick={() => setModal({ type: 'bulk-delete' })}>
              Hapus ({selectedCount})
            </button>
          </div>
        )}

        {/* Batch info card when batch filter active */}
        {isAdmin && batchFilter && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px' }}>
              <span className="badge badge-primary">Batch #{batchFilter}</span>
              {(() => {
                const b = batches.find(x => String(x.id) === String(batchFilter))
                if (!b) return null
                return (
                  <>
                    <span style={{ fontSize: '0.8rem' }}>{b.filename}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      diupload {new Date(b.uploaded_at).toLocaleString('id-ID')} oleh {b.uploaded_by_name || '—'}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      • {b.active_peserta} peserta aktif
                    </span>
                    <div style={{ flex: 1 }} />
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        setDeletingBatchId(batchFilter)
                        if (confirm(`Hapus SEMUA peserta di batch #${batchFilter}?\n\n${b.active_peserta} peserta akan dinonaktifkan.`)) {
                          deleteBatchMutation.mutate(batchFilter)
                        }
                      }}
                    >
                      Hapus Batch Ini
                    </button>
                  </>
                )
              })()}
            </div>
          </div>
        )}

        {/* Count + select all */}
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          {isAdmin && pesertaList.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 500, marginBottom: 0, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={allOnPageSelected}
                onChange={toggleSelectAll}
                style={{ width: 'auto' }}
              />
              Pilih semua
            </label>
          )}
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>
            {isLoading ? 'Memuat...' : `${data?.total ?? 0} peserta`}
          </span>
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
                        {isAdmin && <th style={{ width: 40 }}></th>}
                        <th>Nama</th>
                        <th>NIK</th>
                        <th>Email</th>
                        <th>Seat</th>
                        <th>Status</th>
                        {isAdmin && <th>Aksi</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {pesertaList.map(p => (
                        <tr
                          key={p.id}
                          style={selected.has(p.id)
                            ? { background: 'rgba(49,130,206,0.08)', boxShadow: 'inset 3px 0 0 var(--primary)' }
                            : undefined}
                        >
                          {isAdmin && (
                            <td>
                              <input
                                type="checkbox"
                                checked={selected.has(p.id)}
                                onChange={() => toggleSelect(p.id)}
                                style={{ width: 'auto', cursor: 'pointer' }}
                              />
                            </td>
                          )}
                          <td>
                            <div style={{ fontWeight: 600 }}>{p.nama}</div>
                            {p.upload_batch_id && (
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-subtle)', marginTop: 2 }}>
                                batch #{p.upload_batch_id}
                              </div>
                            )}
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{p.nik}</td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{p.email || '—'}</td>
                          <td>
                            {p.seat
                              ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <SectionBadge section={p.section} />
                                  <span style={{ fontSize: '0.78rem' }}>{p.seat_number}</span>
                                </div>
                              : '—'}
                          </td>
                          <td><StatusBadge status={p.reg_status} /></td>
                          {isAdmin && (
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
                    <div key={p.id} className="card" style={{
                      overflow: 'hidden',
                      border: selected.has(p.id) ? '1.5px solid var(--primary)' : undefined,
                      background: selected.has(p.id) ? 'rgba(49,130,206,0.05)' : undefined,
                    }}>
                      <div style={{ display: 'flex', overflow: 'hidden' }}>
                        <div style={{
                          width: 4, flexShrink: 0,
                          background: p.reg_status === 'registered' ? 'var(--success)'
                            : p.reg_status === 'cancelled' ? 'var(--danger)' : 'var(--border)'
                        }} />
                        <div style={{ flex: 1, padding: '12px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                              {isAdmin && (
                                <input
                                  type="checkbox"
                                  checked={selected.has(p.id)}
                                  onChange={() => toggleSelect(p.id)}
                                  style={{ width: 'auto', cursor: 'pointer', flexShrink: 0 }}
                                />
                              )}
                              <div style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>{p.nama}</div>
                            </div>
                            {p.section && <SectionBadge section={p.section} />}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
                            {p.nik && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.nik}</div>}
                            {p.email && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.email}</div>}
                            {p.no_telpon && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.no_telpon}</div>}
                            {p.upload_batch_id && <div style={{ fontSize: '0.68rem', color: 'var(--text-subtle)' }}>batch #{p.upload_batch_id}</div>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                            <StatusBadge status={p.reg_status} />
                            {isAdmin && (
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
      <div style={{ padding: '0 28px' }}>
        {!isFiltering && (
          <Pagination
            total={data?.total ?? 0}
            page={page}
            pageSize={PAGE_SIZE}
            onChange={setPage}
          />
        )}
      </div>

      {modal?.type === 'upload-mapping' && (
        <UploadMappingModal
          preview={modal.preview}
          activeProject={activeProject}
          onClose={() => setModal(null)}
          onImport={performImport}
          importing={uploading}
        />
      )}
      {modal?.type === 'bulk-edit' && (
        <BulkEditModal
          count={selectedCount}
          loading={bulkUpdateMutation.isPending}
          error={bulkUpdateMutation.error?.response?.data?.error}
          onSubmit={(updates) => bulkUpdateMutation.mutate({ ids: [...selected], updates })}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'bulk-delete' && (
        <BulkDeleteModal
          count={selectedCount}
          loading={bulkDeleteMutation.isPending}
          error={bulkDeleteMutation.error?.response?.data?.error}
          onConfirm={() => bulkDeleteMutation.mutate([...selected])}
          onClose={() => setModal(null)}
        />
      )}
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

function BulkEditModal({ count, loading, error, onSubmit, onClose }) {
  const [seat, setSeat] = useState('')

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>Bulk Edit — {count} peserta</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-danger">{error}</div>}
          <p style={{ fontSize: '0.85rem', marginBottom: 16, color: 'var(--text-muted)' }}>
            Ubah seat/section untuk semua peserta terpilih sekaligus.
          </p>
          <div className="form-group">
            <label>Seat Baru (contoh: BLUE - 001)</label>
            <input value={seat} onChange={e => setSeat(e.target.value)} placeholder="Kosongkan jika tidak diubah" />
            <div className="form-hint">Format SECTION - NOMOR. Section otomatis ter-extract dari seat.</div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose} disabled={loading}>Batal</button>
          <button className="btn btn-primary" onClick={() => onSubmit({ seat })} disabled={loading || !seat.trim()}>
            {loading ? 'Menyimpan...' : `Update ${count} peserta`}
          </button>
        </div>
      </div>
    </div>
  )
}

function BulkDeleteModal({ count, loading, error, onConfirm, onClose }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>Konfirmasi Hapus</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="alert alert-danger">
            Yakin hapus <strong>{count} peserta</strong> terpilih? Data bisa di-restore manual oleh admin dari database, tapi tidak tampil lagi di aplikasi.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose} disabled={loading}>Batal</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? 'Menghapus...' : `Ya, Hapus ${count}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function PesertaFormModal({ peserta, onClose, onSaved }) {
  const [form, setForm] = useState({
    nama: peserta?.nama || '', kode: peserta?.kode || '', nik: peserta?.nik || '',
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
            <div className="form-group"><label>Kode Tiket / Booking</label><input value={form.kode} onChange={e => setForm(f => ({ ...f, kode: e.target.value }))} placeholder="Opsional" /></div>
            <div className="form-group"><label>NIK</label><input value={form.nik} onChange={e => setForm(f => ({ ...f, nik: e.target.value }))} placeholder="Opsional" /></div>
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

const IMPORT_FIELDS = [
  { key: 'nama',      label: 'Nama Lengkap',   required: true },
  { key: 'kode',      label: 'Kode Tiket/Booking', required: false },
  { key: 'nik',       label: 'NIK',            required: false },
  { key: 'email',     label: 'Email',          required: false },
  { key: 'no_telpon', label: 'No. Telepon',    required: false },
  { key: 'seat',      label: 'Seat / Kursi',   required: false },
]

const UNIQUE_FIELD_OPTIONS = [
  { key: 'kode',      label: 'Kode Tiket / Booking' },
  { key: 'nik',       label: 'NIK' },
  { key: 'email',     label: 'Email' },
  { key: 'no_telpon', label: 'No. Telepon' },
]

function UploadMappingModal({ preview, onClose, onImport, importing, activeProject }) {
  const [mapping, setMapping] = useState(() => {
    const m = {}
    IMPORT_FIELDS.forEach(f => {
      m[f.key] = preview.mapping?.[f.key] ?? null
    })
    return m
  })
  const [uniqueFields, setUniqueFields] = useState(() => {
    // Seed from project config; keep only fields that make sense as identity
    try {
      const parsed = JSON.parse(activeProject?.unique_fields || '["nik"]')
      return Array.isArray(parsed) && parsed.length ? parsed : ['nik']
    } catch { return ['nik'] }
  })
  const [error, setError] = useState('')

  function setField(key, value) {
    setMapping(prev => ({ ...prev, [key]: value === '' ? null : Number(value) }))
  }

  function toggleUnique(key) {
    setUniqueFields(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  const namaOk = !!mapping.nama
  // Every selected unique field must be mapped to an Excel column
  const mappedUnique = uniqueFields.filter(f => !!mapping[f])
  const uniqueOk = uniqueFields.length > 0 && mappedUnique.length === uniqueFields.length
  const canImport = namaOk && uniqueOk && !importing

  function handleImport() {
    if (!namaOk) return setError('Kolom Nama wajib dipetakan')
    if (uniqueFields.length === 0) return setError('Pilih minimal satu patokan unik')
    if (!uniqueOk) {
      const missing = uniqueFields.filter(f => !mapping[f])
      return setError(`Patokan unik berikut belum dipetakan ke kolom Excel: ${missing.join(', ')}`)
    }
    setError('')
    onImport(mapping, uniqueFields)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <h3>Petakan Kolom Excel</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="alert alert-warning" style={{ marginBottom: 16 }}>
            File: <strong>{preview.filename}</strong> — {preview.total_rows} baris.
            {preview.saved_mapping_exists
              ? ' Mapping tersimpan untuk project ini sudah diterapkan.'
              : ' Cocokkan kolom Excel ke field sistem di bawah.'}
          </div>

          {error && <div className="alert alert-danger">{error}</div>}

          <div className="mapping-table">
            <div className="mapping-row mapping-head">
              <div>Field Sistem</div>
              <div>Kolom Excel</div>
            </div>
            {IMPORT_FIELDS.map(f => (
              <div key={f.key} className="mapping-row">
                <div className="mapping-label">
                  {f.label}
                  {f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                </div>
                <select
                  value={mapping[f.key] ?? ''}
                  onChange={e => setField(f.key, e.target.value)}
                  className={f.required && !mapping[f.key] ? 'error' : ''}
                >
                  <option value="">— Abaikan —</option>
                  {preview.headers.map(h => (
                    <option key={h.index} value={h.index}>{h.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Unique fields selection — at import time */}
          <div style={{ marginTop: 20 }}>
            <p style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: 4 }}>
              Patokan Unik (anti-duplikat)
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 10 }}>
              Pilih field yang menentukan peserta unik. Baris dengan nilai sama akan dilewati saat import.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {UNIQUE_FIELD_OPTIONS.map(opt => {
                const selected = uniqueFields.includes(opt.key)
                const mapped = !!mapping[opt.key]
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => toggleUnique(opt.key)}
                    style={{
                      padding: '7px 12px', borderRadius: '99px', cursor: 'pointer',
                      fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                      border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                      background: selected ? '#eff6ff' : 'var(--surface)',
                      color: selected ? 'var(--accent)' : 'var(--text-2)',
                      opacity: selected && !mapped ? 0.6 : 1,
                    }}
                    title={selected && !mapped ? 'Field ini belum dipetakan ke kolom Excel' : ''}
                  >
                    {selected ? '✓ ' : ''}{opt.label}
                    {selected && !mapped && ' (belum dipetakan)'}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Sample preview */}
          {preview.samples?.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 8 }}>Contoh data:</p>
              <div className="table-wrapper">
                <table style={{ fontSize: '0.75rem' }}>
                  <thead>
                    <tr>{preview.headers.map(h => <th key={h.index}>{h.name}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.samples.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => <td key={j}>{cell || '—'}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose} disabled={importing}>Batal</button>
          <button className="btn btn-primary" onClick={handleImport} disabled={!canImport}>
            {importing ? 'Mengimpor...' : `Import ${preview.total_rows} Baris`}
          </button>
        </div>
      </div>
    </div>
  )
}
