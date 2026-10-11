// Single source of truth for the backend origin.
//
// `VITE_API_BASE_URL` is normally read from `.env.production` at build time.
// That file is not guaranteed to be present in every build environment (a CI
// or Vercel build that does not load it, a fresh clone, a release built on a
// machine without it). The previous fallback was `http://localhost:5000`, so a
// build without the env file shipped a bundle that pointed every request at the
// user's own device - the deployed web app could not even log in. Fall back to
// the real API for production builds, and only to localhost while developing.
const PROD_API_BASE_URL = 'https://rentbuddy-api-s7rz.onrender.com/api'
const DEV_API_BASE_URL = 'http://localhost:5000/api'

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  (import.meta.env.PROD ? PROD_API_BASE_URL : DEV_API_BASE_URL)

/** The API origin without the trailing `/api` (used for socket.io and media). */
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '')
