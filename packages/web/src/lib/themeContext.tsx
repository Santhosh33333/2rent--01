import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'light' | 'dark'
export type Accent = 'coral' | 'indigo' | 'emerald' | 'rose' | 'amber' | 'sky'

export const ACCENTS: { value: Accent; label: string }[] = [
  { value: 'coral', label: 'Coral' },
  { value: 'indigo', label: 'Indigo' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'rose', label: 'Rose' },
  { value: 'amber', label: 'Amber' },
  { value: 'sky', label: 'Sky' },
]

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
  accent: Accent
  setAccent: (accent: Accent) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function isAccent(value: string | null): value is Accent {
  return !!value && ACCENTS.some(a => a.value === value)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme') as Theme | null
      if (stored === 'light' || stored === 'dark') return stored
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  })

  const [accent, setAccentState] = useState<Accent>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('accent')
      if (isAccent(stored)) return stored
    }
    return 'coral'
  })

  useEffect(() => {
    const isDark = theme === 'dark'
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accent)
    localStorage.setItem('accent', accent)
  }, [accent])

  const toggleTheme = () => {
    setThemeState(prev => prev === 'dark' ? 'light' : 'dark')
  }

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme)
  }

  const setAccent = (newAccent: Accent) => {
    setAccentState(newAccent)
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
