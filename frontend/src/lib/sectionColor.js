/**
 * Returns inline style for a seat section badge based on section name/color.
 * Falls back to a neutral style for unknown sections.
 */
export function getSectionStyle(section) {
  if (!section) return {}
  const s = section.toUpperCase()

  const map = {
    BLUE:   { background: '#bee3f8', color: '#1a365d', border: '1px solid #90cdf4' },
    RED:    { background: '#fed7d7', color: '#63171b', border: '1px solid #fc8181' },
    YELLOW: { background: '#fefcbf', color: '#5f370e', border: '1px solid #f6e05e' },
    GREEN:  { background: '#c6f6d5', color: '#1c4532', border: '1px solid #68d391' },
    ORANGE: { background: '#feebc8', color: '#652b19', border: '1px solid #f6ad55' },
    PURPLE: { background: '#e9d8fd', color: '#322659', border: '1px solid #b794f4' },
    PINK:   { background: '#fed7e2', color: '#521b41', border: '1px solid #f687b3' },
    WHITE:  { background: '#f7fafc', color: '#1a202c', border: '1px solid #cbd5e0' },
    BLACK:  { background: '#1a202c', color: '#f7fafc', border: '1px solid #4a5568' },
    GOLD:   { background: '#faf089', color: '#5f370e', border: '1px solid #ecc94b' },
    SILVER: { background: '#e2e8f0', color: '#1a202c', border: '1px solid #a0aec0' },
    BROWN:  { background: '#faf0e6', color: '#4a2c0a', border: '1px solid #d69e2e' },
    GRAY:   { background: '#edf2f7', color: '#2d3748', border: '1px solid #a0aec0' },
    GREY:   { background: '#edf2f7', color: '#2d3748', border: '1px solid #a0aec0' },
  }

  // Exact match first
  if (map[s]) return map[s]

  // Partial match — e.g. "BLUE A" or "SECTION BLUE"
  for (const [key, style] of Object.entries(map)) {
    if (s.includes(key)) return style
  }

  // Fallback — generate a consistent color from section name
  const hue = [...s].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360
  return {
    background: `hsl(${hue}, 60%, 88%)`,
    color: `hsl(${hue}, 60%, 20%)`,
    border: `1px solid hsl(${hue}, 60%, 70%)`,
  }
}
