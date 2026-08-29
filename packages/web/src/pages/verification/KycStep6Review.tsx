import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Send, Loader2, AlertTriangle, CheckCircle, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'

interface KycStatus {
  status: string
  progress: number
  step: number
  totalSteps: number
  documents: {
    personalDetails: boolean
    govId: boolean
    govIdType?: string
    selfie: boolean
    addressProof: boolean
    emergencyContact: boolean
    emergencyContactName?: string
    emergencyContactPhone?: string
    emergencyContactRelation?: string
  }
}

export function KycStep6Review() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [kycData, setKycData] = useState<KycStatus | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await api.get('/verification/status')
        setKycData(res.data?.data)
      } catch (err) {
        toast.error('Failed to load KYC data')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const handleSubmit = async () => {
    if (!kycData?.documents.personalDetails || !kycData?.documents.govId || 
        !kycData?.documents.selfie || !kycData?.documents.addressProof || 
        !kycData?.documents.emergencyContact) {
      toast.error('All documents are required')
      return
    }

    setSubmitting(true)
    try {
      await api.post('/verification/submit')
      toast.success('KYC submitted for verification!')
      navigate('/verification')
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to submit KYC'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary-500 mx-auto mb-3" />
          <p className="text-surface-600 dark:text-surface-400">Loading your KYC data...</p>
        </div>
      </div>
    )
  }

  const allDocumentsReady = kycData?.documents.personalDetails && 
                           kycData?.documents.govId && 
                           kycData?.documents.selfie && 
                           kycData?.documents.addressProof && 
                           kycData?.documents.emergencyContact

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/verification/step5')} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-surface-600 dark:text-surface-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Review & Submit</h1>
            <p className="text-sm text-surface-500">Step 6 of 7</p>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={50}>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-500/10 to-accent-500/10 p-6 border border-primary-200 dark:border-primary-800">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h2 className="font-bold text-surface-900 dark:text-white">Review your information</h2>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                Make sure everything is correct before submitting for verification.
              </p>
            </div>
          </div>
        </div>
      </AnimatedPage>

      {/* Progress */}
      <AnimatedPage delay={100}>
        {kycData && (
          <GlassCard variant="elevated" padding="lg">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-surface-900 dark:text-white">KYC Progress</h3>
                <span className="text-sm text-surface-600 dark:text-surface-400">{kycData.progress}%</span>
              </div>
              <div className="w-full h-3 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all duration-500"
                  style={{ width: `${kycData.progress}%` }}
                />
              </div>
            </div>

            {/* Document Checklist */}
            <div className="space-y-2">
              <div className={`p-3 rounded-xl flex items-center gap-3 ${kycData.documents.personalDetails ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-surface-100 dark:bg-surface-800'}`}>
                <CheckCircle className={`w-5 h-5 flex-shrink-0 ${kycData.documents.personalDetails ? 'text-emerald-500' : 'text-surface-400'}`} />
                <span className={kycData.documents.personalDetails ? 'text-emerald-700 dark:text-emerald-300' : 'text-surface-600 dark:text-surface-400'}>
                  Personal Details
                </span>
              </div>

              <div className={`p-3 rounded-xl flex items-center gap-3 ${kycData.documents.govId ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-surface-100 dark:bg-surface-800'}`}>
                <CheckCircle className={`w-5 h-5 flex-shrink-0 ${kycData.documents.govId ? 'text-emerald-500' : 'text-surface-400'}`} />
                <span className={kycData.documents.govId ? 'text-emerald-700 dark:text-emerald-300' : 'text-surface-600 dark:text-surface-400'}>
                  Government ID {kycData.documents.govIdType && `(${kycData.documents.govIdType})`}
                </span>
              </div>

              <div className={`p-3 rounded-xl flex items-center gap-3 ${kycData.documents.selfie ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-surface-100 dark:bg-surface-800'}`}>
                <CheckCircle className={`w-5 h-5 flex-shrink-0 ${kycData.documents.selfie ? 'text-emerald-500' : 'text-surface-400'}`} />
                <span className={kycData.documents.selfie ? 'text-emerald-700 dark:text-emerald-300' : 'text-surface-600 dark:text-surface-400'}>
                  Selfie Verification
                </span>
              </div>

              <div className={`p-3 rounded-xl flex items-center gap-3 ${kycData.documents.addressProof ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-surface-100 dark:bg-surface-800'}`}>
                <CheckCircle className={`w-5 h-5 flex-shrink-0 ${kycData.documents.addressProof ? 'text-emerald-500' : 'text-surface-400'}`} />
                <span className={kycData.documents.addressProof ? 'text-emerald-700 dark:text-emerald-300' : 'text-surface-600 dark:text-surface-400'}>
                  Address Proof
                </span>
              </div>

              <div className={`p-3 rounded-xl flex items-center gap-3 ${kycData.documents.emergencyContact ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-surface-100 dark:bg-surface-800'}`}>
                <CheckCircle className={`w-5 h-5 flex-shrink-0 ${kycData.documents.emergencyContact ? 'text-emerald-500' : 'text-surface-400'}`} />
                <span className={kycData.documents.emergencyContact ? 'text-emerald-700 dark:text-emerald-300' : 'text-surface-600 dark:text-surface-400'}>
                  Emergency Contact {kycData.documents.emergencyContactName && `(${kycData.documents.emergencyContactName})`}
                </span>
              </div>
            </div>
          </GlassCard>
        )}
      </AnimatedPage>

      {/* Warning if incomplete */}
      {!allDocumentsReady && (
        <AnimatedPage delay={150}>
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-amber-900 dark:text-amber-300">Incomplete Submission</h3>
              <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                All documents are required before submission. Please complete all previous steps.
              </p>
            </div>
          </div>
        </AnimatedPage>
      )}

      {/* Submit Button */}
      <AnimatedPage delay={200}>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/verification/step5')}
            className="flex-1 btn-secondary"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !allDocumentsReady}
            className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Submit for Verification
              </>
            )}
          </button>
        </div>
      </AnimatedPage>

      {/* Info */}
      <AnimatedPage delay={250}>
        <GlassCard variant="elevated" padding="lg" className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500">
          <h3 className="font-bold text-blue-900 dark:text-blue-300 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            What happens next?
          </h3>
          <ol className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
            <li>1. Your documents are submitted to our verification team</li>
            <li>2. We verify your documents within 1-2 business days</li>
            <li>3. You'll receive an email notification of the result</li>
            <li>4. Once approved, you unlock full access to RentBuddy features</li>
          </ol>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}