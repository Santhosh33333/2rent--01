import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import {
  shouldShowUpdateNotice,
  markBuildSeen,
  readLastSeenBuild,
  runningBuildId,
} from '../lib/updateNotice'

/**
 * One-time "the app was updated" notice. Native builds only.
 *
 * Deliberately not shown on the website: there, the browser already reloads new
 * assets on the next navigation and the user did not ask to be told, so the
 * notice was noise. In the installed APK the old bundle persists until the user
 * updates from the store, so they need to be told when a newer build exists.
 *
 * Shows once per deployed build, then never again for that build. Recorded when
 * shown rather than when dismissed, so a stray navigation cannot bring it back.
 */
export function UpdateNotice() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    if (shouldShowUpdateNotice(readLastSeenBuild())) {
      setVisible(true)
      // Record as seen on show, not on dismiss: the user has been told, and a
      // notice that returns after a stray navigation is pure noise.
      markBuildSeen()
    }
  }, [])

  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 top-3 z-50 mx-auto max-w-sm animate-fadeIn"
    >
      <div className="flex items-start gap-3 rounded-2xl bg-primary-500 px-4 py-3 text-white shadow-lg shadow-primary-500/25">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">App updated</p>
          <p className="text-xs opacity-90">
            You&apos;re using the latest version. All new features are ready.
          </p>
          <p className="mt-1 text-[10px] opacity-70">
            build {runningBuildId()}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Dismiss update notice"
          className="rounded-lg p-1 opacity-80 transition hover:bg-white/15 hover:opacity-100"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

export default UpdateNotice
