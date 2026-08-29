import { getErrorMessage } from '../../lib/error'
import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShieldCheck, ArrowLeft, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'SUPPORT', 'FINANCE']

export function AdminLoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      // Re-fetch user to verify admin role
      const userRes = await api.get('/users/profile')
      const user = userRes.data?.data || {}
      const role = String(user.activeRole || user.role || 'USER').toUpperCase()
      if (!ADMIN_ROLES.includes(role)) {
        setError('This account does not have admin access. Use the regular sign-in instead.')
        return
      }
      localStorage.setItem('activeRole', role)
      navigate('/admin/dashboard', { replace: true })
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Invalid admin credentials.')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 px-6">
      <div className="w-full max-w-sm">
        <Link to="/account-type" className="inline-flex items-center gap-1 text-sm text-surface-400 hover:text-surface-200 mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>

        <div className="text-center mb-10">
          <div className="w-16 h-16 mx-auto mb-5 rounded-[20px] bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-xl shadow-emerald-500/25">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-white">Admin Access</h1>
          <p className="mt-2 text-sm text-surface-400">Secure portal for provisioned administrators only.</p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm text-center">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="admin-email" className="block text-xs font-medium uppercase tracking-wider text-surface-400 mb-2">Admin Email</label>
            <input
              id="admin-email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-surface-900 border border-surface-700 text-white placeholder:text-surface-600 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition"
              placeholder="admin@rentbuddy.app"
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="block text-xs font-medium uppercase tracking-wider text-surface-400 mb-2">Password</label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 rounded-xl bg-surface-900 border border-surface-700 text-white placeholder:text-surface-600 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300 transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3.5 mt-2 rounded-xl font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 shadow-lg shadow-emerald-500/25 transition-all active:scale-[0.98] ${loading ? 'opacity-60 pointer-events-none' : ''}`}
          >
            {loading ? 'Verifying…' : 'Sign in to Admin Portal'}
          </button>
        </form>

        <p className="mt-8 text-xs text-center text-surface-500">
          No admin account? It can only be created by the platform owner from inside the admin portal.
        </p>
      </div>
    </div>
  )
}