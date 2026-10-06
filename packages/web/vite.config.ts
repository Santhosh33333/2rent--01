import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = dirname(fileURLToPath(import.meta.url))

// The installable APK must reach the browser, but bundling it inside the built
// web assets makes every subsequent APK embed the previous one (sizes balloon
// each rebuild). Copy it into dist only at the end of a build instead.
const apkSource = resolve(webRoot, 'apk/nabri.apk')

// Read at config time so the bundle can be told the truth about whether a
// download will actually be there. `*.apk` is gitignored, so a fresh clone —
// and every CI/Vercel deploy — never has this file unless someone puts it
// there first.
const apkStats = existsSync(apkSource) ? statSync(apkSource) : null
const apkAvailable = apkStats !== null
// Rounded to 1dp so the page can show a real figure instead of a guess.
const apkSizeMb = apkStats ? Math.round((apkStats.size / (1024 * 1024)) * 10) / 10 : null

const apkPlugin = {
  name: 'copy-apk',
  closeBundle() {
    if (!existsSync(apkSource)) {
      // Loud on purpose. The previous version returned quietly, which is how
      // the landing page's primary CTA shipped pointing at a 404: the build
      // stayed green while the file it was for was never there. The UI now
      // reads __APK_AVAILABLE__ and says NOT CONFIGURED instead of linking
      // to nothing.
      console.warn(
        [
          '',
          '[copy-apk] WARNING: packages/web/apk/nabri.apk was not found.',
          '  /download/nabri.apk will NOT be served by this deploy.',
          '  The site will render "NOT CONFIGURED" instead of a dead download link.',
          '  To enable downloads, place an APK at packages/web/apk/nabri.apk before building',
          '  (it is gitignored, so it must be supplied by the build environment).',
          '',
        ].join('\n'),
      )
      return
    }
    const to = resolve(webRoot, 'dist/download/nabri.apk')
    mkdirSync(resolve(webRoot, 'dist/download'), { recursive: true })
    copyFileSync(apkSource, to)
    console.log(`[copy-apk] apk/nabri.apk -> dist/download/nabri.apk (${apkSizeMb} MB)`)
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
    // Whether the download the page advertises actually exists on this deploy.
    __APK_AVAILABLE__: JSON.stringify(apkAvailable),
    // Real size of the APK being shipped, or null when there isn't one. The
    // page used to hardcode a figure that did not match the file.
    __APK_SIZE_MB__: JSON.stringify(apkSizeMb),
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
