import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, MapPin, Phone, ShieldAlert, Siren } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/EmptyState'
import { LiveMap } from '../../components/LiveMap'
import { getErrorMessage } from '../../lib/error'

interface SosAlertDetail {
  id: string
  userId: string
  latitude: number | null
  longitude: number | null
  message: string | null
  status: string
  createdAt: string
  resolvedAt: string | null
  user?: { id: string; fullName: string; phone: string | null; avatarUrl?: string | null }
}

export function SosAlertPage() {
  const { alertId } = useParams<{ alertId: string }>()
  const navigate = useNavigate()
  const [alert, setAlert] = useState<SosAlertDetail | null>(null)
  const [viewerRole, setViewerRole] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!alertId) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.get(`/users/sos/${alertId}`)
      const d = res.data?.data || res.data
      setAlert(d.alert)
      setViewerRole(d.viewerRole || '')
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load this alert'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertId])

  const cancelAlert = async () => {
    if (!alert) return
    setBusy(true)
    try {
      await api.post('/users/sos/cancel')
      toast.success('SOS alert cancelled')
      load()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not cancel'))
    } finally {
      setBusy(false)
    }
  }

  const resolveAlert = async () => {
    if (!alert) return
    setBusy(true)
    try {
      await api.post(`/admin/sos/${alert.id}/resolve`)
      toast.success('Alert marked resolved')
      load()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not resolve'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-40 rounded-2xl" />
        <div className="skeleton h-64 rounded-3xl" />
      </div>
    )
  }

  if (error || !alert) {
    return (
      <EmptyState
        icon={Siren}
        title="Alert unavailable"
        description={error || 'This alert does not exist.'}
        action={<button onClick={() => navigate(-1)} className="btn btn-primary btn-sm">Go back</button>}
      />
    )
  }

  const isActive = alert.status === 'ACTIVE'
  const hasCoords = Number.isFinite(alert.latitude) && Number.isFinite(alert.longitude)

  return (
    <div className="space-y-6">
      <PageHeader
        title="SOS Alert"
        subtitle={`${alert.user?.fullName || 'Someone'} · ${format(new Date(alert.createdAt), 'MMM d, h:mm a')}`}
        action={
          <button onClick={() => navigate(-1)} className="btn-ghost btn-sm flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        }
      />

      <AnimatedPage>
        <div className={`rounded-3xl p-4 flex items-center gap-3 ${isActive ? 'bg-red-500/10 border border-red-500/30' : 'bg-surface-100 dark:bg-surface-800'}`}>
          <span className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${isActive ? 'bg-red-500' : 'bg-surface-300 dark:bg-surface-700'}`}>
            <Siren className="w-5 h-5 text-white" />
          </span>
          <div className="flex-1">
            <p className="font-bold text-sm">{isActive ? 'ACTIVE EMERGENCY' : `Alert ${alert.status.toLowerCase()}`}</p>
            {alert.message && <p className="text-xs text-surface-500 mt-0.5">{alert.message}</p>}
          </div>
          {isActive && viewerRole === 'OWNER' && (
            <button onClick={cancelAlert} disabled={busy} className="rounded-xl bg-red-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              Cancel SOS
            </button>
          )}
          {isActive && viewerRole === 'ADMIN' && (
            <button onClick={resolveAlert} disabled={busy} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              Resolve
            </button>
          )}
        </div>
      </AnimatedPage>

      <AnimatedPage delay={50}>
        {hasCoords ? (
          <LiveMap
            markers={[{ lat: alert.latitude as number, lng: alert.longitude as number, color: '#ef4444', label: alert.user?.fullName || 'SOS' }]}
            height={320}
          />
        ) : (
          <div className="rounded-3xl border border-dashed border-surface-300 p-8 text-center text-sm text-surface-500 dark:border-surface-700">
            No location was attached to this alert. Call the person directly.
          </div>
        )}
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <div className="glass-card p-5 space-y-2">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-500" /> Reach now
          </h3>
          <div className="grid gap-2">
            <a href="tel:112" className="flex items-center gap-2 rounded-2xl bg-red-500 px-4 py-3 text-sm font-bold text-white">
              <Phone className="w-4 h-4" /> Call Emergency (112)
            </a>
            <a href="tel:100" className="flex items-center gap-2 rounded-2xl border border-surface-200 dark:border-surface-700 px-4 py-3 text-sm font-semibold">
              <Phone className="w-4 h-4 text-red-500" /> Call Police (100)
            </a>
            {alert.user?.phone && (viewerRole === 'ADMIN' || viewerRole === 'PARTNER') && (
              <a href={`tel:${alert.user.phone}`} className="flex items-center gap-2 rounded-2xl border border-surface-200 dark:border-surface-700 px-4 py-3 text-sm font-semibold">
                <Phone className="w-4 h-4 text-primary-500" /> Call {alert.user.fullName} ({alert.user.phone})
              </a>
            )}
            {hasCoords && (
              <a
                href={`https://maps.google.com/?q=${alert.latitude},${alert.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-2xl border border-surface-200 dark:border-surface-700 px-4 py-3 text-sm font-semibold"
              >
                <MapPin className="w-4 h-4 text-emerald-500" /> Open in Maps
              </a>
            )}
          </div>
        </div>
      </AnimatedPage>

      <p className="text-center text-xs text-surface-400">
        <Link to="/notifications" className="underline">Back to notifications</Link>
      </p>
    </div>
  )
}
