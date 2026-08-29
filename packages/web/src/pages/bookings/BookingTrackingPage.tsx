import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Navigation, Phone, XCircle, AlertTriangle, Loader2, MapPin, Clock, Star, MessageCircle, Siren
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api, assetUrl } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { useBookingTracking } from '../../hooks/useSocket'
import { GlassCard } from '../../components/GlassCard'
import { LiveMap, MapPoint } from '../../components/LiveMap'

interface Booking {
  id: string
  serviceType: string
  startLocation: string
  endLocation?: string
  status: string
  partnerId?: string
  user?: {
    fullName: string
    phone: string
    avatarUrl?: string
  }
  partner?: {
    user: {
      fullName: string
      phone: string
      avatarUrl?: string
    }
    averageRating?: number
  }
  estimatedAmount?: number
  scheduledAt: string
}

interface LocationData {
  latitude: number
  longitude: number
  speed?: number
  heading?: number
}

export function BookingTrackingPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null)
  const [trail, setTrail] = useState<{ lat: number; lng: number }[]>([]);
  const [eta, setETA] = useState<{ minutes: number; distance: number } | null>(null)
  const [userGeo, setUserGeo] = useState<MapPoint | null>(null)
  const [sosAlert, setSosAlert] = useState<{ message: string; timestamp: number } | null>(null)

  // WebSocket tracking
  const { listenToLocationUpdates, listenToETAUpdates, requestETA, sendSOS, listenToSOSAlerts } =
    useBookingTracking(id || '')

  useEffect(() => {
    if (!id) return
    const fetchBooking = async () => {
      try {
        const res = await api.get(`/bookings/${id}`)
        const data = res.data?.data || res.data
        setBooking(data)
        // Seed the map with the partner's last-known real GPS immediately.
        if (data?.partnerLocation && Number.isFinite(data.partnerLocation.latitude)) {
          const seed = {
            latitude: data.partnerLocation.latitude,
            longitude: data.partnerLocation.longitude,
          }
          setCurrentLocation((prev) => prev ?? seed)
          setTrail((prev) =>
            prev.length ? prev : [{ lat: seed.latitude, lng: seed.longitude }]
          )
        }
      } catch {
        toast.error('Failed to load booking')
      } finally {
        setLoading(false)
      }
    }
    fetchBooking()
    const interval = setInterval(fetchBooking, 30000)
    return () => clearInterval(interval)
  }, [id])

  // Listen to location updates
  useEffect(() => {
    const unsubscribe = listenToLocationUpdates((data) => {
      setCurrentLocation({
        latitude: data.latitude,
        longitude: data.longitude,
        speed: data.speed,
        heading: data.heading,
      })
      setTrail((prev) => {
        const next = [...prev, { lat: data.latitude, lng: data.longitude }]
        return next.length > 60 ? next.slice(next.length - 60) : next
      })
    })
    return unsubscribe
  }, [listenToLocationUpdates])

  // Listen to ETA updates
  useEffect(() => {
    const unsubscribe = listenToETAUpdates((data) => {
      setETA({
        minutes: data.eta ?? 0,
        distance: data.distance ?? 0,
      })
    })
    return unsubscribe
  }, [listenToETAUpdates])

  // Request ETA every 20 seconds
  useEffect(() => {
    if (!booking || booking.status === 'IN_PROGRESS') {
      const interval = setInterval(() => {
        requestETA()
      }, 20000)
      return () => clearInterval(interval)
    }
  }, [booking, requestETA])

  // Track the user's own live position (for the map)
  useEffect(() => {
    if (!('geolocation' in navigator)) return
    const watch = navigator.geolocation.watchPosition(
      (pos) => setUserGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    )
    return () => navigator.geolocation.clearWatch(watch)
  }, [])

  // Listen for incoming SOS alerts (e.g. from the partner)
  useEffect(() => {
    const unsub = listenToSOSAlerts((a: any) => {
      setSosAlert({ message: a.message, timestamp: a.timestamp })
    })
    return unsub
  }, [listenToSOSAlerts])

  const handleCancel = async () => {
    if (!id) return
    setCancelling(true)
    try {
      await api.post(`/bookings/${id}/cancel`)
      setBooking((prev) => prev ? { ...prev, status: 'CANCELLED' } : null)
      toast.success('Booking cancelled')
      setTimeout(() => navigate('/bookings'), 1500)
    } catch {
      toast.error('Failed to cancel')
    } finally {
      setCancelling(false)
    }
  }

  const handleSOS = async () => {
    try {
      await api.post('/users/sos/trigger', {
        latitude: userGeo?.lat ?? currentLocation?.latitude,
        longitude: userGeo?.lng ?? currentLocation?.longitude,
        message: `Emergency SOS during booking ${id}`,
      })
      sendSOS(`Emergency SOS during booking ${id}`, userGeo?.lat, userGeo?.lng)
      toast('🚨 Emergency SOS sent to partner & admins. Stay safe.', { duration: 5000 })
    } catch {
      toast.error('Failed to send SOS')
    }
  }

  const handleCall = () => {
    const partner = booking?.partner?.user
    if (partner?.phone) {
      window.location.href = `tel:${partner.phone}`
    }
  }

  const handleChat = () => {
    const partnerUserId = (booking?.partner as any)?.user?.id
    if (partnerUserId) navigate(`/messages/${partnerUserId}`)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'IN_PROGRESS':
        return 'bg-blue-500 text-white'
      case 'COMPLETED':
        return 'bg-green-500 text-white'
      case 'CANCELLED':
        return 'bg-red-500 text-white'
      default:
        return 'bg-gray-500 text-white'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'IN_PROGRESS':
        return 'In Progress'
      case 'COMPLETED':
        return 'Completed'
      case 'CANCELLED':
        return 'Cancelled'
      default:
        return status
    }
  }

  const partnerName = booking?.partner?.user.fullName || 'Partner'
  const partnerAvatar = assetUrl(booking?.partner?.user.avatarUrl)

  if (loading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    )
  }

  if (!booking || booking.status === 'CANCELLED') {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-surface-400 mx-auto mb-4" />
          <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-2">
            {booking?.status === 'CANCELLED' ? 'Booking Cancelled' : 'Booking not found'}
          </h2>
          <button onClick={() => navigate('/bookings')} className="btn-primary btn-sm mt-4">View Bookings</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* Live Map Background (real OpenStreetMap) */}
      <div className="absolute inset-0">
        <LiveMap
          partner={currentLocation ? { lat: currentLocation.latitude, lng: currentLocation.longitude } : null}
          user={userGeo}
          trail={trail}
          height="100%"
        />
        {/* Subtle tint for contrast */}
        <div className="absolute inset-0 bg-gradient-to-br from-sky-100/30 via-transparent to-blue-100/30 dark:from-sky-900/30 dark:via-transparent dark:to-blue-900/30 pointer-events-none" />
      </div>

      {/* Top bar with status */}
      <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between z-10">
        <button
          onClick={() => navigate(`/bookings/${id}`)}
          className="p-3 rounded-2xl bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl shadow-lg hover:bg-white/95 transition-all"
        >
          <XCircle className="w-5 h-5 text-surface-600 dark:text-surface-400" />
        </button>
        <div className={`px-4 py-2 rounded-2xl ${getStatusColor(booking.status)} backdrop-blur-xl shadow-lg text-sm font-semibold flex items-center gap-2`}>
          {booking.status === 'IN_PROGRESS' && (
            <span className="animate-pulse inline-block w-2 h-2 rounded-full bg-current" />
          )}
          {getStatusLabel(booking.status)}
        </div>
      </div>

      {/* Bottom sheet with booking details */}
      <div className="absolute bottom-0 left-0 right-0 z-10 max-h-[60vh] overflow-y-auto">
        <AnimatedPage>
          <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-t-3xl p-6 shadow-2xl border-t border-white/20 space-y-4">
            {/* SOS alert banner */}
            {sosAlert && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-red-100 dark:bg-red-900/40 border border-red-500 text-red-700 dark:text-red-200">
                <Siren className="w-5 h-5 animate-pulse" />
                <div>
                  <p className="font-semibold text-sm">SOS ALERT</p>
                  <p className="text-xs">{sosAlert.message}</p>
                  <p className="text-[11px] opacity-80">{new Date(sosAlert.timestamp).toLocaleTimeString('en-IN')}</p>
                </div>
              </div>
            )}

            {/* Partner Info */}
            {partnerName && (
              <GlassCard variant="elevated" padding="md">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0 shadow-lg shadow-primary-500/30">
                    {partnerAvatar ? (
                      <img src={partnerAvatar} alt={partnerName} className="w-full h-full rounded-2xl object-cover" />
                    ) : (
                      partnerName.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-surface-900 dark:text-white">{partnerName}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      <span className="text-xs text-surface-500">{booking?.partner?.averageRating ? `${booking.partner.averageRating.toFixed(1)} rating` : 'New partner'}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCall}
                      className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center hover:bg-emerald-200 transition-colors"
                    >
                      <Phone className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </button>
                    <button
                      onClick={handleChat}
                      className="w-10 h-10 rounded-xl bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center hover:bg-sky-200 transition-colors"
                    >
                      <MessageCircle className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                    </button>
                  </div>
                </div>
              </GlassCard>
            )}

            {/* Route Information */}
            <GlassCard variant="default" padding="md" className="space-y-2">
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-surface-500">From</p>
                  <p className="font-medium text-surface-900 dark:text-white text-sm truncate">{booking.startLocation}</p>
                </div>
              </div>
              <div className="h-1 mx-4 bg-gradient-to-r from-emerald-400 via-emerald-500 to-transparent rounded-full" />
              <div className="flex items-start gap-3">
                <Navigation className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-surface-500">To</p>
                  <p className="font-medium text-surface-900 dark:text-white text-sm truncate">{booking.endLocation || 'TBA'}</p>
                </div>
              </div>
            </GlassCard>

            {/* ETA Display */}
            {eta && (
              <GlassCard variant="elevated" padding="md" className="bg-gradient-to-r from-blue-50 to-sky-50 dark:from-blue-900/20 dark:to-sky-900/20">
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-blue-500 animate-pulse" />
                  <div className="flex-1">
                    <p className="text-xs text-surface-500">Estimated Time</p>
                    <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
                      {eta.minutes} min
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-surface-500">Distance</p>
                    <p className="text-lg font-bold text-surface-900 dark:text-white">
                      {eta.distance.toFixed(1)} km
                    </p>
                  </div>
                </div>
              </GlassCard>
            )}

            {/* Partner Live Location */}
            {currentLocation && (
              <GlassCard variant="default" padding="md" className="space-y-2">
                <p className="text-xs text-surface-500">Partner Live Location</p>
                <p className="font-mono text-sm text-surface-700 dark:text-surface-300">
                  {currentLocation.latitude.toFixed(4)}, {currentLocation.longitude.toFixed(4)}
                </p>
                {currentLocation.speed !== undefined && (
                  <div className="flex items-center gap-2 pt-2 border-t border-surface-200 dark:border-surface-700">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-sm text-surface-700 dark:text-surface-300">
                      Speed: {currentLocation.speed.toFixed(1)} km/h
                    </span>
                  </div>
                )}
              </GlassCard>
            )}

            {/* Your Live Location */}
            {userGeo && (
              <GlassCard variant="default" padding="md" className="space-y-2">
                <p className="text-xs text-surface-500">Your Live Location</p>
                <p className="font-mono text-sm text-surface-700 dark:text-surface-300">
                  {userGeo.lat.toFixed(4)}, {userGeo.lng.toFixed(4)}
                </p>
              </GlassCard>
            )}

            {/* Amount */}
            {booking.estimatedAmount && (
              <GlassCard variant="default" padding="md" className="bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-surface-600 dark:text-surface-400">Estimated Amount</span>
                  <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">₹{booking.estimatedAmount}</span>
                </div>
              </GlassCard>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCancel}
                disabled={cancelling || booking.status !== 'IN_PROGRESS'}
                className="flex-1 py-3 rounded-xl border border-red-200 dark:border-red-800/30 text-red-500 text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {cancelling ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Cancelling...
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4" /> Cancel
                  </>
                )}
              </button>
              <button
                onClick={handleSOS}
                className="px-6 py-3 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-red-500/30"
              >
                <AlertTriangle className="w-4 h-4" /> SOS
              </button>
            </div>
          </div>
        </AnimatedPage>
      </div>
    </div>
  )
}
