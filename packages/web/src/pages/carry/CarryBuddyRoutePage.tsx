import { useState, useEffect } from 'react'
import {
  Route, MapPin, Navigation, Clock, Compass,
  AlertTriangle, Truck, Locate
} from 'lucide-react'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { EmptyState } from '../../components/EmptyState'

interface RouteJob {
  _id: string
  description: string
  pickupLocation: { address: string; lat?: number; lng?: number }
  dropLocation: { address: string; lat?: number; lng?: number }
  distance: number
  price: number
  status: string
}

interface TurnStep {
  instruction: string
  distance: string
  duration: string
}

export function CarryBuddyRoutePage() {
  const [activeJob, setActiveJob] = useState<RouteJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [turns] = useState<TurnStep[]>([
    { instruction: 'Head north on Main Street', distance: '0.3 km', duration: '4 min' },
    { instruction: 'Turn right onto Park Avenue', distance: '1.2 km', duration: '15 min' },
    { instruction: 'Continue straight past City Mall', distance: '0.8 km', duration: '10 min' },
    { instruction: 'Turn left onto Lake Road', distance: '0.5 km', duration: '6 min' },
    { instruction: 'Destination will be on your right', distance: '0.1 km', duration: '2 min' },
  ])

  useEffect(() => {
    const fetchActiveJob = async () => {
      try {
        const res = await api.get('/carry-buddy/my-requests')
        const root = res.data
        const arr = Array.isArray(root) ? root : (root?.data?.items ?? root?.data ?? [])
        const data: any[] = Array.isArray(arr) ? arr : []
        const active = data.find((j: RouteJob) => j.status === 'active' || j.status === 'in_progress')
        setActiveJob(active ?? null)
      } catch {
        setError('Failed to load route')
      } finally {
        setLoading(false)
      }
    }
    fetchActiveJob()
  }, [])

  const eta = activeJob ? `${Math.ceil(activeJob.distance * 12)} min` : '—'

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48 rounded-2xl" />
        <div className="glass-card-static h-64 rounded-3xl" />
        <SkeletonLoader variant="list" lines={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><AlertTriangle className="w-10 h-10 text-danger-400" /></div>
        <h3 className="empty-state-title">Failed to load route</h3>
        <p className="empty-state-desc">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary mt-6">Retry</button>
      </div>
    )
  }

  if (!activeJob) {
    return (
      <div className="space-y-6">
        <AnimatedPage>
          <div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white flex items-center gap-2">
              <Route className="w-6 h-6 text-amber-500" />
              Route Navigator
            </h1>
            <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">Navigate your current delivery</p>
          </div>
        </AnimatedPage>
        <EmptyState
          icon={Compass}
          title="No active route"
          description="Accept a carry job to see navigation and route details here"
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white flex items-center gap-2">
            <Route className="w-6 h-6 text-amber-500" />
            Route Navigator
          </h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">Follow the route to complete your delivery</p>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-amber-100 via-orange-50 to-amber-100 dark:from-amber-900/30 dark:via-orange-900/20 dark:to-amber-900/30 h-64 sm:h-80 border border-amber-200/50 dark:border-amber-800/30">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M0%2030h60M30%200v60%22%20stroke%3D%22rgba(217%2C119%2C6%2C0.08)%22%20stroke-width%3D%221%22/%3E%3C/svg%3E')]" />
          
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center mb-4 animate-pulse">
              <MapPin className="w-8 h-8 text-amber-600 dark:text-amber-400" />
            </div>
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Interactive Map</p>
            <p className="text-xs text-amber-600/70 dark:text-amber-400/70 mt-1">Map integration will be available here</p>
          </div>

          <div className="absolute top-4 left-4 right-4 flex justify-between">
            <div className="bg-white/80 dark:bg-surface-900/80 backdrop-blur-sm rounded-xl px-3 py-2 border border-amber-200/50">
              <p className="text-[10px] text-surface-500 font-medium">FROM</p>
              <p className="text-xs font-bold text-surface-900 dark:text-white truncate max-w-[140px]">{activeJob.pickupLocation?.address}</p>
            </div>
            <div className="bg-white/80 dark:bg-surface-900/80 backdrop-blur-sm rounded-xl px-3 py-2 border border-amber-200/50">
              <p className="text-[10px] text-surface-500 font-medium">TO</p>
              <p className="text-xs font-bold text-surface-900 dark:text-white truncate max-w-[140px]">{activeJob.dropLocation?.address}</p>
            </div>
          </div>

          <div className="absolute bottom-4 left-4 right-4">
            <div className="bg-white/80 dark:bg-surface-900/80 backdrop-blur-sm rounded-xl p-3 border border-amber-200/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Locate className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-medium text-surface-600 dark:text-surface-400">Current position tracking</span>
                </div>
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </AnimatedPage>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <AnimatedPage delay={150}>
          <GlassCard variant="elevated" padding="md">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                <Navigation className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-xs text-surface-500">Distance</p>
                <p className="text-lg font-bold text-surface-900 dark:text-white">{activeJob.distance ? `${activeJob.distance.toFixed(1)} km` : '—'}</p>
              </div>
            </div>
          </GlassCard>
        </AnimatedPage>

        <AnimatedPage delay={200}>
          <GlassCard variant="elevated" padding="md">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                <Clock className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-xs text-surface-500">ETA</p>
                <p className="text-lg font-bold text-surface-900 dark:text-white">{eta}</p>
              </div>
            </div>
          </GlassCard>
        </AnimatedPage>

        <AnimatedPage delay={250}>
          <GlassCard variant="elevated" padding="md">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
                <Truck className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-xs text-surface-500">Payout</p>
                <p className="text-lg font-bold text-amber-600 dark:text-amber-400">₹{activeJob.price}</p>
              </div>
            </div>
          </GlassCard>
        </AnimatedPage>
      </div>

      <AnimatedPage delay={300}>
        <GlassCard variant="elevated" padding="lg">
          <h2 className="section-title flex items-center gap-2 mb-4">
            <Route className="w-5 h-5 text-amber-500" />
            Turn-by-Turn Directions
          </h2>
          <div className="space-y-0">
            {turns.map((step, idx) => (
              <div key={idx} className="flex items-start gap-4 group">
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    idx === 0
                      ? 'bg-amber-500 text-white'
                      : idx === turns.length - 1
                      ? 'bg-rose-500 text-white'
                      : 'bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-400'
                  }`}>
                    {idx === 0 ? <Navigation className="w-3.5 h-3.5" /> : idx === turns.length - 1 ? <MapPin className="w-3.5 h-3.5" /> : idx + 1}
                  </div>
                  {idx < turns.length - 1 && (
                    <div className="w-0.5 h-8 bg-surface-200 dark:bg-surface-700 my-1" />
                  )}
                </div>
                <div className="flex-1 pb-4">
                  <p className="text-sm font-semibold text-surface-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">{step.instruction}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-surface-500 dark:text-surface-400">{step.distance}</span>
                    <span className="text-xs text-surface-400">·</span>
                    <span className="text-xs text-surface-500 dark:text-surface-400">{step.duration}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}
