import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = dirname(fileURLToPath(import.meta.url))

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

// Nabri ships only through Google Play. The web app no longer serves a
// sideloaded APK, so there is no copy-apk build step and no __APK_* globals:
// every "get the app" surface links to the canonical Play listing via
// `src/lib/appLinks.ts` (PLAY_STORE_URL). Sideloaded builds bypass Play's
// integrity checks and cannot auto-update, so continuing to hand out an APK
// was a support and security liability rather than a feature.
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(resolveBuildId()),
  },
  build: {
    // Capacitor WebViews can lag far behind desktop Chrome (a phone's Android
    // System WebView may be old or un-updated). es2017 keeps the bundled JS
    // parseable everywhere while Vite/esbuild downlevels optional chaining,
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
