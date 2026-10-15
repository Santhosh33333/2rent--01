import { getErrorMessage } from '../lib/error'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRole, ROLE_META, UserRole } from '../lib/roleContext'
import { isAdminTierRole } from '../lib/roles'
import { dashboardForRole } from '../lib/roles'
import { RefreshCw, Check, ChevronDown, ArrowRight, Shield } from 'lucide-react'

export function RoleSwitcher({ variant = 'header' }: { variant?: 'header' | 'settings' } = {}) {
  const { approvedRoles, activeRole, accountRole, switchRole } = useRole()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Only show roles the user is approved for
  const availableRoles: UserRole[] = ['USER', ...approvedRoles.filter(r => r !== 'USER')]

  // Admin-tier accounts can preview the PARTNER view: the backend
  // auto-provisions an APPROVED partner profile when they switch.
  const isAdminTier = availableRoles.some(r => isAdminTierRole(r))
  if (isAdminTier && !availableRoles.includes('PARTNER')) {
    availableRoles.push('PARTNER')
  }

  const isUserOnly = availableRoles.length <= 1

  // This control used to live in the header, where it crowded the "Nabri."
  // wordmark on narrow phones. It now sits in Settings and only renders when
  // there is a genuine switch to offer: an admin-tier account, or a user with a
  // second approved role (e.g. an approved partner). A plain user has nothing
  // to switch between, so no role control is shown to them at all - the
  // "Become a partner" path is a normal nav entry instead (see tabs.ts).
  if (isUserOnly) {
    return null
  }

  // An admin previewing a customer/partner surface needs a one-click way back,
  // otherwise the preview looks like a demotion and there is no way out of it.
  const previewingFromAdmin = isAdminTierRole(accountRole) && !isAdminTierRole(activeRole)

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
      navigate(dashboardForRole(role), { replace: true })
    } catch (err: unknown) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Failed to switch role') })
    } finally {
      setSwitching(false)
    }
  }

  const currentMeta = ROLE_META[activeRole] || ROLE_META.USER

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      {previewingFromAdmin && (
        <button
          onClick={() => handleSwitch(accountRole)}
          disabled={switching}
          title={`Return to ${ROLE_META[accountRole]?.label || accountRole}`}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors disabled:opacity-60"
        >
          <Shield className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{ROLE_META[accountRole]?.label || accountRole}</span>
        </button>
      )}
      <button
        onClick={() => { setIsOpen(!isOpen); setMessage(null) }}
        className={`flex items-center gap-2 rounded-xl bg-surface-100 px-3 py-2 text-sm font-medium transition-all duration-200 hover:bg-surface-200 dark:bg-surface-800 dark:hover:bg-surface-700 ${
          variant === 'settings' ? 'w-full justify-between' : ''
        }`}
        disabled={switching}
      >
        <span className="flex items-center gap-2">
          <span className="text-base">{currentMeta.icon}</span>
          <span className={variant === 'settings' ? 'inline' : 'hidden sm:inline'}>{currentMeta.label}</span>
        </span>
        {switching ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
        ) : (
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className={
            variant === 'settings'
              // In Settings the switcher sits inside a GlassCard, which is
              // `overflow-hidden`. An absolutely positioned panel was clipped by
              // the card, so the menu appeared cut off ("half hidden"). Rendering
              // it in-flow (w-full wraps under the button) keeps it fully visible.
              ? 'relative z-50 mt-2 w-full bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-2xl shadow-xl overflow-hidden'
              : 'absolute top-full left-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-2xl shadow-2xl z-50 overflow-hidden animate-fade-in duration-200'
          }>
            <div className="p-3 border-b border-surface-100 dark:border-surface-800">
              <p className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Switch Role</p>
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
                          ? 'bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-700'
                          : 'hover:bg-surface-50 dark:hover:bg-surface-800'
                      }`}
                    >
                      <span className="text-xl">{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-surface-900 dark:text-surface-50">{meta.label}</span>
                          {isActive && <Check className="w-3.5 h-3.5 text-primary-500" />}
                        </div>
                        <p className="text-xs text-surface-500 dark:text-surface-400 truncate">{meta.description}</p>
                      </div>
                      {isActive ? (
                        <span className="text-xs text-primary-500 font-medium">Active</span>
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