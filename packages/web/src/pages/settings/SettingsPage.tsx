import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Sun, Moon, Monitor, Bell, Shield, Smartphone, Globe, Type, WifiOff, Save, Loader2, Eye, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { api } from '../../lib/api'

interface Settings {
  theme: string
  fontSize: string
  language: string
  notificationsEnabled: boolean
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
  theme: 'system', fontSize: 'medium', language: 'en',
  notificationsEnabled: true, chatNotifications: true, eventReminders: true,
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

const languages = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'ta', label: 'தமிழ்' },
  { value: 'te', label: 'తెలుగు' },
  { value: 'bn', label: 'বাংলা' },
  { value: 'mr', label: 'मराठी' },
  { value: 'kn', label: 'ಕನ್ನಡ' },
]

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

export function SettingsPage() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/settings').then(r => { setSettings(r.data.data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const update = (key: keyof Settings, value: any) => setSettings(prev => ({ ...prev, [key]: value }))

  const applyTheme = (theme: string) => {
    update('theme', theme)
    const root = document.documentElement
    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('rentbuddy-theme', theme)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.put('/settings', settings)
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
          <div className="mb-6">
            <div className="flex gap-2">
              {themes.map(t => (
                <button key={t.value} onClick={() => applyTheme(t.value)} className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${settings.theme === t.value ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10' : 'border-surface-200 dark:border-surface-700 hover:border-surface-300'}`}>
                  <t.icon className="w-5 h-5" />
                  <span className="text-xs font-medium">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <SettingRow icon={Type} label="Font Size" description="Adjust text size">
            <div className="flex gap-1">
              {fontSizes.map(f => (
                <button key={f.value} onClick={() => update('fontSize', f.value)} className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${settings.fontSize === f.value ? 'bg-primary-500 text-white' : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400'}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </SettingRow>

          <SettingRow icon={Globe} label="Language" description="Select your preferred language">
            <select value={settings.language} onChange={e => update('language', e.target.value)} className="input py-1.5 px-3 text-xs w-32">
              {languages.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </SettingRow>

          {/* Notifications */}
          <h2 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3 mt-8">Notifications</h2>
          <SettingRow icon={Bell} label="All Notifications" description="Enable or disable all notifications">
            <ToggleSwitch enabled={settings.notificationsEnabled} onChange={v => update('notificationsEnabled', v)} />
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
