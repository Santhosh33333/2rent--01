import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Dog, MapPin, Calendar, Clock, DollarSign,
  Loader2, AlertTriangle, CheckCircle, XCircle,
  MessageCircle, Phone, Star, Shield
} from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'

interface RequestDetail {
  id: number
  type: 'walking' | 'companionship'
  location: string
  date: string
  time: string
  status: 'open' | 'accepted' | 'completed'
  reward: number
  description: string
  requester: { name: string; avatar?: string; rating?: number }
  acceptedBy?: { name: string; avatar?: string }
}

const statusConfig = {
  open: { label: 'Open', icon: Dog, class: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' },
  accepted: { label: 'Accepted', icon: CheckCircle, class: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' },
  completed: { label: 'Completed', icon: CheckCircle, class: 'bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-400' },
}

export function WalkingRequestDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [request, setRequest] = useState<RequestDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    const fetchRequest = async () => {
      try {
        const res = await api.get(`/walking-requests/${id}`)
        const data = res.data?.data || res.data
        setRequest(data)
      } catch {
        setError('Failed to load request details')
      } finally {
        setLoading(false)
      }
    }
    if (id) fetchRequest()
  }, [id])

  const handleAction = async (action: 'accept' | 'complete' | 'cancel') => {
    if (!request) return
    setActionLoading(action)
    try {
      await api.post(`/walking-requests/${id}/${action}`)
      const newStatus = action === 'accept' ? 'accepted' : action === 'complete' ? 'completed' : 'open'
      setRequest({ ...request, status: newStatus as RequestDetail['status'] })
      toast.success(`Request ${action === 'accept' ? 'accepted' : action === 'complete' ? 'completed' : 'cancelled'} successfully`)
    } catch {
      toast.error(`Failed to ${action} request`)
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-fadeInUp">
        <div className="h-10 w-32 bg-surface-100 dark:bg-surface-800 rounded-xl animate-pulse" />
        <div className="glass-card p-8">
          <div className="flex justify-between items-start mb-6">
            <div className="space-y-2">
              <div className="h-7 w-56 bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
              <div className="h-4 w-40 bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
            </div>
            <div className="h-6 w-20 bg-surface-100 dark:bg-surface-800 rounded-full animate-pulse" />
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="space-y-1">
                <div className="h-3 w-16 bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
                <div className="h-4 w-28 bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
              </div>
            ))}
          </div>
          <div className="h-4 w-full bg-surface-100 dark:bg-surface-800 rounded animate-pulse mb-2" />
          <div className="h-4 w-3/4 bg-surface-100 dark:bg-surface-800 rounded animate-pulse mb-6" />
          <div className="flex gap-3">
            <div className="h-11 w-36 bg-surface-100 dark:bg-surface-800 rounded-xl animate-pulse" />
            <div className="h-11 w-36 bg-surface-100 dark:bg-surface-800 rounded-xl animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !request) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-fadeInUp">
        <button onClick={() => navigate('/walking-requests')} className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Requests
        </button>
        <div className="glass-card p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-500 font-medium mb-2">Failed to Load</p>
          <p className="text-sm text-surface-500 mb-4">{error || 'Request not found'}</p>
          <button onClick={() => navigate('/walking-requests')} className="btn-primary btn-sm">
            Back to Requests
          </button>
        </div>
      </div>
    )
  }

  const StatusIcon = statusConfig[request.status].icon
  const isOpen = request.status === 'open'
  const isAccepted = request.status === 'accepted'
  const isCompleted = request.status === 'completed'

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fadeInUp">
      {/* Back Button */}
      <button
        onClick={() => navigate('/walking-requests')}
        className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back to Requests</span>
      </button>

      {/* Main Card */}
      <div className="glass-card overflow-hidden">
        {/* Gradient Header */}
        <div className="h-32 bg-gradient-to-br from-primary-500/20 via-accent-500/10 to-surface-100 dark:from-primary-900/20 dark:via-accent-900/10 dark:to-surface-900 relative">
          <div className="absolute inset-0 bg-grid opacity-20" />
        </div>

        <div className="p-6 md:p-8 -mt-16 relative">
          {/* Icon + Status */}
          <div className="flex items-start justify-between mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/30">
              <Dog className="w-8 h-8 text-white" />
            </div>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${statusConfig[request.status].class}`}>
              <StatusIcon className="w-4 h-4" />
              {statusConfig[request.status].label}
            </span>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white capitalize mb-1">
            {request.type} Request
          </h1>
          <p className="text-sm text-surface-500">Request #{request.id}</p>

          {/* Details Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div className="glass-card-sm p-3 text-center">
              <Calendar className="w-4 h-4 text-primary-500 mx-auto mb-1" />
              <p className="text-[10px] text-surface-400">Date</p>
              <p className="text-xs font-medium text-surface-900 dark:text-white">
                {format(new Date(request.date), 'MMM d, yyyy')}
              </p>
            </div>
            <div className="glass-card-sm p-3 text-center">
              <Clock className="w-4 h-4 text-accent-500 mx-auto mb-1" />
              <p className="text-[10px] text-surface-400">Time</p>
              <p className="text-xs font-medium text-surface-900 dark:text-white">
                {request.time || 'Flexible'}
              </p>
            </div>
            <div className="glass-card-sm p-3 text-center">
              <MapPin className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
              <p className="text-[10px] text-surface-400">Location</p>
              <p className="text-xs font-medium text-surface-900 dark:text-white truncate">
                {request.location}
              </p>
            </div>
            <div className="glass-card-sm p-3 text-center">
              <DollarSign className="w-4 h-4 text-violet-500 mx-auto mb-1" />
              <p className="text-[10px] text-surface-400">Reward</p>
              <p className="text-xs font-bold text-surface-900 dark:text-white">
                ₹{request.reward.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Description */}
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-surface-900 dark:text-white mb-2">Description</h2>
            <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
              {request.description || 'No description provided.'}
            </p>
          </div>

          {/* Requester Info */}
          <div className="mt-4 p-4 rounded-xl bg-surface-50 dark:bg-surface-800/50">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500/20 to-accent-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 font-semibold text-lg">
                {request.requester.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1">
                <p className="text-xs text-surface-400">Requested by</p>
                <p className="text-sm font-medium text-surface-900 dark:text-white">{request.requester.name}</p>
                {request.requester.rating && (
                  <span className="flex items-center gap-1 text-xs text-amber-500 mt-0.5">
                    <Star className="w-3 h-3 fill-current" />
                    {request.requester.rating.toFixed(1)}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button className="w-9 h-9 rounded-xl bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 flex items-center justify-center text-surface-500 hover:text-primary-600 transition-colors">
                  <MessageCircle className="w-4 h-4" />
                </button>
                <button className="w-9 h-9 rounded-xl bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 flex items-center justify-center text-surface-500 hover:text-emerald-600 transition-colors">
                  <Phone className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Accepted By */}
          {request.acceptedBy && (
            <div className="mt-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 font-semibold text-sm">
                  {request.acceptedBy.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <p className="text-xs text-amber-600 dark:text-amber-400">Accepted by</p>
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-200">{request.acceptedBy.name}</p>
                </div>
                <Shield className="w-4 h-4 text-amber-500 ml-auto" />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-3 mt-6">
            {isOpen && (
              <>
                <button
                  onClick={() => handleAction('accept')}
                  disabled={actionLoading !== null}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-primary-500 to-accent-500 text-white text-sm font-medium shadow-lg shadow-primary-500/20 hover:shadow-xl hover:shadow-primary-500/30 transition-all duration-200 flex items-center justify-center gap-2"
                >
                  {actionLoading === 'accept' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <><CheckCircle className="w-4 h-4" /> Accept Request</>
                  )}
                </button>
                <button
                  onClick={() => navigate('/walking-requests')}
                  className="px-6 py-3 rounded-xl bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 text-sm font-medium hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
                >
                  Decline
                </button>
              </>
            )}
            {isAccepted && (
              <>
                <button
                  onClick={() => handleAction('complete')}
                  disabled={actionLoading !== null}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-medium shadow-lg shadow-emerald-500/20 hover:shadow-xl hover:shadow-emerald-500/30 transition-all duration-200 flex items-center justify-center gap-2"
                >
                  {actionLoading === 'complete' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <><CheckCircle className="w-4 h-4" /> Mark Complete</>
                  )}
                </button>
                <button
                  onClick={() => handleAction('cancel')}
                  disabled={actionLoading !== null}
                  className="px-6 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors flex items-center gap-2"
                >
                  {actionLoading === 'cancel' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <><XCircle className="w-4 h-4" /> Cancel</>
                  )}
                </button>
              </>
            )}
            {isCompleted && (
              <div className="w-full p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50 text-center">
                <p className="text-sm text-surface-500">This request has been completed</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
