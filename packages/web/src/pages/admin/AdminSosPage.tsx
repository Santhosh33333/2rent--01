import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, MapPin, Phone, Siren } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { api, assetUrl } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/EmptyState'
import { getErrorMessage } from '../../lib/error'

interface SosRow {
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

export function AdminSosPage() {
  const [alerts, setAlerts] = useState<SosRow[]>([])
  const [filter, setFilter] = useState<'ACTIVE' | 'ALL'>('ACTIVE')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/admin/sos/alerts', {
        params: { limit: 30, ...(filter === 'ACTIVE' ? { status: 'ACTIVE' } : {}) },
      })
      const d = res.data?.data || res.data
      setAlerts(Array.isArray(d.items) ? d.items : [])
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not load SOS alerts'))
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    setLoading(true)
    load()
    const iv = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) load()
    }, 30000)
    return () => clearInterval(iv)
  }, [load])

  const resolve = async (id: string) => {
    setBusy(id)
    try {
      await api.post(`/admin/sos/${id}/resolve`)
      toast.success('Alert resolved')
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'RESOLVED', resolvedAt: new Date().toISOString() } : a)))
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not resolve'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="SOS Alerts" subtitle="Emergencies needing eyes right now — auto-refreshes" />

      <div className="flex gap-2">
        {(['ACTIVE', 'ALL'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              filter === f
                ? 'bg-red-600 text-white shadow-lg shadow-red-500/25'
                : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400'
            }`}
          >
            {f === 'ACTIVE' ? 'Active' : 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-surface-500 py-10 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading alerts…
        </div>
      ) : alerts.length === 0 ? (
        <EmptyState icon={Siren} title="No SOS alerts" description={filter === 'ACTIVE' ? 'Nothing active. Quiet is good.' : 'No alerts on record.'} />
      ) : (
        <div className="grid gap-4">
          {alerts.map((a) => (
            <AnimatedPage key={a.id}>
              <div className={`glass-card p-5 ${a.status === 'ACTIVE' ? 'border-red-500/40' : ''}`}>
                <div className="flex items-start gap-3">
                  {a.user?.avatarUrl ? (
                    <img src={assetUrl(a.user.avatarUrl) || ''} alt="" className="w-11 h-11 rounded-2xl object-cover shrink-0" />
                  ) : (
                    <div className="w-11 h-11 rounded-2xl bg-red-500/15 flex items-center justify-center shrink-0">
                      <Siren className="w-5 h-5 text-red-500" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold">{a.user?.fullName || 'Unknown user'}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${a.status === 'ACTIVE' ? 'bg-red-500 text-white animate-pulse' : 'bg-surface-200 dark:bg-surface-700 text-surface-500'}`}>
                        {a.status}
                      </span>
                    </div>
                    <p className="text-xs text-surface-500 mt-0.5">
                      {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                      {a.latitude != null && a.longitude != null && ` · ${a.latitude.toFixed(4)}, ${a.longitude.toFixed(4)}`}
                    </p>
                    {a.message && <p className="text-sm mt-1">{a.message}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Link to={`/sos/${a.id}`} className="rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> Live location
                  </Link>
                  {a.user?.phone && (
                    <a href={`tel:${a.user.phone}`} className="rounded-xl bg-surface-100 dark:bg-surface-800 px-3 py-2 text-xs font-semibold inline-flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5" /> {a.user.phone}
                    </a>
                  )}
                  {a.status === 'ACTIVE' && (
                    <button onClick={() => resolve(a.id)} disabled={busy === a.id} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                      {busy === a.id ? 'Resolving…' : 'Resolve'}
                    </button>
                  )}
                </div>
              </div>
            </AnimatedPage>
          ))}
        </div>
      )}
    </div>
  )
}
