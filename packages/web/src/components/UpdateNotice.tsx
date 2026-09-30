import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import {
  shouldShowUpdateNotice,
  markBuildSeen,
  readLastSeenBuild,
  runningBuildId,
} from '../lib/updateNotice'

/**
 * One-time "the app was updated" notice.
 *
 * Shows once per deployed build, then never again for that build. Dismissal is
 * recorded immediately rather than on click, so the notice cannot reappear
 * because the user navigated away or the component remounted - which is the
 * failure mode that makes people learn to ignore these.
 */
export function UpdateNotice() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
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
            You&apos;re on the latest version. Reload to get any fixes.
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
