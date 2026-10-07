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
//
// Source resolution:
//   1. The conventional path packages/web/apk/nabri.apk (what a build env that
//      has the binary installed / copied in would use).
//   2. The Capacitor release output when it exists locally — this repo's own
//      signed app, so `vite build` on a dev machine ships the real APK without
//      requiring anyone to copy a 24 MB binary around.
// `*.apk` is gitignored, so a fresh clone — and every CI/Vercel deploy without
// the file — never has either and gets the loud warning + NOT CONFIGURED UI.
const apkCandidates = [
  resolve(webRoot, 'apk/nabri.apk'),
  resolve(webRoot, 'android/app/build/outputs/apk/release/app-release.apk'),
]
const apkSource = apkCandidates.find((p) => existsSync(p)) ?? apkCandidates[0]

// Read at config time so the bundle can be told the truth about whether a
// download will actually be there when the page renders.
const apkStats = existsSync(apkSource) ? statSync(apkSource) : null
// A 24 MB binary that is gitignored cannot reach a fresh CI checkout, so this
// deploy can also point at a URL the operator hosts elsewhere (a GitHub
// Release, a CDN, an object store). Set NABRI_APK_URL in the build env and the
// download page links out to it instead of 404ing on /download/nabri.apk.
const apkUrlExternal = (process.env.NABRI_APK_URL || '').trim() || null
const apkAvailable = apkStats !== null || apkUrlExternal !== null
// Rounded to 1dp so the page can show a real figure instead of a guess.
// Only known for a locally-attached file; an external URL has an unknown size.
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
      if (apkUrlExternal) {
        console.log(
          `[copy-apk] no local APK, but NABRI_APK_URL is set; downloads will link to ${apkUrlExternal}`,
        )
        return
      }
      console.warn(
        [
          '',
          '[copy-apk] WARNING: no APK found to ship.',
          '  Checked: packages/web/apk/nabri.apk and',
          '           packages/web/android/app/build/outputs/apk/release/app-release.apk',
          '  /download/nabri.apk will NOT be served by this deploy.',
          '  The site will render "NOT CONFIGURED" instead of a dead download link.',
          '  To enable downloads, run the Capacitor build (yarn android:release) or',
          '  place an APK at packages/web/apk/nabri.apk before building — both are',
          '  gitignored, so they must be present in the build environment.',
          '  Alternative: host the APK anywhere public and set NABRI_APK_URL so the',
          '  site links out to it (works on CI where the binary never exists).',
          '',
        ].join('\n'),
      )
      return
    }
    const to = resolve(webRoot, 'dist/download/nabri.apk')
    mkdirSync(resolve(webRoot, 'dist/download'), { recursive: true })
    copyFileSync(apkSource, to)
    console.log(`[copy-apk] ${apkSource.replace(webRoot + '/', '')} -> dist/download/nabri.apk (${apkSizeMb} MB)`)
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
    // Whether the download the page advertises actually exists on this deploy:
    // a real file shipped into dist/download, OR an externally-hosted URL set
    // via NABRI_APK_URL.
    __APK_AVAILABLE__: JSON.stringify(apkAvailable),
    // Real size of the APK being shipped, or null when there isn't one. The
    // page used to hardcode a figure that did not match the file.
    __APK_SIZE_MB__: JSON.stringify(apkSizeMb),
    // External download URL (NABRI_APK_URL) or "" when the build ships its own.
    __APK_URL__: JSON.stringify(apkUrlExternal || ''),
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
