/**
 * Canonical links to the Nabri mobile app.
 *
 * Nabri ships through Google Play, not as a sideloaded APK. Every "get the
 * app" surface must point at the Play listing so installs, updates and
 * integrity checks all flow through the store. The old direct-APK path
 * (`/download/nabri.apk`) and the third-party host (`yuvers.in/download`) are
 * deliberately gone.
 */
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=app.rentbuddy.app'

/** Short, human label for the Play listing. */
export const PLAY_STORE_LABEL = 'Google Play'
