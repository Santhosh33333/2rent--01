import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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

/**
 * A build identifier baked into the bundle at compile time.
 *
 * Used to tell users their app was just updated, exactly once per deployment.
 * Deliberately derived from the git commit rather than a hand-maintained
 * version string in package.json: that field changes when someone remembers to
 * bump it, which is not often enough to be a reliable signal, and bumping it
 * without shipping a change would show users a "what's new" for nothing.
 *
 * Falls back to a timestamp when git is unavailable (a source archive with no
 * .git, a detached deploy), so the build never fails over cosmetics.
 */
function resolveBuildId(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: webRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (sha) return sha
  } catch {
    // No git, or not a repository. Fall through.
  }
  return `build-${Date.now()}`
}

export default defineConfig({
  plugins: [react(), apkPlugin],
  define: {
    __BUILD_ID__: JSON.stringify(resolveBuildId()),
  },
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
