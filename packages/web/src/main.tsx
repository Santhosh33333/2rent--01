import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { RoleProvider } from './lib/roleContext'
import { AppClerkProvider } from './lib/clerkAuth'
import { App } from './App'
import './styles/globals.css'

// Self-heal stale deploys: after a redeploy, a cached index.html can point
// at chunk files the server no longer has ("Failed to fetch dynamically
// imported module"). Reload once to fetch the fresh bundle instead of
// showing a broken page. The session flag prevents reload loops.
function armStaleChunkRecovery() {
  const FLAG = 'Sidebud-chunk-reloaded'
  const STABLE_BOOT_MS = 30_000
  const isChunkError = (message: string) =>
    /failed to fetch dynamically imported module|loading chunk|chunkloaderror/i.test(message)
  const reloadOnce = () => {
    try {
      const lastRecovery = Number(sessionStorage.getItem(FLAG))
      if (Number.isFinite(lastRecovery) && Date.now() - lastRecovery < STABLE_BOOT_MS) return
      sessionStorage.setItem(FLAG, String(Date.now()))
    } catch {
      return
    }
    window.location.reload()
  }
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    reloadOnce()
  })
  window.addEventListener(
    'error',
    (event) => {
      if (isChunkError(String((event as ErrorEvent).message || ''))) reloadOnce()
    },
    true
  )
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message =
      typeof reason === 'string' ? reason : String(reason?.message || reason || '')
    if (isChunkError(message)) reloadOnce()
  })
}

armStaleChunkRecovery()

// Only clear the recovery guard after the app has stayed up long enough for
// route-level lazy imports to settle. Clearing it during startup can loop.
try {
  const FLAG = 'Sidebud-chunk-reloaded'
  const lastRecovery = Number(sessionStorage.getItem(FLAG))
  if (Number.isFinite(lastRecovery)) {
    const remaining = 30_000 - (Date.now() - lastRecovery)
    if (remaining <= 0) sessionStorage.removeItem(FLAG)
    else window.setTimeout(() => sessionStorage.removeItem(FLAG), remaining)
  }
} catch {
  // storage unavailable — recovery remains disabled rather than looping
}

// Apply the user's saved font-size preference before first paint so the
// whole app (not just Settings) renders at their chosen scale.
const savedFontSize = localStorage.getItem('Sidebud-font-size')
if (savedFontSize === 'small' || savedFontSize === 'large') {
  document.documentElement.dataset.fontSize = savedFontSize
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppClerkProvider>
          <RoleProvider>
            <App />
          </RoleProvider>
        </AppClerkProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
