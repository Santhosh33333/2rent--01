import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = dirname(fileURLToPath(import.meta.url))

// The installable APK must reach the browser, but bundling it inside the built
// web assets makes every subsequent APK embed the previous one (sizes balloon
// each rebuild). Copy it into dist only at the end of a build instead.
const apkPlugin = {
  name: 'copy-apk',
  closeBundle() {
    const from = resolve(webRoot, 'apk/nabri.apk')
    if (!existsSync(from)) return
    const to = resolve(webRoot, 'dist/download/nabri.apk')
    mkdirSync(resolve(webRoot, 'dist/download'), { recursive: true })
    copyFileSync(from, to)
  },
}

export default defineConfig({
  plugins: [react(), apkPlugin],
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
