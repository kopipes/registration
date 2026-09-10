import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import { useTheme, THEMES } from '../context/ThemeContext'

export default function SettingsPage() {
  const qc = useQueryClient()
  const logoRef = useRef()
  const { currentTheme, setTheme } = useTheme()

  const { data: settings = {}, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
  })

  const [eventName, setEventName] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [logoMsg, setLogoMsg] = useState('')
  const [uploadingLogo, setUploadingLogo] = useState(false)

  const saveMutation = useMutation({
    mutationFn: (data) => api.put('/settings', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      setSaveMsg('Pengaturan berhasil disimpan')
      setTimeout(() => setSaveMsg(''), 3000)
    },
  })

  const deleteLogoMutation = useMutation({
    mutationFn: () => api.delete('/settings/logo'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      setLogoMsg('Logo berhasil dihapus')
      setTimeout(() => setLogoMsg(''), 3000)
    },
  })

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoMsg('')
    setUploadingLogo(true)
    try {
      const form = new FormData()
      form.append('file', file)
      await api.post('/settings/logo', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      qc.invalidateQueries({ queryKey: ['settings'] })
      setLogoMsg('Logo berhasil diupload')
    } catch (err) {
      setLogoMsg(err.response?.data?.error || 'Upload logo gagal')
    } finally {
      setUploadingLogo(false)
    }
    e.target.value = ''
  }

  async function handleExportLog() {
    const res = await api.get('/export/log', { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) return <div className="page-body"><p>Memuat...</p></div>

  return (
    <>
      <div className="page-header">
        <h1>Pengaturan</h1>
        <p>Konfigurasi tampilan dan sistem</p>
      </div>
      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Event Name */}
        <div className="card">
          <div className="card-header"><h2>Nama Event</h2></div>
          <div className="card-body">
            {saveMsg && <div className="alert alert-success">{saveMsg}</div>}
            <div className="form-group">
              <label>Nama Event</label>
              <input
                type="text"
                placeholder={settings.event_name || 'Masukkan nama event...'}
                defaultValue={settings.event_name || ''}
                onChange={e => setEventName(e.target.value)}
              />
              <div className="form-hint">Ditampilkan di halaman login</div>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => saveMutation.mutate({ event_name: eventName || settings.event_name })}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>

        {/* Color Theme */}
        <div className="card">
          <div className="card-header"><h2>Tema Warna</h2></div>
          <div className="card-body">
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              Pilih warna tema yang sesuai dengan identitas brand event Anda. Perubahan langsung diterapkan.
            </p>

            <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 10 }}>Dark Themes</p>
            <div className="theme-grid" style={{ marginBottom: 20 }}>
              {Object.entries(THEMES).filter(([, t]) => t.dark).map(([key, theme]) => (
                <button
                  key={key}
                  className={`theme-swatch ${currentTheme === key ? 'theme-swatch-active' : ''}`}
                  onClick={() => setTheme(key)}
                  title={theme.name}
                >
                  <span className="theme-swatch-color" style={{ background: theme.preview }} />
                  <span className="theme-swatch-label">{theme.name}</span>
                  {currentTheme === key && <span className="theme-swatch-check">✓</span>}
                </button>
              ))}
            </div>

            <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 10 }}>Light Themes</p>
            <div className="theme-grid">
              {Object.entries(THEMES).filter(([, t]) => !t.dark).map(([key, theme]) => (
                <button
                  key={key}
                  className={`theme-swatch ${currentTheme === key ? 'theme-swatch-active' : ''}`}
                  onClick={() => setTheme(key)}
                  title={theme.name}
                >
                  <span className="theme-swatch-color" style={{ background: theme.preview, border: '1px solid #e2e8f0' }} />
                  <span className="theme-swatch-label">{theme.name}</span>
                  {currentTheme === key && <span className="theme-swatch-check">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Logo */}
        <div className="card">
          <div className="card-header"><h2>Logo Event</h2></div>
          <div className="card-body">
            {logoMsg && <div className={`alert ${logoMsg.includes('gagal') ? 'alert-danger' : 'alert-success'}`}>{logoMsg}</div>}

            {settings.logo_url && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>Logo saat ini:</p>
                <img
                  src={settings.logo_url}
                  alt="Logo"
                  style={{ maxHeight: 80, maxWidth: 200, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => logoRef.current?.click()}
                disabled={uploadingLogo}
              >
                {uploadingLogo ? 'Mengupload...' : settings.logo_url ? 'Ganti Logo' : 'Upload Logo'}
              </button>
              {settings.logo_url && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => { if (confirm('Hapus logo?')) deleteLogoMutation.mutate() }}
                  disabled={deleteLogoMutation.isPending}
                >
                  Hapus Logo
                </button>
              )}
            </div>
            <div className="form-hint" style={{ marginTop: 8 }}>
              Format: PNG, JPG, SVG, atau WebP. Maks 10MB.
            </div>
            <input
              ref={logoRef}
              type="file"
              accept=".png,.jpg,.jpeg,.svg,.webp"
              style={{ display: 'none' }}
              onChange={handleLogoUpload}
            />
          </div>
        </div>

        {/* Audit Log Export */}
        <div className="card">
          <div className="card-header"><h2>Audit Log</h2></div>
          <div className="card-body">
            <p style={{ fontSize: '0.875rem', marginBottom: 12 }}>
              Export seluruh log aktivitas sistem ke file Excel.
            </p>
            <button className="btn btn-outline btn-sm" onClick={handleExportLog}>
              Export Log (.xlsx)
            </button>
          </div>
        </div>

      </div>
    </>
  )
}
