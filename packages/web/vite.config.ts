import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Capacitor WebViews can lag far behind desktop Chrome (a phone's Android
    // System WebView may be old or un-updated). es2017 keeps the bundled JS
    // parseable everywhere while Vite/esbuild downlevel optional chaining,
    // nullish coalescing and object spread into compatible code.
    target: 'es2017',
  },
  server: {
    proxy: {
      // Backend stores avatars as relative /uploads/<file> paths; without this
      // proxy the dev server would 404 them instead of forwarding to :5000.
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
})
