import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Footprints, Package, CheckCircle, ArrowLeft, ArrowRight, Loader2, CreditCard, FileText, AlertTriangle
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'

type Step = 1 | 2 | 3 | 4

export function PartnerApplyPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(1)
  const [submitting, setSubmitting] = useState(false)
  const [applied, setApplied] = useState(false)

  const [services, setServices] = useState({
    walking: false,
    carryBuddy: false,
  })
  const [bankDetails, setBankDetails] = useState({
    accountName: '',
    accountNumber: '',
    ifsc: '',
    upi: '',
  })
  const [agreed, setAgreed] = useState(false)

  const canProceed = () => {
    switch (step) {
      case 1: return services.walking || services.carryBuddy
      case 2: return bankDetails.accountName && bankDetails.accountNumber && bankDetails.ifsc
      case 3: return agreed
      default: return true
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const serviceTypes: string[] = []
      if (services.walking) serviceTypes.push('WALKING')
      if (services.carryBuddy) serviceTypes.push('CARRY_BUDDY')

      await api.post('/partner/apply', {
        serviceTypes,
        bankDetails: {
          accountName: bankDetails.accountName,
          accountNumber: bankDetails.accountNumber,
          ifsc: bankDetails.ifsc,
          upi: bankDetails.upi || undefined,
        },
      })
      setApplied(true)
      toast.success('Application submitted!')
    } catch {
      toast.error('Failed to submit application')
    } finally {
      setSubmitting(false)
    }
  }

  if (applied) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <AnimatedPage>
          <div className="text-center max-w-sm mx-auto">
            <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mb-6 shadow-xl shadow-emerald-500/30 animate-bounce">
              <CheckCircle className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white mb-2">Application Submitted!</h1>
            <p className="text-surface-500 dark:text-surface-400 mb-8">We'll review your application and get back to you within 24-48 hours.</p>
            <div className="space-y-3">
              <button onClick={() => navigate('/partner')} className="w-full btn-primary">Go to Dashboard</button>
              <button onClick={() => navigate('/')} className="w-full btn-outline">Back to Home</button>
            </div>
          </div>
        </AnimatedPage>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <AnimatedPage>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-white font-display tracking-tight">Become a Partner</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-1.5 text-sm">Step {step} of 3</p>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={25}>
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                s <= step ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/25' : 'bg-surface-100 dark:bg-surface-800 text-surface-400'
              }`}>
                {s < step ? <CheckCircle className="w-4 h-4" /> : s}
              </div>
              {s < 3 && <div className={`w-8 h-0.5 rounded-full ${s < step ? 'bg-primary-500' : 'bg-surface-200 dark:bg-surface-700'}`} />}
            </div>
          ))}
        </div>
      </AnimatedPage>

      <AnimatedPage delay={50}>
        <GlassCard variant="elevated" padding="lg">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="section-title">Select Services</h2>
              <p className="text-sm text-surface-500">Choose which services you want to offer:</p>
              <button
                onClick={() => setServices((p) => ({ ...p, walking: !p.walking }))}
                className={`w-full p-5 rounded-2xl border-2 text-left transition-all flex items-center gap-4 ${
                  services.walking
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10'
                    : 'border-surface-200 dark:border-surface-700 hover:border-surface-300'
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg flex-shrink-0">
                  <Footprints className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <p className="font-bold font-display text-surface-900 dark:text-white">Walking Buddy</p>
                  <p className="text-sm text-surface-500">Accompany people on walks</p>
                </div>
                {services.walking && <CheckCircle className="w-6 h-6 text-emerald-500" />}
              </button>
              <button
                onClick={() => setServices((p) => ({ ...p, carryBuddy: !p.carryBuddy }))}
                className={`w-full p-5 rounded-2xl border-2 text-left transition-all flex items-center gap-4 ${
                  services.carryBuddy
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/10'
                    : 'border-surface-200 dark:border-surface-700 hover:border-surface-300'
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg flex-shrink-0">
                  <Package className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <p className="font-bold font-display text-surface-900 dark:text-white">CarryBuddy</p>
                  <p className="text-sm text-surface-500">Deliver or carry items</p>
                </div>
                {services.carryBuddy && <CheckCircle className="w-6 h-6 text-amber-500" />}
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="section-title">Bank Details</h2>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Account Holder Name *</label>
                <div className="relative">
                  <FileText className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
                  <input
                    type="text"
                    value={bankDetails.accountName}
                    onChange={(e) => setBankDetails((p) => ({ ...p, accountName: e.target.value }))}
                    placeholder="Name as per bank records"
                    className="input pl-12 py-3.5"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Account Number *</label>
                <div className="relative">
                  <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
                  <input
                    type="text"
                    value={bankDetails.accountNumber}
                    onChange={(e) => setBankDetails((p) => ({ ...p, accountNumber: e.target.value }))}
                    placeholder="Enter account number"
                    className="input pl-12 py-3.5"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">IFSC Code *</label>
                <div className="relative">
                  <FileText className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
                  <input
                    type="text"
                    value={bankDetails.ifsc}
                    onChange={(e) => setBankDetails((p) => ({ ...p, ifsc: e.target.value.toUpperCase() }))}
                    placeholder="e.g., SBIN0001234"
                    className="input pl-12 py-3.5"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">UPI ID (optional)</label>
                <div className="relative">
                  <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
                  <input
                    type="text"
                    value={bankDetails.upi}
                    onChange={(e) => setBankDetails((p) => ({ ...p, upi: e.target.value }))}
                    placeholder="e.g., name@upi"
                    className="input pl-12 py-3.5"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="section-title">Terms & Agreement</h2>
              <div className="p-4 rounded-xl bg-surface-50 dark:bg-surface-800/50 max-h-60 overflow-y-auto">
                <div className="space-y-3 text-sm text-surface-600 dark:text-surface-400">
                  <p>By becoming a RentBuddy Partner, you agree to:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Provide reliable and timely service to users</li>
                    <li>Maintain professional conduct at all times</li>
                    <li>Follow all safety guidelines and procedures</li>
                    <li>Keep your profile and documents up to date</li>
                    <li>Accept payments through the platform only</li>
                    <li>Comply with RentBuddy's partner code of conduct</li>
                  </ul>
                  <p className="mt-4">RentBuddy reserves the right to suspend partners who violate these terms.</p>
                </div>
              </div>
              <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 w-5 h-5 rounded border-surface-300 dark:border-surface-600 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-surface-700 dark:text-surface-300">
                  I have read and agree to the partner terms and conditions
                </span>
              </label>
              {!agreed && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <p className="text-xs text-amber-600 dark:text-amber-400">Please agree to the terms to continue</p>
                </div>
              )}
            </div>
          )}
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={75}>
        <div className="flex gap-3">
          {step > 1 && (
            <button onClick={() => setStep((p) => (p - 1) as Step)} className="flex-1 btn-outline flex items-center justify-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          )}
          {step < 3 ? (
            <button
              onClick={() => setStep((p) => (p + 1) as Step)}
              disabled={!canProceed()}
              className="flex-1 btn-gradient flex items-center justify-center gap-2 disabled:opacity-50"
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting || !canProceed()}
              className="flex-1 btn-gradient flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
                </>
              ) : (
                'Submit Application'
              )}
            </button>
          )}
        </div>
      </AnimatedPage>
    </div>
  )
}
