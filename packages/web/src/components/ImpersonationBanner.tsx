import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Eye, LogOut, ShieldCheck } from 'lucide-react'

export function ImpersonationBanner() {
  const { impersonating, stopImpersonation } = useAuth()
  const navigate = useNavigate()

  if (!impersonating) return null

  const exit = async () => {
    await stopImpersonation()
    navigate('/admin/dashboard', { replace: true })
  }

  return (
    <div className="sticky top-0 inset-x-0 z-[60] bg-amber-500 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2 font-medium min-w-0">
          <Eye className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">
            Viewing as <b>{impersonating.userName}</b>
            <span className="hidden sm:inline text-white/80"> · {impersonating.userEmail}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={exit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition-colors whitespace-nowrap"
        >
          <LogOut className="w-3.5 h-3.5" />
          Exit
        </button>
      </div>
    </div>
  )
}

export function ImpersonationIndicator() {
  const { impersonating } = useAuth()
  if (!impersonating) return null
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-medium">
      <ShieldCheck className="w-3 h-3" />
      Impersonating
    </span>
  )
}