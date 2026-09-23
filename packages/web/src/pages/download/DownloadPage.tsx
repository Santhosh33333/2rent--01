import { Link } from 'react-router-dom'
import { Check, Download, Monitor, ShieldCheck, Smartphone, Sparkles, Zap } from 'lucide-react'

const APK_PATH = '/download/nabri.apk'
const APK_SIZE = '4 MB'
const APK_VERSION = '1.0.0'

const STEPS = [
  { icon: Smartphone, title: 'Open on your phone', text: 'Visit this page from your Android phone so the APK downloads straight to it.' },
  { icon: Download, title: 'Tap to download', text: 'Your browser will grab the Nabri app (~4 MB). Keep the downloaded file when prompted.' },
  { icon: ShieldCheck, title: 'Allow installs', text: 'Android may ask to allow installing from your browser — turn that on for this download.' },
  { icon: Check, title: 'Install & sign in', text: 'Open the file and tap Install. Then sign in or create your account.' },
]

const FEATURES = [
  { icon: Sparkles, title: 'One app, every side of life', text: 'CarryBuddy, walking partners, bookings, events, communities and more.' },
  { icon: Zap, title: 'Native speed', text: 'Runs as a real app with notifications, camera and live location access.' },
  { icon: ShieldCheck, title: 'Secure & verified', text: 'Account verification and KYC keep every ride and request safe.' },
]

export function DownloadPage() {
  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      {/* Hero */}
      <div className="relative overflow-hidden bg-surface-950 text-white">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-primary-500/15 rounded-full blur-[128px]" />
          <div className="absolute bottom-0 left-1/3 w-80 h-80 bg-accent-500/15 rounded-full blur-[128px]" />
        </div>

        <div className="relative z-10 max-w-3xl mx-auto px-5 sm:px-8 py-12 sm:py-16 text-center">
          <Link to="/" className="inline-flex items-center gap-2 text-lg font-extrabold font-display tracking-tight text-white">
            <img src="/logo-mark.svg" alt="Nabri logo" className="w-8 h-8" />
            NABRI
          </Link>

          <h1 className="mt-8 text-3xl sm:text-5xl font-bold font-display tracking-tight text-gradient">
            Get Nabri on your phone
          </h1>
          <p className="mt-4 text-sm sm:text-base text-surface-400 max-w-md mx-auto">
            One app for every side of life — CarryBuddy, walking partners, bookings,
            communities and more. Runs natively with notifications and live location.
          </p>

          <a
            href={APK_PATH}
            download
            className="mt-8 inline-flex items-center justify-center gap-3 rounded-2xl bg-primary-500 hover:bg-primary-400 px-8 py-4 text-base font-bold text-white shadow-xl shadow-primary-500/25 transition-all hover:-translate-y-0.5"
          >
            <Download className="w-5 h-5" />
            Download Android APK
          </a>

          <p className="mt-3 text-xs text-surface-500">
            Android · {APK_SIZE} · v{APK_VERSION}
          </p>

          <div className="mt-6 flex items-center justify-center gap-6 text-xs text-surface-500">
            <Link to="/account-type" className="flex items-center gap-1.5 hover:text-primary-400 transition-colors">
              <Monitor className="w-4 h-4" /> Use in your browser
            </Link>
            <Link to="/login" className="flex items-center gap-1.5 hover:text-primary-400 transition-colors">
              Already have an account? <span className="font-semibold text-primary-400">Sign in</span>
            </Link>
          </div>
        </div>

        <svg viewBox="0 0 1440 60" className="relative z-10 block w-full text-surface-50 dark:text-surface-950 fill-current" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 60h1440V20C1200 40 900 50 720 44 540 38 240 24 0 40Z" />
        </svg>
      </div>

      {/* Install steps */}
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-12 sm:py-16">
        <h2 className="text-xl sm:text-2xl font-bold text-surface-900 dark:text-white text-center">
          Install in 4 easy steps
        </h2>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((step, i) => (
            <div key={step.title} className="glass-card-static relative">
              <span className="absolute top-4 right-4 text-4xl font-black text-surface-200 dark:text-surface-800">{i + 1}</span>
              <div className="w-12 h-12 rounded-2xl bg-primary-500/10 dark:bg-primary-500/20 flex items-center justify-center">
                <step.icon className="w-6 h-6 text-primary-600 dark:text-primary-400" />
              </div>
              <h3 className="mt-4 font-semibold text-surface-900 dark:text-white text-base">{step.title}</h3>
              <p className="mt-1.5 text-sm text-surface-500 dark:text-surface-400 leading-relaxed">{step.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Why the app */}
      <div className="max-w-5xl mx-auto px-5 sm:px-8 pb-12 sm:pb-16">
        <div className="hero-indigo">
          <div className="hero-dots" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.12) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
          <div className="relative z-10 grid gap-6 sm:grid-cols-3">
            {FEATURES.map(f => (
              <div key={f.title}>
                <f.icon className="w-6 h-6 text-white/80" />
                <h3 className="mt-3 font-semibold text-white">{f.title}</h3>
                <p className="mt-1.5 text-sm text-white/70 leading-relaxed">{f.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 text-center">
          <a
            href={APK_PATH}
            download
            className="inline-flex items-center justify-center gap-3 rounded-2xl bg-primary-600 hover:bg-primary-500 px-8 py-4 text-base font-bold text-white shadow-lg shadow-primary-600/20 transition-all hover:-translate-y-0.5"
          >
            <Download className="w-5 h-5" />
            Download now
          </a>
          <p className="mt-4 text-sm text-surface-500 dark:text-surface-400">
            Questions?{' '}
            <Link to="/login" className="font-semibold text-primary-600 dark:text-primary-400 hover:underline">Sign in</Link>{' '}
            or{' '}
            <Link to="/register" className="font-semibold text-primary-600 dark:text-primary-400 hover:underline">create an account</Link>.
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-surface-200 dark:border-surface-800">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-surface-500 dark:text-surface-500">© {new Date().getFullYear()} Nabri. All rights reserved.</p>
          <div className="flex items-center gap-4 text-xs text-surface-500 dark:text-surface-500">
            <Link to="/terms" className="hover:text-primary-500 transition-colors">Terms</Link>
            <Link to="/privacy" className="hover:text-primary-500 transition-colors">Privacy</Link>
            <Link to="/download" className="hover:text-primary-500 transition-colors font-medium text-primary-600 dark:text-primary-400">Download app</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}