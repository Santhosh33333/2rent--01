import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { MapPin, Clock, Navigation, KeyRound, CheckCircle, Loader2, ArrowLeft, Timer, Receipt, MessageCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { api, partnerApi, bookingApi } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { SkeletonLoader } from '../../components/SkeletonLoader'

interface Job {
  id: string
  serviceType: string
  startLocation: string
  endLocation?: string
  status: string
  scheduledAt: string
  startedAt?: string | null
  durationMinutes?: number
  estimatedAmount?: number
  finalAmount?: number
  partnerEarning?: number
  user?: { id?: string; fullName?: string }
  partnerLocation?: { latitude: number; longitude: number } | null
}

interface Tracking {
  phase: 'NOT_STARTED' | 'TRAVELLING' | 'ARRIVED'
  etaMinutesEstimate: number | null
}

function errMsg(err: any, fallback: string): string {
  return err?.response?.data?.message || err?.response?.data?.error || fallback
}

export function PartnerJobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [job, setJob] = useState<Job | null>(null)
  const [tracking, setTracking] = useState<Tracking | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [startCode, setStartCode] = useState('')
  const [completionCode, setCompletionCode] = useState('')
  const [now, setNow] = useState(Date.now())

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const [bRes, tRes] = await Promise.all([
        bookingApi.getById(id),
        api.get(`/bookings/${id}/tracking`).catch(() => null),
      ])
      const b = bRes.data?.data || bRes.data
      setJob(b?.booking || b)
      const t = tRes?.data?.data || tRes?.data
      if (t?.phase) setTracking(t)
    } catch {
      toast.error('Failed to load job')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Display-only elapsed timer. Billing uses the server clock (startedAt).
  useEffect(() => {
    if (job?.status !== 'IN_PROGRESS' || !job.startedAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [job?.status, job?.startedAt])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
      await refresh()
    } catch (e: any) {
      toast.error(errMsg(e, 'Action failed'))
    } finally {
      setBusy(null)
      setStartCode('')
      setCompletionCode('')
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="skeleton h-8 w-48 rounded-2xl" />
        <SkeletonLoader variant="card" />
      </div>
    )
  }

  if (!job) {
    return (
      <div className="text-center py-20 max-w-2xl mx-auto">
        <p className="text-lg font-bold text-surface-900 dark:text-white mb-2">Job not found</p>
        <button onClick={() => navigate('/partner/jobs')} className="btn-primary btn-sm mt-4">Back to Jobs</button>
      </div>
    )
  }

  const elapsed = job.startedAt ? Math.max(0, Math.floor((now - new Date(job.startedAt).getTime()) / 1000)) : 0
  const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0')
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  const phase = tracking?.phase ?? 'NOT_STARTED'
  const isUpcoming = job.status === 'PARTNER_ACCEPTED' || job.status === 'OTP_GENERATED'

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <AnimatedPage>
        <button onClick={() => navigate('/partner/jobs')} className="flex items-center gap-2 text-sm text-surface-500 hover:text-surface-700 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Jobs
        </button>
        <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">
          {job.serviceType === 'WALKING' ? 'Walking Buddy Job' : 'CarryBuddy Job'}
        </h1>
        <p className="text-sm text-surface-500 mt-1">Job #{job.id.slice(-8)} • {job.status.replace(/_/g, ' ')}</p>
      </AnimatedPage>

      {/* Upcoming job card — never shows Complete here (spec 86) */}
      {isUpcoming && (
        <AnimatedPage delay={50}>
          <GlassCard variant="elevated" padding="lg">
            <h3 className="section-title mb-4">Upcoming Job</h3>
            <div className="space-y-2 text-sm">
              <p className="flex items-center gap-2"><MapPin className="w-4 h-4 text-emerald-500" /> {job.startLocation}</p>
              <p className="flex items-center gap-2"><Clock className="w-4 h-4 text-sky-500" /> {new Date(job.scheduledAt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
              {job.durationMinutes ? <p className="text-surface-500">Estimated duration: {job.durationMinutes} min</p> : null}
              {job.user?.fullName ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-surface-500">Customer: {job.user.fullName}</p>
                  <button
                    onClick={() => job.user?.id && navigate(`/messages/${job.user.id}`, { state: { name: job.user.fullName } })}
                    disabled={!job.user?.id}
                    className="btn-outline btn-sm flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <MessageCircle className="w-3.5 h-3.5" /> Message
                  </button>
                </div>
              ) : null}
              {tracking?.etaMinutesEstimate != null && phase === 'TRAVELLING' && (
                <p className="text-surface-500">ETA: ~{tracking.etaMinutesEstimate} min</p>
              )}
            </div>
            <div className="flex gap-3 mt-4">
              {phase === 'NOT_STARTED' ? (
                <button onClick={() => run('go', async () => { await partnerApi.goToJob(job.id); toast.success('Navigation started. Travel safely.') })} disabled={busy !== null} className="flex-1 btn-gradient flex items-center justify-center gap-2 disabled:opacity-50">
                  {busy === 'go' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />} Go to Job
                </button>
              ) : (
                <button onClick={() => run('arrived', async () => { await partnerApi.markArrived(job.id); toast.success('Arrival recorded. Ask the user for the start code.') })} disabled={busy !== null || phase === 'ARRIVED'} className="flex-1 btn-gradient flex items-center justify-center gap-2 disabled:opacity-50">
                  {busy === 'arrived' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                  {phase === 'ARRIVED' ? 'Arrived ✓' : "I've Arrived"}
                </button>
              )}
            </div>
            <p className="text-xs text-surface-400 mt-3">Start unlocks inside the scheduled time window after the user shares the start code in person.</p>
          </GlassCard>
        </AnimatedPage>
      )}

      {/* Start-code entry — partner enters the USER's code */}
      {(job.status === 'OTP_GENERATED' || (isUpcoming && phase === 'ARRIVED')) && (
        <AnimatedPage delay={100}>
          <GlassCard variant="elevated" padding="lg">
            <h3 className="section-title mb-2 flex items-center gap-2"><KeyRound className="w-5 h-5 text-primary-500" /> Enter Start Code</h3>
            <p className="text-xs text-surface-500 mb-4">Ask the customer to read out their start code in person. Never accept codes over chat.</p>
            <div className="flex gap-3">
              <input value={startCode} onChange={(e) => setStartCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" inputMode="numeric" className="input flex-1 text-center tracking-[0.3em] font-bold" />
              <button onClick={() => run('start', async () => { await partnerApi.verifyStartCode(job.id, { startOtp: startCode }); toast.success('Job started. Timer is running.') })} disabled={busy !== null || startCode.length < 4} className="btn-gradient px-6 disabled:opacity-50">
                {busy === 'start' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Start Job'}
              </button>
            </div>
          </GlassCard>
        </AnimatedPage>
      )}

      {/* In progress — timer display + request completion (no direct complete) */}
      {job.status === 'IN_PROGRESS' && (
        <AnimatedPage delay={100}>
          <GlassCard variant="elevated" padding="lg">
            <h3 className="section-title mb-2 flex items-center gap-2"><Timer className="w-5 h-5 text-emerald-500" /> Job in Progress</h3>
            <p className="text-4xl font-bold font-display tabular-nums text-surface-900 dark:text-white">{hh}:{mm}:{ss}</p>
            <p className="text-xs text-surface-400 mt-1">Display only — billing uses the server clock from {job.startedAt ? new Date(job.startedAt).toLocaleTimeString('en-IN') : 'start'}.</p>
            <button onClick={() => run('request', async () => { await partnerApi.requestCompletion(job.id); toast.success('Completion requested. The user will confirm with a code.') })} disabled={busy !== null} className="btn-gradient w-full mt-4 disabled:opacity-50">
              {busy === 'request' ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Request Completion'}
            </button>
            <button
              onClick={() => run('sos', async () => { await api.post('/users/sos/trigger', { message: `Emergency SOS during job ${job.id}` }); toast('🚨 Emergency SOS sent. Stay safe.', { duration: 5000 }) })}
              disabled={busy !== null}
              className="w-full mt-3 btn-outline text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10 border-danger-200 dark:border-danger-800/30 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              Emergency SOS
            </button>
          </GlassCard>
        </AnimatedPage>
      )}

      {/* Completion-code entry — partner enters the USER's code to finish */}
      {job.status === 'COMPLETION_REQUESTED' && (
        <AnimatedPage delay={100}>
          <GlassCard variant="elevated" padding="lg">
            <h3 className="section-title mb-2 flex items-center gap-2"><Receipt className="w-5 h-5 text-primary-500" /> Enter Completion Code</h3>
            <p className="text-xs text-surface-500 mb-4">The customer confirms the work and reads out their completion code in person.</p>
            <div className="flex gap-3">
              <input value={completionCode} onChange={(e) => setCompletionCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" inputMode="numeric" className="input flex-1 text-center tracking-[0.3em] font-bold" />
              <button onClick={() => run('complete', async () => { await partnerApi.completeBooking(job.id, { completionOtp: completionCode }); toast.success('Job completed.') })} disabled={busy !== null || completionCode.length < 4} className="btn-gradient px-6 disabled:opacity-50">
                {busy === 'complete' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Complete Job'}
              </button>
            </div>
          </GlassCard>
        </AnimatedPage>
      )}

      {job.status === 'COMPLETED' && (
        <AnimatedPage delay={100}>
          <GlassCard variant="elevated" padding="lg">
            <h3 className="section-title mb-2 flex items-center gap-2"><CheckCircle className="w-5 h-5 text-emerald-500" /> Completed</h3>
            <div className="flex justify-between text-sm mt-2">
              <span className="text-surface-500">Final amount</span>
              <span className="font-bold">₹{(job.finalAmount ?? job.estimatedAmount ?? 0).toLocaleString('en-IN')}</span>
            </div>
            {job.partnerEarning !== undefined && (
              <div className="flex justify-between text-sm mt-1">
                <span className="text-surface-500">Your earning</span>
                <span className="font-bold text-emerald-600">₹{job.partnerEarning.toLocaleString('en-IN')}</span>
              </div>
            )}
            <Link to={`/bookings/${job.id}`} className="btn-outline w-full mt-4 flex items-center justify-center gap-2">View Details</Link>
          </GlassCard>
        </AnimatedPage>
      )}
    </div>
  )
}
