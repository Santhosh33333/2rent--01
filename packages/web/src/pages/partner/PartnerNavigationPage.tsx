import { useState, useEffect } from 'react'
import {
  Navigation, MapPin, Compass, Locate, ArrowUp,
  ChevronRight, Footprints
} from 'lucide-react'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { SkeletonLoader } from '../../components/SkeletonLoader'

interface ActiveJob {
  id: string
  type: string
  startLocation: string
  endLocation: string
  startTime: string
  fare: number
  status: string
}

interface LocationInfo {
  lat: number
  lng: number
  address: string
}

export function PartnerNavigationPage() {
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null)
  const [location, setLocation] = useState<LocationInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [jobRes] = await Promise.allSettled([
          api.get('/walking-requests'),
          Promise.resolve(null),
        ])
        if (jobRes.status === 'fulfilled') {
          const raw = jobRes.value.data?.data || jobRes.value.data || []
          const arr: ActiveJob[] = Array.isArray(raw) ? raw : (raw.items || [])
          const active = arr.find((j) => j.status === 'ACCEPTED' || j.status === 'IN_PROGRESS')
          if (active) setActiveJob({ ...active, fare: Number(active.fare ?? 0) })
        }
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              setLocation({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                address: 'Current Location',
              })
            },
            () => {
              setLocation({ lat: 0, lng: 0, address: 'Location unavailable' })
            }
          )
        }
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48 rounded-2xl" />
        <div className="skeleton h-64 rounded-3xl" />
        <SkeletonLoader variant="card" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-surface-900 dark:text-white flex items-center gap-3">
            <Navigation className="w-7 h-7 text-sky-500" />
            Navigation
          </h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">Live map and directions</p>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={50}>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-100 via-sky-50 to-blue-100 dark:from-sky-900/30 dark:via-sky-800/20 dark:to-blue-900/30 p-8 sm:p-12 border border-sky-200/50 dark:border-sky-700/30">
          <div className="absolute inset-0 opacity-20">
            <svg className="w-full h-full" viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-sky-300 dark:text-sky-600" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
              <circle cx="200" cy="150" r="4" fill="#0ea5e9" />
              <circle cx="200" cy="150" r="12" fill="none" stroke="#0ea5e9" strokeWidth="1" opacity="0.4" />
              <circle cx="200" cy="150" r="20" fill="none" stroke="#0ea5e9" strokeWidth="0.5" opacity="0.2" />
              <circle cx="500" cy="250" r="4" fill="#22c55e" />
              <circle cx="500" cy="250" r="12" fill="none" stroke="#22c55e" strokeWidth="1" opacity="0.4" />
              <path d="M200,150 C250,100 350,300 500,250" fill="none" stroke="#0ea5e9" strokeWidth="2" strokeDasharray="8,4" opacity="0.6" />
            </svg>
          </div>
          <div className="relative z-10 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-sky-500/20 flex items-center justify-center mb-4">
              <Compass className="w-8 h-8 text-sky-500" />
            </div>
            <h2 className="text-xl font-bold font-display text-sky-800 dark:text-sky-200 mb-2">Map Integration Coming Soon</h2>
            <p className="text-sm text-sky-600/70 dark:text-sky-300/60 max-w-md mx-auto">
              Interactive maps with turn-by-turn navigation will be available in the next update.
              For now, use your preferred maps app.
            </p>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center">
              <Locate className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            </div>
            <h3 className="font-bold font-display text-surface-900 dark:text-surface-100">Current Location</h3>
          </div>
          {location ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                <MapPin className="w-4 h-4 text-sky-500" />
                <span className="text-sm text-surface-700 dark:text-surface-300">{location.address}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                  <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Latitude</p>
                  <p className="text-sm font-mono font-medium text-surface-900 dark:text-white">{location.lat.toFixed(6)}</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                  <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Longitude</p>
                  <p className="text-sm font-mono font-medium text-surface-900 dark:text-white">{location.lng.toFixed(6)}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-surface-500">Location not available</p>
          )}
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={150}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Footprints className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 className="font-bold font-display text-surface-900 dark:text-surface-100">Active Job</h3>
          </div>
          {activeJob ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                <MapPin className="w-4 h-4 text-emerald-500" />
                <div>
                  <p className="text-xs text-surface-500">Pickup</p>
                  <p className="text-sm font-medium text-surface-900 dark:text-white">{activeJob.startLocation}</p>
                </div>
              </div>
              <div className="flex justify-center">
                <div className="w-px h-4 bg-surface-300 dark:bg-surface-600" />
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                <MapPin className="w-4 h-4 text-red-500" />
                <div>
                  <p className="text-xs text-surface-500">Drop</p>
                  <p className="text-sm font-medium text-surface-900 dark:text-white">{activeJob.endLocation}</p>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200/50 dark:border-emerald-800/30">
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Estimated Earning</span>
                <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">₹{activeJob.fare}</span>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <Footprints className="w-10 h-10 text-surface-300 dark:text-surface-600 mx-auto mb-3" />
              <p className="text-sm text-surface-500">No active job. Accept one from the jobs page.</p>
            </div>
          )}
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={200}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Navigation className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <h3 className="font-bold font-display text-surface-900 dark:text-surface-100">Navigation Instructions</h3>
          </div>
          <div className="space-y-2">
            {[
              { step: 1, text: 'Head towards the pickup location', icon: ArrowUp },
              { step: 2, text: 'Arrive at pickup and confirm with user', icon: MapPin },
              { step: 3, text: 'Walk the user to the destination', icon: Navigation },
              { step: 4, text: 'Complete the walk and rate the user', icon: ChevronRight },
            ].map((item) => (
              <div key={item.step} className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400">{item.step}</span>
                </div>
                <p className="text-sm text-surface-700 dark:text-surface-300">{item.text}</p>
              </div>
            ))}
          </div>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}
