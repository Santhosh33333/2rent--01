import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { RoleProvider } from './lib/roleContext'
import { AppClerkProvider } from './lib/clerkAuth'
import { App } from './App'
import './styles/globals.css'

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