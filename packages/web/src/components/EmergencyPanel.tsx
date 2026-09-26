import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Phone, ShieldAlert, Siren } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../lib/api'
import { useGeolocation } from '../lib/geolocation'
import { getErrorMessage } from '../lib/error'

const CALL_OPTIONS = [
  { label: 'Police', number: '100' },
  { label: 'Emergency (all-in-one)', number: '112' },
  { label: 'Ambulance', number: '108' },
]

/**
 * Safety card: call police / emergency services, call your emergency
 * contact, or send an in-app SOS alert (GPS + realtime ping to admins and
 * the assigned partner). Active alerts can be cancelled from here.
 */
export function EmergencyPanel() {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [active, setActive] = useState(false)
  const [activeAlertId, setActiveAlertId] = useState<string | null>(null)
  const [contactPhone, setContactPhone] = useState<string | null>(null)
  const [contactName, setContactName] = useState<string | null>(null)
  const geo = useGeolocation()

  const refreshStatus = async () => {
    try {
      const res = await api.get('/users/sos/status')
      const d = res.data?.data || res.data
      setActive(Boolean(d?.active))
      setActiveAlertId(d?.alert?.id || null)
    } catch {
      // status is best-effort; the buttons work regardless
    }
  }

  useEffect(() => {
    refreshStatus()
    api
      .get('/verification/status')
      .then((r) => {
        const d = r.data?.data || r.data || {}
        const docs = d.documents || d
        if (docs?.emergencyContactPhone) {
          setContactPhone(docs.emergencyContactPhone as string)
          setContactName((docs.emergencyContactName as string) || 'Emergency contact')
        }
      })
      .catch(() => {})
  }, [])

  const sendSos = async () => {
    setSending(true)
    try {
      let lat = geo.fix?.lat
      let lon = geo.fix?.lon
      if (lat === undefined || lon === undefined) {
        // One fresh attempt; fall back to cached fix without blocking.
        geo.requestFix()
        await new Promise((r) => setTimeout(r, 2500))
        try {
          const cached = localStorage.getItem('Sidebud-geo-fix')
          if (cached) {
            const fix = JSON.parse(cached)
            lat = fix.lat
            lon = fix.lon
          }
        } catch {
          // proceed without coordinates rather than trapping the user
        }
      }
      if (lat === undefined || lon === undefined) {
        toast.error('Location unavailable — call 112 directly right now.')
        return
      }
      await api.post('/users/sos/trigger', {
        latitude: lat,
        longitude: lon,
        message: 'Emergency SOS from Safety panel',
      }).then((res) => {
        const d = res.data?.data || res.data
        if (d?.id) setActiveAlertId(d.id)
        // Admin + emergency-contact emails are dispatched server-side; the
        // response flags whether at least one went out.
        if (d?.emailSent) {
          toast.success('SOS emailed to our safety team and your emergency contact. Stay safe.', { duration: 6000 })
        } else {
          toast.success('SOS sent to admins and your partner. Stay safe.', { duration: 6000 })
        }
      })
      setActive(true)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not send SOS — call 112 directly.'))
    } finally {
      setSending(false)
    }
  }

  const cancelSos = async () => {
    try {
      await api.post('/users/sos/cancel')
      setActive(false)
      setActiveAlertId(null)
      toast.success('SOS alert cancelled')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not cancel the alert'))
    }
  }

  return (
    <div className="rounded-3xl border border-red-200 dark:border-red-900/40 bg-red-50/60 dark:bg-red-950/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-2xl bg-red-500 flex items-center justify-center shrink-0">
            <Siren className="w-5 h-5 text-white" />
          </span>
          <div>
            <p className="font-bold text-sm text-surface-900 dark:text-white">Emergency</p>
            <p className="text-xs text-surface-500">
              {active ? 'Alert ACTIVE — help notified' : 'Police, contact & SOS alert'}
            </p>
          </div>
        </div>
        {active ? (
          <div className="flex items-center gap-2 shrink-0">
            {activeAlertId && (
              <Link to={`/sos/${activeAlertId}`} className="rounded-xl bg-white/70 dark:bg-white/10 px-3 py-2 text-xs font-bold text-red-600 dark:text-red-300">
                View live
              </Link>
            )}
            <button type="button" onClick={cancelSos} className="rounded-xl bg-red-500 px-3 py-2 text-xs font-bold text-white">
              Cancel SOS
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={`rounded-xl px-3 py-2 text-xs font-bold text-white ${open ? 'bg-surface-500' : 'bg-red-500'}`}
          >
            {open ? 'Close' : 'SOS'}
          </button>
        )}
      </div>

      {open && !active && (        <div className="mt-3 space-y-2">
          {CALL_OPTIONS.map((c) => (
            <a
              key={c.number}
              href={`tel:${c.number}`}
              className="flex items-center gap-2 rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 px-4 py-2.5 text-sm font-semibold"
            >
              <Phone className="w-4 h-4 text-red-500" /> Call {c.label} ({c.number})
            </a>
          ))}
          {contactPhone && (
            <a
              href={`tel:${contactPhone}`}
              className="flex items-center gap-2 rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 px-4 py-2.5 text-sm font-semibold"
            >
              <Phone className="w-4 h-4 text-primary-500" /> Call {contactName} ({contactPhone})
            </a>
          )}
          <button
            type="button"
            onClick={sendSos}
            disabled={sending}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-red-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
            {sending ? 'Sending alert…' : 'Send SOS alert with my location'}
          </button>
          <p className="text-[11px] text-surface-400 text-center">
            SOS notifies platform admins and your active partner instantly.
          </p>
        </div>
      )}
    </div>
  )
}
