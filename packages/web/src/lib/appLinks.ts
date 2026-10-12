/**
 * Canonical links to the Nabri mobile app.
 *
 * Nabri ships through Google Play, not as a sideloaded APK. Every "get the
 * app" surface must point at the Play testing opt-in so installs, updates and
 * integrity checks all flow through the store. The old direct-APK path
 * (`/download/nabri.apk`) and the third-party host (`yuvers.in/download`) are
 * deliberately gone.
 *
 * The closed-testing opt-in URL is used rather than the public listing: the
 * app is only in closed testing, so a non-tester following the public listing
 * link lands on a page with no install button. Testers added to the track can
 * install from this URL, and it forwards to the listing once the app is
 * promoted to production.
 */
export const PLAY_STORE_URL =
  'https://play.google.com/apps/testing/app.rentbuddy.app'

/** Short, human label for the Play listing. */
export const PLAY_STORE_LABEL = 'Google Play'
