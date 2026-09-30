/**
 * "The app was updated" notice.
 *
 * Requirement: tell a user their app was updated, then never bring it up again
 * for that same version. The "never again" part is the whole difficulty - a
 * notice that reappears on every page load becomes something users learn to
 * dismiss without reading, which is worse than not showing it.
 *
 * Pure functions over an injected last-seen value rather than reading
 * localStorage directly, so the decision table can be asserted. Storage is
 * best-effort: a user whose storage is full, blocked, or cleared gets the
 * notice once more, which is an acceptable failure. Refusing to show it would
 * be the wrong way round.
 */

/** Injected by vite at build time. Missing only in a broken toolchain. */
function currentBuildId(): string {
  if (typeof __BUILD_ID__ === 'string' && __BUILD_ID__) return __BUILD_ID__
  return 'unknown-build'
}

const STORAGE_KEY = 'nabri_seen_build'

/**
 * Whether to show the update notice for the running build.
 *
 * Returns true when the stored id differs from this build, which covers both
 * "first ever load" (nothing stored) and "a new version was deployed".
 * A brand-new user sees it once too: for them the first launch is the update.
 */
export function shouldShowUpdateNotice(lastSeenBuild: string | null): boolean {
  if (!lastSeenBuild) return true
  return lastSeenBuild !== currentBuildId()
}

/** Marks the running build as seen. Returns false if storage refused. */
export function markBuildSeen(): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, currentBuildId())
    return true
  } catch {
    // Private browsing, quota, or storage disabled. The notice will show again
    // next load, which is tolerable; breaking the app here is not.
    return false
  }
}

export function readLastSeenBuild(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** For tests and for the banner's own copy. */
export function runningBuildId(): string {
  return currentBuildId()
}
