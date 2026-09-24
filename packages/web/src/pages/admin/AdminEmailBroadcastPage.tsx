import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Send, AlertTriangle, CheckCircle2, XCircle, FlaskConical } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { adminApi } from '../../lib/api'
import { getErrorMessage } from '../../lib/error'

interface BroadcastResult {
  total: number
  sent: number
  failed: number
}

interface EmailStatus {
  provider: string
  configured: boolean
  requiredEnv: string[]
  from: string
}

export function AdminEmailBroadcastPage() {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<'ALL' | 'USERS' | 'PARTNERS'>('ALL')
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<BroadcastResult | null>(null)
  const [status, setStatus] = useState<EmailStatus | null>(null)
  const [testTo, setTestTo] = useState('')
  const [testLoading, setTestLoading] = useState(false)

  useEffect(() => {
    adminApi.getEmailStatus()
      .then((res) => {
        const d = res.data?.data?.email || res.data?.email
        if (d) setStatus(d)
      })
      .catch(() => setStatus(null))
  }, [])

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

  const sendTest = async () => {
    if (!testTo.trim()) {
      toast.error('Enter an email address to send the test to')
      return
    }
    setTestLoading(true)
    try {
      const res = await adminApi.sendTestEmail(testTo.trim())
      toast.success('Test email sent — check the inbox (and spam folder).')
      setStatus(res.data?.data?.email || (res.data?.data?.provider ? { provider: res.data.data.provider, configured: true, requiredEnv: [], from: '' } : status))
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Test email failed'))
    } finally {
      setTestLoading(false)
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

        {status?.configured ? (
          <div className="flex items-start gap-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4 mb-4">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-px shrink-0" />
            <div className="text-sm text-emerald-200">
              <p className="font-semibold text-emerald-300">Email delivery is ready</p>
              <p className="text-xs mt-1 opacity-80">Provider: {status.provider} · From: {status.from}</p>
            </div>
          </div>
        ) : status && (
          <div className="flex items-start gap-3 rounded-2xl bg-red-500/10 border border-red-500/30 p-4 mb-4">
            <XCircle className="w-5 h-5 text-red-400 mt-px shrink-0" />
            <div className="text-sm text-red-200">
              <p className="font-semibold text-red-300">Email delivery is NOT configured — no email can be sent</p>
              <p className="text-xs mt-1 opacity-90">
                Add these environment variables on Render, then deploy:{' '}
                <code className="bg-black/30 rounded px-1 py-0.5">EMAIL_PROVIDER=smtp</code>{' '}
                {status.requiredEnv.map((k) => (<code key={k} className="bg-black/30 rounded px-1 py-0.5 mr-1">{k}</code>))}
                <br />
                Gmail example: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER=nabri.support@gmail.com,
                SMTP_PASS=&lt;Google App Password&gt;, EMAIL_FROM=Nabri &lt;nabri.support@gmail.com&gt;.
              </p>
            </div>
          </div>
        )}

        <div className="bg-gray-900 rounded-2xl p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-300">Test delivery (optional, sends one email)</label>
            <div className="flex gap-2 mt-1">
              <input
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                type="email"
                placeholder="you@example.com"
                className="flex-1 bg-gray-800 rounded-xl px-3 py-2.5 text-white border border-gray-700 focus:border-primary-500 outline-none"
              />
              <button
                onClick={sendTest}
                disabled={testLoading}
                className="flex items-center gap-2 rounded-xl bg-gray-700 hover:bg-gray-600 disabled:opacity-40 px-4 py-2.5 text-sm text-white font-semibold transition shrink-0"
              >
                <FlaskConical className="w-4 h-4" />
                {testLoading ? 'Sending…' : 'Send test'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">Verify the provider works before you broadcast to everyone.</p>
          </div>

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
                  Some deliveries failed — use the test box above to confirm the email provider settings.
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
            <p>This sends a real email to every recipient's inbox immediately. Use a clear subject and avoid sending twice. Admins are usually NOT in the recipient list (only Users + Partners) — use the test box to check your own inbox first.</p>
          </div>
        </div>
      </div>
    </div>
  )
}