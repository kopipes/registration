/**
 * Reusable pagination component.
 * Props:
 *   total    — total records
 *   page     — current page (1-indexed)
 *   pageSize — records per page
 *   onChange — (newPage) => void
 */
export default function Pagination({ total, page, pageSize, onChange }) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null

  const start = (page - 1) * pageSize + 1
  const end   = Math.min(page * pageSize, total)

  // Build page window: always show first, last, current ±2
  const pages = []
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
      pages.push(i)
    }
  }
  // Insert ellipsis markers
  const withGaps = []
  let prev = 0
  for (const p of pages) {
    if (p - prev > 1) withGaps.push('...')
    withGaps.push(p)
    prev = p
  }

  return (
    <div className="pagination">
      <span className="pagination-info">{start}–{end} dari {total}</span>
      <div className="pagination-controls">
        <button
          className="btn btn-outline btn-sm btn-icon"
          onClick={() => onChange(page - 1)}
          disabled={page === 1}
          aria-label="Halaman sebelumnya"
        >‹</button>

        {withGaps.map((p, i) =>
          p === '...'
            ? <span key={`gap-${i}`} className="pagination-gap">…</span>
            : <button
                key={p}
                className={`btn btn-sm btn-icon ${p === page ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => onChange(p)}
                aria-current={p === page ? 'page' : undefined}
              >{p}</button>
        )}

        <button
          className="btn btn-outline btn-sm btn-icon"
          onClick={() => onChange(page + 1)}
          disabled={page === totalPages}
          aria-label="Halaman berikutnya"
        >›</button>
      </div>
    </div>
  )
}
