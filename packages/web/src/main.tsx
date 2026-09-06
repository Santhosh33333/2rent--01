import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { RoleProvider } from './lib/roleContext'
import { AppClerkProvider } from './lib/clerkAuth'
import { App } from './App'
import './styles/globals.css'

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