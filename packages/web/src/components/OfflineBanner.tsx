import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

/**
 * Connectivity banner: shows when the browser reports offline, hides on
 * reconnect. Financial/booking actions stay disabled by their own forms —
 * this banner only informs, never blocks.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  )

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  if (online) return null
  return (
    <div
      role="alert"
      className="sticky top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-xs font-semibold text-white"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      You're offline — showing last loaded data. Changes will sync when you reconnect.
    </div>
  )
}
