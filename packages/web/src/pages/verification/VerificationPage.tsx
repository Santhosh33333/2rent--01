import { getErrorMessage } from '../../lib/error'
import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Shield, Mail, Smartphone, Camera, CreditCard, MapPin,
  CheckCircle, Clock, AlertTriangle, Sparkles,
  ArrowRight, UserCheck, RefreshCw, Phone, ClipboardCheck
} from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/EmptyState'

interface Step {
  name: string
  status: 'verified' | 'pending' | 'not-started' | 'rejected'
  link?: string
  icon: typeof Shield
  description: string
  rejectionReason?: string
}

const stepMeta: Record<string, { icon: typeof Shield; description: string }> = {
  'Personal Details': { icon: UserCheck, description: 'Provide your basic personal information' },
  'Email Verification': { icon: Mail, description: 'Verify your email address to secure your account' },
  'Mobile Verification': { icon: Smartphone, description: 'Confirm your phone number for SMS notifications' },
  'Selfie Verification': { icon: Camera, description: 'Upload a selfie to match your ID photo' },
  'Government ID': { icon: CreditCard, description: 'Submit a valid government-issued ID' },
  'Address Proof': { icon: MapPin, description: 'Provide proof of your current address' },
  'Emergency Contact': { icon: Phone, description: 'Add a contact we can reach in case of emergency' },
  'Review & Submit': { icon: ClipboardCheck, description: 'Review your documents and submit for verification' },
  'Admin Verification': { icon: Shield, description: 'Our team reviews and approves your submission' },
}

export function VerificationPage() {
  const [steps, setSteps] = useState<Step[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [overallStatus, setOverallStatus] = useState<string>('UNVERIFIED')
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)
  const { updateUser } = useAuth()
  const navigate = useNavigate()
  // Set once when approval is detected so the cached session user unlocks the
  // whole app (ProtectedRoute reads user.kycStatus) and we auto-redirect.
  const verifiedHandled = useRef(false)

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null

    const fetchVerificationStatus = async () => {
      try {
        const response = await api.get('/verification/status')
        const result = response.data
        if (result.success) {
          const data = result.data || {}
          const docs = data.documents || {}
          const personalDetails = Boolean(data.personalDetails ?? docs.personalDetails)
          const govId = Boolean(data.govId ?? docs.govId)
          const selfie = Boolean(data.selfie ?? docs.selfie)
          const addressProof = Boolean(data.addressProof ?? docs.addressProof)
          const emergencyContact = Boolean(data.emergencyContact ?? docs.emergencyContact)
          const status = data.status || 'UNVERIFIED'
          setOverallStatus(status)
          setRejectionReason(data.rejectionReason || null)
          if (status === 'VERIFIED') {
            updateUser({ kycStatus: 'VERIFIED' })
            if (!verifiedHandled.current) {
              verifiedHandled.current = true
              if (intervalId) clearInterval(intervalId)
              // Verified users go straight into the normal app experience.
              setTimeout(() => navigate('/dashboard', { replace: true }), 2500)
            }
          }
          setSteps([
            { name: 'Personal Details', status: personalDetails ? 'verified' : 'not-started', link: '/verification/step1', ...stepMeta['Personal Details'] },
            { name: 'Government ID', status: govId ? 'verified' : 'not-started', link: '/verification/step2', ...stepMeta['Government ID'] },
            { name: 'Selfie Verification', status: selfie ? 'verified' : 'not-started', link: '/verification/step3', ...stepMeta['Selfie Verification'], rejectionReason: status === 'REJECTED' ? data.rejectionReason : undefined },
            { name: 'Address Proof', status: addressProof ? 'verified' : 'not-started', link: '/verification/step4', ...stepMeta['Address Proof'], rejectionReason: status === 'REJECTED' ? data.rejectionReason : undefined },
            { name: 'Emergency Contact', status: emergencyContact ? 'verified' : 'not-started', link: '/verification/step5', ...stepMeta['Emergency Contact'] },
            { name: 'Review & Submit', status: status === 'SUBMITTED' || status === 'VERIFIED' ? 'verified' : (personalDetails && govId && selfie && addressProof && emergencyContact) ? 'pending' : 'not-started', link: '/verification/step6', ...stepMeta['Address Proof'] },
            { name: 'Admin Verification', status: status === 'VERIFIED' ? 'verified' : status === 'REJECTED' ? 'rejected' : 'pending', ...stepMeta['Address Proof'] },
          ])
          // While awaiting admin review, poll so an approval reflects without
          // the user refreshing.
          if ((status === 'SUBMITTED' || status === 'PENDING') && !intervalId) {
            intervalId = setInterval(fetchVerificationStatus, 15000)
          }
        } else {
          setError(result.error || 'Failed to fetch verification status')
        }
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Failed to fetch verification status'))
      } finally {
        setLoading(false)
      }
    }
    fetchVerificationStatus()

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [updateUser, navigate])

  const verifiedCount = steps.filter(s => s.status === 'verified').length
  const progress = steps.length > 0 ? (verifiedCount / steps.length) * 100 : 0

  const statusConfig = {
    'verified': { icon: CheckCircle, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', badge: 'badge-success', label: 'Verified' },
    'pending': { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10', badge: 'badge-warning', label: 'Pending' },
    'not-started': { icon: AlertTriangle, color: 'text-surface-400', bg: 'bg-surface-50 dark:bg-surface-800/50', badge: 'badge-neutral', label: 'Not Started' },
    'rejected': { icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-500/10', badge: 'badge-danger', label: 'Rejected' },
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="skeleton h-8 w-48 rounded-2xl" />
        {[1, 2, 3].map(i => <div key={i} className="skeleton h-20 rounded-2xl" />)}
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState icon={AlertTriangle} title="Failed to load verification" description={error}
        action={<button onClick={() => window.location.reload()} className="btn-primary btn-sm">Retry</button>} />
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader title="Verification" subtitle="Complete all steps to become a verified member" />

      {overallStatus === 'REJECTED' && rejectionReason && (
        <AnimatedPage>
          <div className="rounded-2xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="font-bold text-red-700 dark:text-red-400 text-sm">Verification Rejected</h3>
                <p className="text-sm text-red-600 dark:text-red-300 mt-1">{rejectionReason}</p>
                <p className="text-sm text-red-500 dark:text-red-400 mt-2">Please re-upload the required documents below.</p>
              </div>
            </div>
          </div>
        </AnimatedPage>
      )}

      {overallStatus === 'VERIFIED' && (
        <AnimatedPage>
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-5">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">You're verified!</h3>
                <p className="text-sm text-emerald-600 dark:text-emerald-300 mt-1">
                  All features are unlocked. Taking you to your dashboardâ€¦
                </p>
                <Link to="/dashboard" className="btn-primary btn-sm mt-3 inline-flex">
                  Go to Dashboard <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          </div>
        </AnimatedPage>
      )}

      {/* Progress Card */}
      <AnimatedPage>
        <GlassCard variant="elevated" padding="lg" className="bg-gradient-to-br from-primary-500/5 to-accent-500/5">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/20">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="font-bold font-display text-surface-900 dark:text-white">Verification Progress</h2>
              <p className="text-sm text-surface-500">{verifiedCount}/{steps.length} steps complete</p>
            </div>
          </div>
          <div className="w-full h-3 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all duration-1000 ease-out" style={{ width: `${progress}%` }} />
          </div>
        </GlassCard>
      </AnimatedPage>

      {/* Steps */}
      <div className="space-y-3">
        {steps.map((step, index) => {
          const config = statusConfig[step.status]
          const StatusIcon = config.icon
          const StepIcon = step.icon

          return (
            <AnimatedPage key={step.name} delay={100 + index * 50}>
              <div className={`glass-card p-5 border-l-4 ${
                step.status === 'verified' ? 'border-emerald-500' :
                step.status === 'pending' ? 'border-amber-500' :
                step.status === 'rejected' ? 'border-danger-500' :
                'border-surface-200 dark:border-surface-700'
              } hover:-translate-y-0.5 transition-all duration-300`}>
                <div className="flex items-center gap-4">
                  <div className={`w-11 h-11 rounded-2xl ${config.bg} flex items-center justify-center flex-shrink-0`}>
                    <StepIcon className={`w-5 h-5 ${config.color}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold font-display text-surface-900 dark:text-white">{step.name}</h3>
                    <p className="text-xs text-surface-500 mt-0.5">{step.description}</p>
                    {step.status === 'rejected' && step.rejectionReason && (
                      <p className="text-xs text-red-500 mt-1">{step.rejectionReason}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={config.badge}>
                      <StatusIcon className="w-3 h-3" /> {config.label}
                    </span>
                    {step.status !== 'verified' && step.link && (
                      <Link to={step.link} className="btn-primary btn-xs">
                        {step.status === 'rejected' ? <><RefreshCw className="w-3 h-3" /> Re-submit</> :
                         step.status === 'pending' ? <><span>Continue</span> <ArrowRight className="w-3 h-3" /></> :
                         <><span>Start</span> <ArrowRight className="w-3 h-3" /></>}
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </AnimatedPage>
          )
        })}
      </div>

      {/* Benefits */}
      <AnimatedPage delay={400}>
        <GlassCard variant="elevated" padding="lg" className="bg-gradient-to-br from-primary-500/5 to-accent-500/5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/20 flex-shrink-0">
              <UserCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-bold font-display text-surface-900 dark:text-white mb-1">Why Get Verified?</h3>
              <p className="text-sm text-surface-500 mb-3">Verified members enjoy higher trust scores, premium features, and increased visibility.</p>
              <div className="flex flex-wrap gap-2">
                {['Higher trust score', 'Priority matching', 'Verified badge', 'Access to events'].map((benefit) => (
                  <span key={benefit} className="badge-glass text-xs">
                    <Sparkles className="w-3 h-3 text-primary-500" /> {benefit}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}