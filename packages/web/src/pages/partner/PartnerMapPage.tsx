import { useState, useEffect } from 'react'
import {
  Navigation, List, Loader2, Footprints, Package, User, MapPin
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { LiveMap, MapPoint } from '../../components/LiveMap'

interface NearbyBooking {
  id: string
  serviceType: string
  startLocation: string
  endLocation?: string
  partnerEarning?: number
  user?: { fullName?: string }
}

export function PartnerMapPage() {
  const [view, setView] = useState<'map' | 'list'>('map')
  const [nearby, setNearby] = useState<NearbyBooking[]>([])
  const [myLoc, setMyLoc] = useState<MapPoint | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchNearby = async () => {
      try {
        const res = await api.get('/partner/nearby-bookings')
        const raw = res.data?.data || res.data || []
        setNearby(Array.isArray(raw) ? raw : [])
      } catch {
        toast.error('Failed to load nearby requests')
      } finally {
        setLoading(false)
      }
    }
    fetchNearby()
    const interval = setInterval(fetchNearby, 30000)
    return () => clearInterval(interval)
  }, [])

  // The partner's own last-known real GPS (from the location sharer).
  useEffect(() => {
    const fetchMine = async () => {
      try {
        const res = await api.get('/partner/location')
        const loc = res.data?.data || res.data
        if (loc && Number.isFinite(loc.latitude)) {
          setMyLoc({ lat: loc.latitude, lng: loc.longitude })
        }
      } catch {
        // not shared yet — map simply shows no self marker
      }
    }
    fetchMine()
    const interval = setInterval(fetchMine, 15000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold font-display text-surface-900 dark:text-white flex items-center gap-3">
              <Navigation className="w-7 h-7 text-emerald-500" />
              Map
            </h1>
            <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">Nearby booking requests</p>
          </div>
          <div className="flex bg-surface-100 dark:bg-surface-800 rounded-xl p-1">
            <button onClick={() => setView('map')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === 'map' ? 'bg-white dark:bg-surface-700 shadow text-surface-900 dark:text-white' : 'text-surface-500'}`}>
              <Navigation className="w-4 h-4" />
            </button>
            <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === 'list' ? 'bg-white dark:bg-surface-700 shadow text-surface-900 dark:text-white' : 'text-surface-500'}`}>
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </AnimatedPage>

      {view === 'map' ? (
        <AnimatedPage delay={100}>
          <div className="relative h-[60vh] rounded-3xl overflow-hidden border border-surface-200 dark:border-surface-700">
            <LiveMap user={myLoc} height="100%" />
            <div className="absolute top-3 left-3 right-3 z-[500] pointer-events-none">
              <div className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-xl p-3 text-xs text-surface-600 dark:text-surface-300 shadow-lg flex items-start gap-2">
                <MapPin className="w-4 h-4 text-sky-500 flex-shrink-0 mt-0.5" />
                <span>Shows your real last-known position. Requester exact locations stay hidden until you're assigned to a booking (privacy).</span>
              </div>
            </div>
            {!myLoc && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-sm text-surface-500 dark:text-surface-400">Enable location sharing to see yourself on the map.</p>
              </div>
            )}
          </div>
        </AnimatedPage>
      ) : (
        <AnimatedPage delay={100}>
          <div className="space-y-3">
            {nearby.map((booking) => (
              <GlassCard key={booking.id} variant="elevated" padding="sm">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-md flex-shrink-0 ${
                    booking.serviceType === 'WALKING' ? 'bg-gradient-to-br from-emerald-500 to-emerald-600' : 'bg-gradient-to-br from-amber-500 to-orange-600'
                  }`}>
                    {booking.serviceType === 'WALKING' ? <Footprints className="w-4 h-4 text-white" /> : <Package className="w-4 h-4 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">{booking.startLocation}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-surface-500">{booking.serviceType === 'WALKING' ? 'Walking' : 'Carry'}</span>
                      {booking.user?.fullName && <span className="text-xs text-surface-400 flex items-center gap-1"><User className="w-3 h-3" /> {booking.user.fullName}</span>}
                    </div>
                  </div>
                  {booking.partnerEarning !== undefined && (
                    <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">₹{booking.partnerEarning}</span>
                  )}
                </div>
              </GlassCard>
            ))}
          </div>
        </AnimatedPage>
      )}

      <AnimatedPage delay={200}>
        <div className="sticky bottom-24 md:bottom-8 z-30">
          <GlassCard variant="elevated" padding="sm" className="bg-emerald-600 text-white border-0">
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-sm font-semibold">{nearby.length} nearby request{nearby.length !== 1 ? 's' : ''}</span>
              <button onClick={() => setView(view === 'map' ? 'list' : 'map')} className="text-xs font-medium text-white/80 hover:text-white">
                {view === 'map' ? 'View List' : 'View Map'}
              </button>
            </div>
          </GlassCard>
        </div>
      </AnimatedPage>
    </div>
  )
}
