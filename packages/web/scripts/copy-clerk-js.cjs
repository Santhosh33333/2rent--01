// Copies the self-hosted clerk-js browser bundle into public/ so
// ClerkProvider can load it via clerkJSUrl instead of the CDN, keeping
// clerk-js and @clerk/clerk-react versions in sync.
const fs = require('fs')
const path = require('path')

const src = path.join(__dirname, '..', 'node_modules', '@clerk', 'clerk-js', 'dist')
const dst = path.join(__dirname, '..', 'public', 'clerk')

if (!fs.existsSync(src)) {
  console.warn('[copy-clerk-js] @clerk/clerk-js not installed; skipping copy.')
  process.exit(0)
}

fs.rmSync(dst, { recursive: true, force: true })
fs.cpSync(src, dst, { recursive: true })
console.log('[copy-clerk-js] copied clerk-js dist -> public/clerk')
