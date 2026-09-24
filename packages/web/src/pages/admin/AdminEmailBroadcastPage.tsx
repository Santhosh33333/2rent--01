import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Send, AlertTriangle } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { adminApi } from '../../lib/api'
import { getErrorMessage } from '../../lib/error'

interface BroadcastResult {
  total: number
  sent: number
  failed: number
}

export function AdminEmailBroadcastPage() {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'ALL' | 'USERS' | 'PARTNERS'>('ALL')
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<BroadcastResult | null>(null)

  const send = async () => {
    setLoading(true)
    setResult(null)
    try {
      const res = await adminApi.broadcastEmail({ subject: subject.trim(), body: body.trim(), audience })
      const d = res.data?.data || res.data
      setResult({ total: Number(d?.total) || 0, sent: Number(d?.sent) || 0, failed: Number(d?.failed) || 0 })
      toast.success('Broadcast request completed')
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to send broadcast email'))
    } finally {
      setLoading(false)
      setConfirming(false)
    }
  }

  const canSend = subject.trim().length > 0 && body.trim().length > 0

  return (
    <div className="bg-gray-950 p-4 sm:p-6 rounded-3xl">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold font-display text-white">Email All Users</h1>
            <p className="text-gray-400 text-sm mt-1">Send one email to every user on the platform in a single click</p>
          </div>
        </div>

        <div className="bg-gray-900 rounded-2xl p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-300">Audience</label>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as 'ALL' | 'USERS' | 'PARTNERS')}
              className="mt-1 w-full bg-gray-800 rounded-xl px-3 py-2.5 text-white border border-gray-700 focus:border-primary-500 outline-none"
            >
              <option value="ALL">All users (Users + Partners)</option>
              <option value="USERS">Users only</option>
              <option value="PARTNERS">Partners only</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-300">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={120}
              placeholder="e.g. New feature is live on Nabri!"
              className="mt-1 w-full bg-gray-800 rounded-xl px-3 py-2.5 text-white border border-gray-700 focus:border-primary-500 outline-none"
            />
            <p className="text-xs text-gray-500 mt-1 text-right">{subject.length}/120</p>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-300">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={5000}
              rows={8}
              placeholder="Write the announcement. Plain text and line breaks are fine."
              className="mt-1 w-full bg-gray-800 rounded-xl px-3 py-2.5 text-white border border-gray-700 focus:border-primary-500 outline-none resize-y"
            />
            <p className="text-xs text-gray-500 mt-1 text-right">{body.length}/5000</p>
          </div>

          {result && (
            <div className="rounded-xl bg-gray-800 p-4 text-sm text-gray-300">
              <p className="font-semibold text-white mb-1">Send finished</p>
              <p>
                Total recipients: {result.total} · Sent:{' '}
                <span className="text-emerald-400">{result.sent}</span> · Failed:{' '}
                <span className={result.failed > 0 ? 'text-red-400' : 'text-gray-300'}>{result.failed}</span>
              </p>
              {result.failed > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Some deliveries failed — check the email provider configuration (SMTP/Resend) on the server.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => { setConfirming(true); setResult(null) }}
              disabled={!canSend || loading}
              className="flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-40 px-5 py-2.5 text-white font-semibold transition"
            >
              <Send className="w-4 h-4" />
              {loading ? 'Sending…' : confirming ? 'Tap again to confirm' : 'Send email to all users'}
            </button>
            {confirming && (
              <button
                onClick={send}
                disabled={loading}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-white font-semibold transition"
              >
                Yes, send now
              </button>
            )}
            {confirming && (
              <button
                onClick={() => setConfirming(false)}
                disabled={loading}
                className="rounded-xl bg-gray-800 hover:bg-gray-700 px-5 py-2.5 text-gray-300 font-semibold transition"
              >
                Cancel
              </button>
            )}
          </div>

          <div className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-500/10 rounded-xl p-3">
            <AlertTriangle className="w-4 h-4 mt-px shrink-0" />
            <p>This sends a real email to every recipient's inbox immediately. Use a clear subject and avoid sending twice.</p>
          </div>
        </div>
      </div>
    </div>
  )
}