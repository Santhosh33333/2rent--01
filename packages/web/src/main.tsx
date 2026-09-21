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
  const isChunkError = (message: string) =>
    /failed to fetch dynamically imported module|loading chunk|chunkloaderror/i.test(message)
  const reloadOnce = () => {
    try {
      if (sessionStorage.getItem(FLAG)) return
      sessionStorage.setItem(FLAG, '1')
    } catch {
      return
    }
    window.location.reload()
  }
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

// Clear the reload flag on every successful boot so the NEXT stale deploy
// can still self-heal exactly once.
try {
  sessionStorage.removeItem('Sidebud-chunk-reloaded')
} catch {
  // storage unavailable — recovery simply stays armed
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