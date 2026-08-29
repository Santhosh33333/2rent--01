import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle, Clock, XCircle,
  DollarSign, Briefcase, TrendingUp, Award,
  FileCheck, Shield, UserCheck, BookOpen,
  Loader2, AlertTriangle
} from 'lucide-react'
import { AnimatedPage } from '../../components/AnimatedPage'
import { api } from '../../lib/api'

interface StatusData {
  status: string
  totalWalks?: number
  totalEarnings?: number
  rating?: number
  reason?: string
}

interface EarningsData {
  totalEarnings: number
  totalWalks: number
  rating: number
  completedWalks: number
}

interface Step {
  name: string
  status: 'verified' | 'pending' | 'not-started'
  date: string | null
  icon: typeof CheckCircle
}

const statusMeta = {
  verified: { color: 'bg-emerald-500', ring: 'ring-emerald-500/30', icon: CheckCircle, label: 'Completed' },
  pending: { color: 'bg-amber-500', ring: 'ring-amber-500/30', icon: Clock, label: 'In Progress' },
  'not-started': { color: 'bg-surface-300 dark:bg-surface-600', ring: 'ring-surface-300/30 dark:ring-surface-600/30', icon: XCircle, label: 'Not Started' },
}

function getStepsForStatus(status: string): Step[] {
  switch (status) {
    case 'APPROVED':
      return [
        { name: 'Application Submitted', status: 'verified', date: null, icon: FileCheck },
        { name: 'Background Check', status: 'verified', date: null, icon: Shield },
        { name: 'Interview', status: 'verified', date: null, icon: UserCheck },
        { name: 'Training', status: 'verified', date: null, icon: BookOpen },
      ]
    case 'APPLIED':
      return [
        { name: 'Application Submitted', status: 'verified', date: null, icon: FileCheck },
        { name: 'Background Check', status: 'pending', date: null, icon: Shield },
        { name: 'Interview', status: 'not-started', date: null, icon: UserCheck },
        { name: 'Training', status: 'not-started', date: null, icon: BookOpen },
      ]
    case 'REJECTED':
      return [
        { name: 'Application Submitted', status: 'verified', date: null, icon: FileCheck },
        { name: 'Background Check', status: 'not-started', date: null, icon: Shield },
        { name: 'Interview', status: 'not-started', date: null, icon: UserCheck },
        { name: 'Training', status: 'not-started', date: null, icon: BookOpen },
      ]
    default:
      return [
        { name: 'Application Submitted', status: 'not-started', date: null, icon: FileCheck },
        { name: 'Background Check', status: 'not-started', date: null, icon: Shield },
        { name: 'Interview', status: 'not-started', date: null, icon: UserCheck },
        { name: 'Training', status: 'not-started', date: null, icon: BookOpen },
      ]
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'APPROVED':
      return { icon: CheckCircle, label: 'Approved', className: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' }
    case 'APPLIED':
      return { icon: Clock, label: 'In Review', className: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' }
    case 'REJECTED':
      return { icon: XCircle, label: 'Rejected', className: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' }
    default:
      return { icon: FileCheck, label: 'Not Applied', className: 'bg-surface-100 dark:bg-surface-800 text-surface-500' }
  }
}

export function StatusPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [statusData, setStatusData] = useState<StatusData | null>(null)
  const [earningsData, setEarningsData] = useState<EarningsData | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statusRes, earningsRes] = await Promise.all([
          api.get('/walking-partner/status'),
          api.get('/walking-partner/earnings'),
        ])
        setStatusData(statusRes.data)
        setEarningsData(earningsRes.data)
      } catch {
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-fadeInUp">
        <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group">
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          <span className="text-sm">Back to Dashboard</span>
        </button>
        <div className="glass-card p-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      </div>
    )
  }

  const status = statusData?.status || 'NONE'
  const steps = getStepsForStatus(status)
  const completedSteps = steps.filter(s => s.status === 'verified').length
  const totalSteps = steps.length
  const progress = (completedSteps / totalSteps) * 100
  const badge = getStatusBadge(status)

  if (status === 'NONE') {
    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-fadeInUp">
        <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group">
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          <span className="text-sm">Back to Dashboard</span>
        </button>
        <AnimatedPage>
          <div className="glass-card p-12 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center mb-4">
              <FileCheck className="w-8 h-8 text-surface-400" />
            </div>
            <h2 className="text-xl font-bold text-surface-900 dark:text-white mb-2">You haven't applied yet</h2>
            <p className="text-surface-500 mb-6 max-w-sm mx-auto">Become a walking partner and start earning by helping others with their daily walks.</p>
            <button onClick={() => navigate('/walking-partner/apply')} className="btn-primary">
              Apply Now
            </button>
          </div>
        </AnimatedPage>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fadeInUp">
      <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group">
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back to Dashboard</span>
      </button>

      <AnimatedPage>
        <div className="glass-card overflow-hidden">
          <div className="relative px-6 md:px-8 pt-8 pb-6 bg-gradient-to-br from-primary-500/20 via-accent-500/10 to-surface-100 dark:from-primary-900/20 dark:via-accent-900/10 dark:to-surface-900">
            <div className="absolute inset-0 bg-grid opacity-20" />
            <div className="relative flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/30 shrink-0">
                <Award className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Application Status</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                    <badge.icon className="w-3 h-3" />
                    {badge.label}
                  </span>
                  <span className="text-xs text-surface-500">
                    {completedSteps} of {totalSteps} steps completed
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 md:px-8 -mt-3">
            <div className="bg-white dark:bg-surface-800/80 rounded-2xl p-5 shadow-sm border border-surface-200/50 dark:border-surface-700/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-surface-500">Overall Progress</span>
                <span className="text-xs font-semibold text-surface-900 dark:text-white">{Math.round(progress)}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent-500 transition-all duration-1000 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>

          {status === 'REJECTED' && statusData?.reason && (
            <div className="px-6 md:px-8 mt-4">
              <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200/50 dark:border-red-800/50">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-700 dark:text-red-300">Rejection Reason</p>
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">{statusData.reason}</p>
                </div>
              </div>
            </div>
          )}

          <div className="px-6 md:px-8 pb-8 mt-4">
            <div className="bg-white dark:bg-surface-800/80 rounded-2xl p-6 shadow-sm border border-surface-200/50 dark:border-surface-700/50">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-white mb-6">Application Timeline</h2>
              <div className="relative">
                <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-surface-200 dark:bg-surface-700" />
                <div className="space-y-6">
                  {steps.map((step) => {
                    const meta = statusMeta[step.status]
                    const StepIcon = step.icon
                    const StatusIcon = meta.icon
                    return (
                      <div key={step.name} className="relative flex items-start gap-4">
                        <div className={`relative z-10 w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          step.status === 'verified'
                            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                            : step.status === 'pending'
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                            : 'bg-surface-100 dark:bg-surface-800 text-surface-400'
                        }`}>
                          <StepIcon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0 pt-1">
                          <div className="flex items-center justify-between">
                            <p className={`text-sm font-medium ${
                              step.status === 'verified'
                                ? 'text-surface-900 dark:text-white'
                                : step.status === 'pending'
                                ? 'text-amber-700 dark:text-amber-300'
                                : 'text-surface-400'
                            }`}>
                              {step.name}
                            </p>
                            <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                              step.status === 'verified'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : step.status === 'pending'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-surface-400'
                            }`}>
                              <StatusIcon className="w-3 h-3" />
                              {meta.label}
                            </span>
                          </div>
                          {step.date && (
                            <p className="text-xs text-surface-400 mt-0.5">{step.date}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </AnimatedPage>

      {status === 'APPROVED' && earningsData && (
        <AnimatedPage delay={100}>
          <div className="glass-card p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Earnings Overview</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="glass-card-sm p-4 text-center">
                <DollarSign className="w-5 h-5 text-primary-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-surface-900 dark:text-white">₹{earningsData.totalEarnings.toLocaleString()}</p>
                <p className="text-xs text-surface-500">Total Earnings</p>
              </div>
              <div className="glass-card-sm p-4 text-center">
                <Briefcase className="w-5 h-5 text-accent-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-surface-900 dark:text-white">{earningsData.completedWalks}</p>
                <p className="text-xs text-surface-500">Walks Completed</p>
              </div>
              <div className="glass-card-sm p-4 text-center">
                <Award className="w-5 h-5 text-amber-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-surface-900 dark:text-white">{earningsData.rating > 0 ? earningsData.rating.toFixed(1) : '—'}</p>
                <p className="text-xs text-surface-500">Avg Rating</p>
              </div>
              <div className="glass-card-sm p-4 text-center">
                <TrendingUp className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-surface-900 dark:text-white">
                  {earningsData.completedWalks > 0 ? `₹${(earningsData.totalEarnings / earningsData.completedWalks).toFixed(2)}` : '₹0'}
                </p>
                <p className="text-xs text-surface-500">Avg Per Walk</p>
              </div>
            </div>
          </div>
        </AnimatedPage>
      )}
    </div>
  )
}
