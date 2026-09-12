import { createContext, useContext, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import { useProject } from './ProjectContext'

// Each theme overrides ALL relevant CSS variables
export const THEMES = {
  navy: { name: 'Navy Blue', preview: '#1e3a5f', dark: true, vars: {
    '--primary': '#1e3a5f', '--primary-light': '#2c5282', '--primary-dark': '#152a44', '--accent': '#3182ce',
    '--bg': '#f7fafc', '--surface': '#ffffff', '--border': '#e2e8f0', '--text': '#1a202c', '--text-muted': '#718096',
  }},
  forest: { name: 'Forest Green', preview: '#1a4731', dark: true, vars: {
    '--primary': '#1a4731', '--primary-light': '#276749', '--primary-dark': '#10302a', '--accent': '#38a169',
    '--bg': '#f0fff4', '--surface': '#ffffff', '--border': '#c6f6d5', '--text': '#1a202c', '--text-muted': '#4a5568',
  }},
  maroon: { name: 'Maroon Red', preview: '#6b1e1e', dark: true, vars: {
    '--primary': '#6b1e1e', '--primary-light': '#9b2c2c', '--primary-dark': '#4a1212', '--accent': '#e53e3e',
    '--bg': '#fff5f5', '--surface': '#ffffff', '--border': '#fed7d7', '--text': '#1a202c', '--text-muted': '#4a5568',
  }},
  purple: { name: 'Royal Purple', preview: '#44337a', dark: true, vars: {
    '--primary': '#44337a', '--primary-light': '#553c9a', '--primary-dark': '#322659', '--accent': '#805ad5',
    '--bg': '#faf5ff', '--surface': '#ffffff', '--border': '#e9d8fd', '--text': '#1a202c', '--text-muted': '#4a5568',
  }},
  teal: { name: 'Teal', preview: '#1d4f54', dark: true, vars: {
    '--primary': '#1d4f54', '--primary-light': '#2c7a7b', '--primary-dark': '#0f3235', '--accent': '#319795',
    '--bg': '#e6fffa', '--surface': '#ffffff', '--border': '#b2f5ea', '--text': '#1a202c', '--text-muted': '#4a5568',
  }},
  orange: { name: 'Burnt Orange', preview: '#7b341e', dark: true, vars: {
    '--primary': '#7b341e', '--primary-light': '#c05621', '--primary-dark': '#4a1a0a', '--accent': '#ed8936',
    '--bg': '#fffaf0', '--surface': '#ffffff', '--border': '#feebc8', '--text': '#1a202c', '--text-muted': '#4a5568',
  }},
  slate: { name: 'Slate', preview: '#2d3748', dark: true, vars: {
    '--primary': '#2d3748', '--primary-light': '#4a5568', '--primary-dark': '#1a202c', '--accent': '#667eea',
    '--bg': '#f7fafc', '--surface': '#ffffff', '--border': '#e2e8f0', '--text': '#1a202c', '--text-muted': '#718096',
  }},
  charcoal: { name: 'Charcoal', preview: '#1a1a2e', dark: true, vars: {
    '--primary': '#1a1a2e', '--primary-light': '#16213e', '--primary-dark': '#0f0f1a', '--accent': '#e94560',
    '--bg': '#f7fafc', '--surface': '#ffffff', '--border': '#e2e8f0', '--text': '#1a202c', '--text-muted': '#718096',
  }},
  sky: { name: 'Sky Blue', preview: '#3b82f6', dark: false, vars: {
    '--primary': '#3b82f6', '--primary-light': '#60a5fa', '--primary-dark': '#2563eb', '--accent': '#0ea5e9',
    '--bg': '#f0f9ff', '--surface': '#ffffff', '--border': '#bae6fd', '--text': '#0c4a6e', '--text-muted': '#0369a1',
  }},
  mint: { name: 'Mint Green', preview: '#10b981', dark: false, vars: {
    '--primary': '#10b981', '--primary-light': '#34d399', '--primary-dark': '#059669', '--accent': '#06b6d4',
    '--bg': '#ecfdf5', '--surface': '#ffffff', '--border': '#a7f3d0', '--text': '#064e3b', '--text-muted': '#065f46',
  }},
  rose: { name: 'Rose Pink', preview: '#f43f5e', dark: false, vars: {
    '--primary': '#f43f5e', '--primary-light': '#fb7185', '--primary-dark': '#e11d48', '--accent': '#ec4899',
    '--bg': '#fff1f2', '--surface': '#ffffff', '--border': '#fecdd3', '--text': '#4c0519', '--text-muted': '#9f1239',
  }},
  amber: { name: 'Amber', preview: '#f59e0b', dark: false, vars: {
    '--primary': '#d97706', '--primary-light': '#f59e0b', '--primary-dark': '#b45309', '--accent': '#f97316',
    '--bg': '#fffbeb', '--surface': '#ffffff', '--border': '#fde68a', '--text': '#451a03', '--text-muted': '#92400e',
  }},
  violet: { name: 'Violet', preview: '#7c3aed', dark: false, vars: {
    '--primary': '#7c3aed', '--primary-light': '#8b5cf6', '--primary-dark': '#6d28d9', '--accent': '#a78bfa',
    '--bg': '#f5f3ff', '--surface': '#ffffff', '--border': '#ddd6fe', '--text': '#2e1065', '--text-muted': '#5b21b6',
  }},
  sand: { name: 'Sand', preview: '#a16207', dark: false, vars: {
    '--primary': '#a16207', '--primary-light': '#ca8a04', '--primary-dark': '#854d0e', '--accent': '#d97706',
    '--bg': '#fefce8', '--surface': '#ffffff', '--border': '#fef08a', '--text': '#422006', '--text-muted': '#713f12',
  }},
}

const ThemeContext = createContext(null)
const STORAGE_KEY = 'app_theme'

export function applyTheme(themeKey) {
  const theme = THEMES[themeKey] || THEMES.navy
  const root = document.documentElement
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v))
  try { localStorage.setItem(STORAGE_KEY, themeKey) } catch { /* ignore */ }
}

;(function initTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && THEMES[stored]) applyTheme(stored)
  } catch { /* ignore */ }
})()

export function ThemeProvider({ children }) {
  const qc = useQueryClient()
  const { activeProject } = useProject()

  const currentTheme = activeProject?.theme || localStorage.getItem(STORAGE_KEY) || 'navy'

  useEffect(() => {
    applyTheme(currentTheme)
  }, [currentTheme])

  const setThemeMutation = useMutation({
    mutationFn: ({ projectId, theme }) => api.put(`/projects/${projectId}/settings`, { theme }),
    onMutate: ({ theme }) => { applyTheme(theme) },
    onError: () => { applyTheme(currentTheme) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }) },
  })

  function setTheme(themeKey) {
    if (activeProject?.id) {
      setThemeMutation.mutate({ projectId: activeProject.id, theme: themeKey })
    } else {
      applyTheme(themeKey)
    }
  }

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
