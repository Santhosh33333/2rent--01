import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Sun, Moon, Monitor, Bell, Shield, Smartphone, Type, WifiOff, Save, Loader2, Eye, Clock, Lock, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { api } from '../../lib/api'
import { useTheme, ACCENTS, Accent } from '../../lib/themeContext'
import { useAppLock } from '../../lib/appLock'

interface Settings {
  theme: string
  accent: string
  fontSize: string
  notificationsEnabled: boolean
  notificationSound: boolean
  chatNotifications: boolean
  eventReminders: boolean
  walkingAlerts: boolean
  communityUpdates: boolean
  pushEnabled: boolean
  emailNotifications: boolean
  smsNotifications: boolean
  dataSaver: boolean
  autoDownloadImages: boolean
  autoDownloadVideos: boolean
  showOnlineStatus: boolean
  showLastActive: boolean
  allowProfileView: boolean
  allowLocationSharing: boolean
}

const defaultSettings: Settings = {
  theme: 'system', accent: 'navy', fontSize: 'medium',
  notificationsEnabled: true, notificationSound: true, chatNotifications: true, eventReminders: true,
  walkingAlerts: true, communityUpdates: true, pushEnabled: true,
  emailNotifications: true, smsNotifications: false, dataSaver: false,
  autoDownloadImages: true, autoDownloadVideos: false, showOnlineStatus: true,
  showLastActive: true, allowProfileView: true, allowLocationSharing: false,
}

const themes = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

const fontSizes = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
]

const accentSwatches: Record<string, string> = {
  navy: '#2A56B8',
  coral: '#f04f32',
  indigo: '#6366f1',
  emerald: '#10b981',
  rose: '#f43f5e',
  amber: '#f59e0b',
  sky: '#0ea5e9',
}

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!enabled)} className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${enabled ? 'bg-primary-500' : 'bg-surface-300 dark:bg-surface-600'}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${enabled ? 'translate-x-5' : ''}`} />
    </button>
  )
}

function SettingRow({ icon: Icon, label, description, children }: { icon: any; label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-surface-100 dark:border-surface-800 last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
          <Icon className="w-4 h-4 text-surface-500" />
        </div>
        <div>
          <p className="text-sm font-medium text-surface-900 dark:text-white">{label}</p>
          {description && <p className="text-xs text-surface-500 mt-0.5">{description}</p>}
        </div>
      </div>
      <div>{children}</div>
    </div>
  )
}

const AUTO_LOCK_OPTIONS = [
  { value: 0, label: 'Instantly' },
  { value: 60, label: '1 min' },
  { value: 300, label: '5 min' },
]

function PinEntryModal({
  mode,
  onChangePin,
  onClose,
}: {
  mode: 'setup' | 'disable' | 'change'
  onChangePin: (pin: string, oldPin?: string) => Promise<void>
  onClose: () => void
}) {
  const { verify } = useAppLock()
  const [step, setStep] = useState<'old' | 'new' | 'confirm'>(mode === 'setup' ? 'new' : 'old')
  const [oldPin, setOldPin] = useState('')
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const heading =
    step === 'old' ? `Enter your current PIN` : step === 'new' ? 'Choose a PIN (4–6 digits)' : 'Repeat the new PIN'

  const next = async () => {
    if (step === 'old') {
      setBusy(true)
      const ok = await verify(oldPin)
      setBusy(false)
      if (ok) {
        setError('')
        if (mode === 'disable') {
          await onChangePin(oldPin)
          onClose()
        } else {
          setOldPin('')
          setStep('new')
        }
      } else {
        setError('Wrong PIN')
        setOldPin('')
      }
      return
    }
    if (step === 'new') {
      if (pin1.length < 4) { setError('PIN must be 4–6 digits'); return }
      setError('')
      setStep('confirm')
      return
    }
    if (pin1 !== pin2) { setError('PINs do not match'); setPin2(''); return }
    setBusy(true)
    await onChangePin(pin1, oldPin || undefined)
    setBusy(false)
    onClose()
  }

  const type = (k: string) => {
    const set = step === 'old' ? setOldPin : step === 'new' ? setPin1 : setPin2
    set(prev => (k === '⌫' ? prev.slice(0, -1) : prev.length < 6 ? prev + k : prev))
  }

  const pinLen = step === 'old' ? oldPin.length : step === 'new' ? pin1.length : pin2.length

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-5" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xs rounded-3xl bg-white dark:bg-surface-900 p-6 shadow-2xl ring-1 ring-surface-200 dark:ring-surface-700">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-500/10">
          <KeyRound className="w-6 h-6 text-primary-500" />
        </div>
        <h3 className="text-center text-lg font-bold text-surface-900 dark:text-white">
          {mode === 'setup' ? 'Set app lock PIN' : mode === 'change' ? 'Change PIN' : 'Turn off PIN lock'}
        </h3>
        <p className="mt-1 text-center text-xs text-surface-500">{heading}</p>
        <div className="mt-5 flex justify-center gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className={`h-3 w-3 rounded-full transition-all ${i < pinLen ? 'bg-primary-500 scale-110' : 'bg-surface-200 dark:bg-surface-700'}`} />
          ))}
        </div>
        {error && <p className="mt-3 text-center text-sm font-medium text-red-500">{error}</p>}
        <div className="mt-5 grid grid-cols-3 gap-2">
          {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) =>
            k ? (
              <button key={i} type="button" onClick={() => type(k)} className="h-12 rounded-2xl bg-surface-100 dark:bg-surface-800 text-lg font-semibold text-surface-900 dark:text-white active:scale-95 active:bg-primary-500/20 transition">{k}</button>
            ) : <span key={i} />
          )}
        </div>
        <button
          type="button"
          onClick={next}
          disabled={busy}
          className="mt-5 w-full rounded-2xl bg-primary-600 py-3 text-sm font-semibold text-white active:scale-[0.98] transition disabled:opacity-50"
        >
          {busy ? 'Checking…' : step === 'confirm' ? 'Finish' : 'Continue'}
        </button>
      </div>
    </div>
  )
}

export function SettingsPage() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { setTheme, setAccent } = useTheme()
  const { enabled: appLockEnabled, autoLockSec, enable, disable, changePin, lockNow, setAutoLockSec } = useAppLock()
  const [lockModal, setLockModal] = useState<null | 'setup' | 'disable' | 'change'>(null)

  useEffect(() => {
    api.get('/settings').then(r => {
      const data = r.data.data
      const merged = { ...defaultSettings, ...data }
      setSettings(merged)
      localStorage.setItem('notification-sound-enabled', String(merged.notificationSound && merged.notificationsEnabled))
      localStorage.setItem('notifications-enabled', String(merged.notificationsEnabled))
      setLoading(false)
      // Honor a previously saved explicit theme on reload.
      if (data?.theme === 'light') setTheme('light')
      else if (data?.theme === 'dark') setTheme('dark')
      if (ACCENTS.some(a => a.value === data?.accent)) setAccent(data.accent as Accent)
    }).catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const update = (key: keyof Settings, value: any) => setSettings(prev => ({ ...prev, [key]: value }))

  const updateNotificationSound = (enabled: boolean) => {
    update('notificationSound', enabled)
    localStorage.setItem('notification-sound-enabled', String(enabled))
  }

  const updateAllNotifications = (enabled: boolean) => {
    update('notificationsEnabled', enabled)
    localStorage.setItem('notifications-enabled', String(enabled))
  }

  const applyTheme = (theme: string) => {
    update('theme', theme)
    // Drive the app-wide ThemeProvider so the change is instant everywhere,
    // mirrors the system preference for "system", and persists to the same
    // localStorage key the provider reads on boot (fixes lost theme on reload).
    if (theme === 'light') setTheme('light')
    else if (theme === 'dark') setTheme('dark')
    else if (theme === 'system') setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  }

  const applyAccent = (accent: string) => {
    update('accent', accent)
    setAccent(accent as Accent)
  }

  const applyFontSize = (size: string) => {
    update('fontSize', size)
    const root = document.documentElement
    if (size === 'small' || size === 'large') root.dataset.fontSize = size
    else delete root.dataset.fontSize
    localStorage.setItem('Sidebud-font-size', size)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.put('/settings', settings)
      localStorage.setItem('notification-sound-enabled', String(settings.notificationSound && settings.notificationsEnabled))
      localStorage.setItem('notifications-enabled', String(settings.notificationsEnabled))
      toast.success('Settings saved successfully')
    } catch { toast.error('Failed to save settings') }
    finally { setSaving(false) }
  }

  if (loading) return (
    <div className="max-w-2xl mx-auto space-y-6 py-8">
      {[1,2,3].map(i => <div key={i} className="glass-card p-6 animate-pulse h-20" />)}
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group">
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back</span>
      </button>

      <AnimatedPage>
        <GlassCard variant="elevated" padding="lg">
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white mb-6">Settings</h1>

          {/* Appearance */}
          <h2 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">Appearance</h2>
          <div className="mb-4">
            <div className="flex gap-2">
              {themes.map(t => (
                <button key={t.value} onClick={() => applyTheme(t.value)} className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${settings.theme === t.value ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10' : 'border-surface-200 dark:border-surface-700 hover:border-surface-300'}`}>
                  <t.icon className="w-5 h-5" />
                  <span className="text-xs font-medium">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mb-2">
            <p className="text-xs text-surface-500 mb-2">Accent color</p>
            <div className="flex gap-2">
              {ACCENTS.map(a => (
                <button key={a.value} onClick={() => applyAccent(a.value)} title={a.label} aria-label={`${a.label} accent`} className={`w-9 h-9 rounded-full ring-offset-2 ring-offset-surface-50 dark:ring-offset-surface-900 transition-all ${settings.accent === a.value ? 'ring-2 ring-surface-900 dark:ring-white scale-110' : 'hover:scale-105'}`} style={{ backgroundColor: accentSwatches[a.value] }} />
              ))}
            </div>
          </div>

          <SettingRow icon={Type} label="Font Size" description="Adjust text size">
            <div className="flex gap-1">
              {fontSizes.map(f => (
                <button key={f.value} onClick={() => applyFontSize(f.value)} className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${settings.fontSize === f.value ? 'bg-primary-500 text-white' : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400'}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </SettingRow>

          {/* Language is English-only — no selector shown. */}

          {/* Notifications */}
          <h2 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3 mt-8">Notifications</h2>
          <SettingRow icon={Bell} label="All Notifications" description="Enable or disable all notifications">
            <ToggleSwitch enabled={settings.notificationsEnabled} onChange={updateAllNotifications} />
          </SettingRow>
          <SettingRow icon={Bell} label="Notification Sound" description="Play a short sound for new in-app notifications">
            <ToggleSwitch enabled={settings.notificationSound} onChange={updateNotificationSound} />
          </SettingRow>
          {settings.notificationsEnabled && (
            <>
              <SettingRow icon={Bell} label="Chat Messages" description="New message alerts">
                <ToggleSwitch enabled={settings.chatNotifications} onChange={v => update('chatNotifications', v)} />
              </SettingRow>
              <SettingRow icon={Bell} label="Event Reminders" description="Upcoming event alerts">
                <ToggleSwitch enabled={settings.eventReminders} onChange={v => update('eventReminders', v)} />
              </SettingRow>
              <SettingRow icon={Bell} label="Walking Requests" description="New walking request alerts">
                <ToggleSwitch enabled={settings.walkingAlerts} onChange={v => update('walkingAlerts', v)} />
              </SettingRow>
              <SettingRow icon={Bell} label="Community Updates" description="Community activity alerts">
                <ToggleSwitch enabled={settings.communityUpdates} onChange={v => update('communityUpdates', v)} />
              </SettingRow>
              <SettingRow icon={Smartphone} label="Push Notifications" description="Device push notifications">
                <ToggleSwitch enabled={settings.pushEnabled} onChange={v => update('pushEnabled', v)} />
              </SettingRow>
              <SettingRow icon={Bell} label="Email Notifications" description="Email digest updates">
                <ToggleSwitch enabled={settings.emailNotifications} onChange={v => update('emailNotifications', v)} />
              </SettingRow>
            </>
          )}

          {/* Privacy */}
          <h2 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3 mt-8">Privacy</h2>
          <SettingRow icon={Eye} label="Online Status" description="Show when you're online">
            <ToggleSwitch enabled={settings.showOnlineStatus} onChange={v => update('showOnlineStatus', v)} />
          </SettingRow>
          <SettingRow icon={Clock} label="Last Active" description="Show last active time">
            <ToggleSwitch enabled={settings.showLastActive} onChange={v => update('showLastActive', v)} />
          </SettingRow>
          <SettingRow icon={Eye} label="Profile Visibility" description="Allow others to view your profile">
            <ToggleSwitch enabled={settings.allowProfileView} onChange={v => update('allowProfileView', v)} />
          </SettingRow>
          <SettingRow icon={Shield} label="Location Sharing" description="Share location during walks">
            <ToggleSwitch enabled={settings.allowLocationSharing} onChange={v => update('allowLocationSharing', v)} />
          </SettingRow>

          {/* App Lock */}
          <h2 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3 mt-8">App Lock</h2>
          <SettingRow icon={Lock} label="PIN Lock" description="Lock the app with a 4–6 digit PIN when it's not in use">
            <ToggleSwitch enabled={appLockEnabled} onChange={v => setLockModal(v ? 'setup' : 'disable')} />
          </SettingRow>
          {appLockEnabled && (
            <>
              <SettingRow icon={Clock} label="Lock after" description="How soon to lock after leaving the app">
                <div className="flex gap-1">
                  {AUTO_LOCK_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      onClick={() => {
                        setAutoLockSec(o.value)
                        toast.success(`Locks ${o.label.toLowerCase()}`)
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${autoLockSec === o.value ? 'bg-primary-500 text-white' : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400'}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow icon={KeyRound} label="Change PIN" description="Set a new PIN">
                <button onClick={() => setLockModal('change')} className="px-3 py-1 rounded-lg text-xs font-medium bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors">
                  Change
                </button>
              </SettingRow>
              <SettingRow icon={Lock} label="Lock now" description="Lock the app immediately">
                <button onClick={() => { lockNow(); toast.success('App locked') }} className="px-3 py-1 rounded-lg text-xs font-medium bg-primary-500/10 text-primary-600 hover:bg-primary-500/20 transition-colors">
                  Lock
                </button>
              </SettingRow>
            </>
          )}
          {lockModal && (
            <PinEntryModal
              mode={lockModal}
              onClose={() => setLockModal(null)}
              onChangePin={async (pin, oldPin) => {
                if (lockModal === 'setup') { await enable(pin); toast.success('PIN lock enabled') }
                else if (lockModal === 'disable') { const ok = await disable(pin); if (ok) toast.success('PIN lock turned off'); else toast.error('Wrong PIN') }
                else { const r = await changePin(oldPin || pin, pin); toast.success(r === 'ok' ? 'PIN changed' : 'Failed to change PIN') }
              }}
            />
          )}

          {/* Data & Storage */}
          <h2 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3 mt-8">Data & Storage</h2>
          <SettingRow icon={WifiOff} label="Data Saver" description="Reduce data usage">
            <ToggleSwitch enabled={settings.dataSaver} onChange={v => update('dataSaver', v)} />
          </SettingRow>
          <SettingRow icon={Smartphone} label="Auto-download Images" description="Download images on mobile data">
            <ToggleSwitch enabled={settings.autoDownloadImages} onChange={v => update('autoDownloadImages', v)} />
          </SettingRow>
          <SettingRow icon={Smartphone} label="Auto-download Videos" description="Download videos on mobile data">
            <ToggleSwitch enabled={settings.autoDownloadVideos} onChange={v => update('autoDownloadVideos', v)} />
          </SettingRow>

          {/* Save */}
          <div className="pt-6">
            <button onClick={handleSave} disabled={saving} className="btn-primary w-full">
              {saving ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Saving...</span> : <span className="flex items-center justify-center gap-2"><Save className="w-4 h-4" /> Save Settings</span>}
            </button>
          </div>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}
