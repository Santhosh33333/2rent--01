import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Handshake, ShieldCheck, ArrowRight, Check } from 'lucide-react'

type AccountType = 'USER' | 'PARTNER' | 'ADMIN'

const OPTIONS: Array<{
  key: AccountType
  icon: typeof User
  title: string
  description: string
  gradient: string
  selectedRing: string
}> = [
  {
    key: 'USER',
    icon: User,
    title: 'USER',
    description: 'Find people, events, movies, communities and book services',
    gradient: 'from-primary-500 to-primary-700',
    selectedRing: 'border-primary-500 bg-primary-500/10 ring-2 ring-primary-500/40',
  },
  {
    key: 'PARTNER',
    icon: Handshake,
    title: 'PARTNER',
    description: 'Provide Walking Buddy and CarryBuddy services',
    gradient: 'from-accent-400 to-accent-600',
    selectedRing: 'border-accent-500 bg-accent-500/10 ring-2 ring-accent-500/40',
  },
  {
    key: 'ADMIN',
    icon: ShieldCheck,
    title: 'ADMIN',
    description: 'Platform administration',
    gradient: 'from-emerald-500 to-emerald-700',
    selectedRing: 'border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500/40',
  },
]

export function AccountTypePage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<AccountType | null>(null)
  const [navigating, setNavigating] = useState(false)

  const handleContinue = () => {
    if (!selected || navigating) return
    setNavigating(true)
    if (selected === 'USER') navigate('/login', { state: { accountType: 'USER' } })
    else if (selected === 'PARTNER') navigate('/register', { state: { accountType: 'PARTNER' } })
    else navigate('/admin/login')
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface-50 dark:bg-surface-950">
      <div className="relative z-10 pt-14 pb-6 px-6 text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-[20px] bg-gradient-to-br from-primary-500 via-primary-400 to-accent-500 flex items-center justify-center shadow-xl shadow-primary-500/25">
          <svg viewBox="0 0 100 100" className="w-9 h-9" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M50 18L82 44V78H58V56H42V78H18V44L50 18Z" fill="white" fillOpacity="0.93" />
          </svg>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold font-display tracking-tight text-surface-900 dark:text-white">
          How do you want to use RentBuddy?
        </h1>
        <p className="mt-2 text-sm text-surface-500 dark:text-surface-400">
          Choose your account type. You can switch later if your account allows it.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        <div className="max-w-md mx-auto space-y-4">
          {OPTIONS.map(({ key, icon: Icon, title, description, gradient, selectedRing }) => {
            const isSelected = selected === key
            return (
              <button
                key={key}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelected(key)}
                className={`w-full text-left p-5 rounded-2xl border transition-all duration-200 active:scale-[0.98] cursor-pointer ${
                  isSelected
                    ? `${selectedRing} shadow-lg`
                    : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 hover:border-surface-300 dark:hover:border-surface-600'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-bold text-base tracking-wide text-surface-900 dark:text-white">{title}</h2>
                    <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5 leading-snug">{description}</p>
                  </div>
                  <div
                    className={`w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
                      isSelected ? 'border-primary-500 bg-primary-500 text-white' : 'border-surface-300 dark:border-surface-600'
                    }`}
                  >
                    {isSelected && <Check className="w-4 h-4" strokeWidth={3} />}
                  </div>
                </div>
              </button>
            )
          })}

          {selected === 'ADMIN' && (
            <p className="text-xs text-center text-surface-500 dark:text-surface-400 px-4">
              Admin access requires provisioned credentials issued by the platform owner. There is no public admin signup.
            </p>
          )}
        </div>
      </div>

      <div className="p-6 pb-10">
        <div className="max-w-md mx-auto">
          <button
            onClick={handleContinue}
            disabled={!selected || navigating}
            className={`btn-gradient w-full btn-lg group ${!selected || navigating ? 'opacity-40 pointer-events-none' : ''}`}
          >
            <span className="flex items-center justify-center gap-2">
              {navigating ? 'Please wait…' : 'Continue'}
              {!navigating && <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
