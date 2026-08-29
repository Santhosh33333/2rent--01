import { getErrorMessage } from '../lib/error'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRole, ROLE_META, UserRole } from '../lib/roleContext'
import { RefreshCw, Check, ChevronDown, ArrowRight } from 'lucide-react'

const ROLE_DASHBOARDS: Record<string, string> = {
  USER: '/dashboard',
  PARTNER: '/partner/dashboard',
  ADMIN: '/admin/dashboard',
  SUPER_ADMIN: '/admin/dashboard',
  MODERATOR: '/admin/dashboard',
  SUPPORT: '/admin/dashboard',
  FINANCE: '/admin/dashboard',
}

export function RoleSwitcher() {
  const { approvedRoles, activeRole, switchRole } = useRole()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Only show roles the user is approved for
  const availableRoles: UserRole[] = ['USER', ...approvedRoles.filter(r => r !== 'USER')]

  // Only show switcher if user has multiple approved roles
  if (availableRoles.length <= 1) {
    return null
  }

  const handleSwitch = async (role: UserRole) => {
    if (role === activeRole) {
      setIsOpen(false)
      return
    }
    setSwitching(true)
    setMessage(null)
    try {
      await switchRole(role)
      setMessage({ type: 'success', text: `Switched to ${ROLE_META[role]?.label || role}` })
      setIsOpen(false)
      const dashboard = ROLE_DASHBOARDS[role] || '/dashboard'
      navigate(dashboard, { replace: true })
    } catch (err: unknown) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Failed to switch role') })
    } finally {
      setSwitching(false)
    }
  }

  const currentMeta = ROLE_META[activeRole] || ROLE_META.USER

  return (
    <div className="relative">
      <button
        onClick={() => { setIsOpen(!isOpen); setMessage(null) }}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-glass hover:bg-glass-elevated transition-all duration-200 text-sm font-medium"
        disabled={switching}
      >
        <span className="text-base">{currentMeta.icon}</span>
        <span className="hidden sm:inline">{currentMeta.label}</span>
        {switching ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
        ) : (
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 mt-2 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="p-3 border-b border-gray-100 dark:border-gray-800">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Switch Role</p>
            </div>

            {message && (
              <div className={`px-4 py-2 text-xs font-medium ${
                message.type === 'success'
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
              }`}>
                {message.text}
              </div>
            )}
            
            <div className="p-2 max-h-80 overflow-y-auto">
              {availableRoles.map((role) => {
                const meta = ROLE_META[role]
                if (!meta) return null
                const isActive = role === activeRole

                return (
                  <div key={role}>
                    <button
                      onClick={() => {
                        if (isActive) { setIsOpen(false); return }
                        handleSwitch(role)
                      }}
                      disabled={switching}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                        isActive
                          ? 'bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span className="text-xl">{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">{meta.label}</span>
                          {isActive && <Check className="w-3.5 h-3.5 text-indigo-500" />}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{meta.description}</p>
                      </div>
                      {isActive ? (
                        <span className="text-xs text-indigo-500 font-medium">Active</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                          Switch <ArrowRight className="w-3 h-3" />
                        </span>
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}