import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import { useLogo } from '../hooks/useLogo'
import { useAuth } from '../context/AuthContext'
import { getSectionStyle } from '../lib/sectionColor'
import Pagination from '../components/Pagination'

const PAGE_SIZE = 50

function useDebounce(fn, delay) {
  const timer = useState(null)
  return useCallback((...args) => {
    clearTimeout(timer[0])
    timer[0] = setTimeout(() => fn(...args), delay)
  }, [fn, delay])
}

export default function CheckinPage() {
  const { user } = useAuth()
  const logoUrl = useLogo()
  const qc = useQueryClient()

  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [modal, setModal] = useState(null)
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(1)

  // When searching, fetch all matches (no pagination). When browsing, paginate.
  const isSearching = !!searchTerm || !!sectionFilter || !!statusFilter
  const debouncedSearch = useDebounce((val) => { setSearchTerm(val); setPage(1) }, 300)

  const { data, isLoading } = useQuery({
    queryKey: ['peserta-search', searchTerm, sectionFilter, statusFilter, isSearching ? 0 : page],
    queryFn: () => api.get('/peserta', {
      params: {
        q: searchTerm || undefined,
        section: sectionFilter || undefined,
        status: statusFilter || undefined,
        limit: isSearching ? 500 : PAGE_SIZE,
        offset: isSearching ? 0 : (page - 1) * PAGE_SIZE,
      }
    }).then(r => r.data),
    keepPreviousData: true,
  })

  const checkinMutation = useMutation({
    mutationFn: (id) => api.post(`/registrasi/${id}/checkin`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['peserta-search'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setModal(null)
    },
  })

  const unregisterMutation = useMutation({
    mutationFn: ({ id, reason }) => api.post(`/registrasi/${id}/unregister`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['peserta-search'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setModal(null)
    },
  })

  const pesertaList = data?.data || []
  const isBusy = checkinMutation.isPending || unregisterMutation.isPending

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {logoUrl && <img src={logoUrl} alt="Logo" style={{ height: 44, objectFit: 'contain' }} />}
          <div>
            <h1>Check-in Peserta</h1>
            <p>Cari nama, NIK, email, nomor kursi, atau section</p>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Search + Filter toggle */}
        <div className="filter-row" style={{ marginBottom: 12 }}>
          <div className="search-wrapper" style={{ flex: 1 }}>
            <span className="search-icon" style={{ fontSize: '1.2rem', left: 14 }}>⌕</span>
            <input
              type="search"
              placeholder="Cari nama, NIK, email, nomor kursi..."
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                debouncedSearch(e.target.value)
              }}
              autoFocus
              style={{ padding: '13px 16px 13px 44px', fontSize: '1rem', borderRadius: 'var(--radius-lg)' }}
            />
          </div>
          <button
            className={`btn ${showFilters ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setShowFilters(f => !f)}
            style={{ position: 'relative', alignSelf: 'stretch' }}
          >
            ⚙ Filter
            {(sectionFilter || statusFilter) && (
              <span style={{
                position: 'absolute', top: -4, right: -4,
                width: 8, height: 8, borderRadius: '50%',
                background: 'var(--danger)', border: '1.5px solid var(--surface)',
              }} />
            )}
          </button>
        </div>

        {/* Collapsible filters */}
        {showFilters && (
          <div style={{
            display: 'flex', gap: 10, flexWrap: 'wrap',
            marginBottom: 16, padding: '14px 16px',
            background: 'var(--bg)', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            animation: 'slideDown 0.15s ease',
          }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ marginBottom: 4, display: 'block' }}>Section</label>
              <select value={sectionFilter} onChange={e => { setSectionFilter(e.target.value); setPage(1) }}>
                <option value="">Semua Section</option>
                {['BLUE', 'ORANGE', 'YELLOW', 'RED', 'GREEN', 'WHITE', 'PURPLE', 'PINK'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ marginBottom: 4, display: 'block' }}>Status</label>
              <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}>
                <option value="">Semua Status</option>
                <option value="pending">Belum Check-in</option>
                <option value="registered">Sudah Check-in</option>
                <option value="cancelled">Dibatalkan</option>
              </select>
            </div>
            {(sectionFilter || statusFilter) && (
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => { setSectionFilter(''); setStatusFilter('') }}
                >
                  Reset
                </button>
              </div>
            )}
          </div>
        )}

        {/* Count */}
        <div style={{ marginBottom: 12, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {isLoading ? 'Memuat...' : `${data?.total ?? 0} peserta ditemukan`}
        </div>

        {/* Card Grid */}
        {isLoading ? (
          <div className="empty-state"><p>Memuat...</p></div>
        ) : pesertaList.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>🔍</div>
            <p>Tidak ada peserta ditemukan</p>
            {searchTerm && <p style={{ marginTop: 4, fontSize: '0.75rem' }}>Coba kata kunci lain</p>}
          </div>
        ) : (
          <div className="peserta-card-grid">
            {pesertaList.map(p => (
              <PesertaCard
                key={p.id}
                peserta={p}
                onCheckin={() => setModal({ type: 'checkin', peserta: p })}
                onUnregister={() => setModal({ type: 'unregister', peserta: p })}
                disabled={isBusy}
              />
            ))}
          </div>
        )}

        {/* Pagination — only when not searching */}
        {!isSearching && (
          <Pagination
            total={data?.total ?? 0}
            page={page}
            pageSize={PAGE_SIZE}
            onChange={setPage}
          />
        )}
      </div>

      {/* Confirm Modal */}
      {modal && (
        <ConfirmModal
          type={modal.type}
          peserta={modal.peserta}
          onConfirm={(reason) => {
            if (modal.type === 'checkin') {
              checkinMutation.mutate(modal.peserta.id)
            } else {
              unregisterMutation.mutate({ id: modal.peserta.id, reason })
            }
          }}
          onClose={() => setModal(null)}
          loading={isBusy}
          error={checkinMutation.error?.response?.data?.error || unregisterMutation.error?.response?.data?.error}
        />
      )}
    </>
  )
}

function PesertaCard({ peserta: p, onCheckin, onUnregister, disabled }) {
  const isRegistered = p.reg_status === 'registered'
  const isCancelled = p.reg_status === 'cancelled'
  const isPending = !p.reg_status || isCancelled

  return (
    <div className={`peserta-card ${isRegistered ? 'peserta-card-registered' : isCancelled ? 'peserta-card-cancelled' : ''}`}>
      {/* Status stripe */}
      <div className={`peserta-card-stripe ${isRegistered ? 'stripe-success' : isCancelled ? 'stripe-danger' : 'stripe-muted'}`} />

      <div className="peserta-card-body">
        {/* Header row: name + seat badge */}
        <div className="peserta-card-header">
          <div className="peserta-card-name">{p.nama}</div>
          {p.section && (
            <span style={{
              ...getSectionStyle(p.section),
              borderRadius: '10px',
              padding: '2px 10px',
              fontSize: '0.7rem',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}>
              {p.seat || p.section}
            </span>
          )}
        </div>

        {/* Details */}
        <div className="peserta-card-details">
          {p.nik && (
            <span className="peserta-card-detail">
              <span className="detail-icon">🪪</span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{p.nik}</span>
            </span>
          )}
          {p.email && (
            <span className="peserta-card-detail">
              <span className="detail-icon">✉</span>
              <span>{p.email}</span>
            </span>
          )}
          {p.no_telpon && (
            <span className="peserta-card-detail">
              <span className="detail-icon">📱</span>
              <span>{p.no_telpon}</span>
            </span>
          )}
        </div>

        {/* Footer: status + action */}
        <div className="peserta-card-footer">
          <div className="peserta-card-status">
            {isRegistered && (
              <>
                <span className="badge badge-success">✓ Check-in</span>
                {p.registered_at && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 6 }}>
                    {new Date(p.registered_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </>
            )}
            {isCancelled && <span className="badge badge-danger">✗ Dibatalkan</span>}
            {!p.reg_status && <span className="badge badge-muted">Belum Check-in</span>}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {isPending && (
              <button
                className="btn btn-success btn-sm"
                onClick={onCheckin}
                disabled={disabled}
              >
                Check-in
              </button>
            )}
            {isRegistered && (
              <button
                className="btn btn-danger btn-sm"
                onClick={onUnregister}
                disabled={disabled}
              >
                Batal
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ConfirmModal({ type, peserta, onConfirm, onClose, loading, error }) {
  const [reason, setReason] = useState('')
  const isUnregister = type === 'unregister'

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{isUnregister ? 'Konfirmasi Batalkan Registrasi' : 'Konfirmasi Check-in'}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-danger">{error}</div>}

          <p style={{ marginBottom: 16 }}>
            {isUnregister
              ? 'Yakin ingin membatalkan registrasi peserta berikut?'
              : 'Konfirmasi check-in peserta berikut:'}
          </p>

          <div style={{
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 16,
          }}>
            <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: 6 }}>{peserta.nama}</div>
            {peserta.nik && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: 4 }}>NIK: {peserta.nik}</div>}
            {peserta.seat && (
              <span style={{ ...getSectionStyle(peserta.section), borderRadius: '10px', padding: '2px 10px', fontSize: '0.75rem', fontWeight: 600 }}>
                {peserta.seat}
              </span>
            )}
          </div>

          {isUnregister && (
            <div className="form-group">
              <label htmlFor="reason">Alasan pembatalan (opsional)</label>
              <input
                id="reason"
                type="text"
                placeholder="Contoh: salah scan, human error..."
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose} disabled={loading}>Kembali</button>
          <button
            className={`btn ${isUnregister ? 'btn-danger' : 'btn-success'}`}
            onClick={() => onConfirm(reason)}
            disabled={loading}
          >
            {loading ? 'Memproses...' : isUnregister ? 'Ya, Batalkan' : 'Ya, Check-in'}
          </button>
        </div>
      </div>
    </div>
  )
}
