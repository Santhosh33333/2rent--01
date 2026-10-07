import { Link } from 'react-router-dom'
import { Check, Download, Monitor, ShieldCheck, Smartphone, Sparkles, Zap } from 'lucide-react'

const APK_PATH = '/download/nabri.apk'
// Baked in by vite.config.ts from what this deploy will actually serve: the
// local file copied into dist/download, or the external URL set via the
// NABRI_APK_URL env var (used when the gitignored binary is not in CI).
const APK_HREF = __APK_URL__ || APK_PATH
const APK_AVAILABLE = __APK_AVAILABLE__
const APK_SIZE = __APK_SIZE_MB__
const STEPS = [
  { icon: Smartphone, title: 'Open on your phone', text: 'Visit this page from your Android phone so the APK downloads straight to it.' },
  { icon: Download, title: 'Tap to download', text: `Your browser will grab the Nabri app${APK_SIZE != null ? ` (${APK_SIZE} MB)` : ''}. Keep the downloaded file when prompted.` },
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
      <div className="relative overflow-hidden bg-[#081F4F] text-white">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(135deg,#081F4F 0%,#0D378B 55%,#3B6ED8 100%)' }}>
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-white/10 rounded-full blur-[128px]" />
          <div className="absolute bottom-0 left-1/3 w-80 h-80 bg-[#D2F53C]/10 rounded-full blur-[128px]" />
        </div>

        <div className="relative z-10 max-w-3xl mx-auto px-5 sm:px-8 py-12 sm:py-16 text-center">
          <Link to="/" className="inline-flex items-center gap-3 text-lg font-extrabold font-display tracking-[-0.05em] text-white">
            <span className="logo-3d">
              <img src="/logo-mark.svg" alt="Nabri logo" className="h-10 w-10" />
            </span>
            Nabri
          </Link>

          <h1 className="mt-8 text-3xl sm:text-5xl font-bold font-display tracking-tight text-gradient wordmark-on-navy">
            Get Nabri on your phone
          </h1>
          <p className="mt-4 text-sm sm:text-base text-white/70 max-w-md mx-auto">
            One app for every side of life — CarryBuddy, walking partners, bookings,
            communities and more. Runs natively with notifications and live location.
          </p>

          {APK_AVAILABLE ? (
            <a
              href={APK_HREF}
              download
              className="mt-8 inline-flex items-center justify-center gap-3 rounded-2xl bg-white px-8 py-4 text-base font-bold text-[#0D378B] shadow-xl shadow-black/20 transition-all hover:-translate-y-0.5 hover:bg-[#E9F0FF]"
            >
              <Download className="w-5 h-5" />
              Download Android APK
            </a>
          ) : (
            // No APK in this build. Saying nothing here would leave a dead
            // button; pretending it works would be worse.
            <div className="mt-8 inline-flex flex-col items-start gap-1.5 rounded-2xl border border-white/25 bg-white/10 px-6 py-4 text-left">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#D2F53C]">
                Not configured
              </span>
              <p className="max-w-sm text-sm leading-relaxed text-white/85">
                The Android APK isn't attached to this build yet, so there's
                nothing to download right now. The web app has everything else.
              </p>
            </div>
          )}

          {/* This panel is hardcoded navy in BOTH themes (bg-[#081F4F]), so its
              muted text is white-based rather than a `surface-*` step. Using
              text-surface-400/500 put a warm mid-grey on that navy: 2.78:1 for
              the links and 2.82:1 for the intro line. */}
          {APK_AVAILABLE && (
            <p className="mt-3 text-xs text-white/70">
              Android{APK_SIZE != null ? ` · ${APK_SIZE} MB` : ''}
            </p>
          )}

          <div className="mt-6 flex items-center justify-center gap-6 text-xs text-white/70">
            <Link to="/account-type" className="flex items-center gap-1.5 hover:text-white transition-colors">
              <Monitor className="w-4 h-4" /> Use in your browser
            </Link>
            <Link to="/login" className="flex items-center gap-1.5 hover:text-white transition-colors">
              Already have an account? <span className="font-semibold text-white">Sign in</span>
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
          {APK_AVAILABLE ? 'Install in 4 easy steps' : 'Install instructions'}
        </h2>

        {APK_AVAILABLE ? (
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
        ) : (
          // Walking someone through "tap to download" when there is no file to
          // tap would be instructing them to do something impossible.
          <div className="mt-8 rounded-3xl border border-dashed border-surface-300 dark:border-surface-700 bg-surface-100/70 dark:bg-surface-900/70 px-6 py-8 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400">
              Not configured
            </p>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-surface-500 dark:text-surface-400">
              The APK is not part of this build, so there are no install steps
              to follow yet. You can use Nabri in your browser right now.
            </p>
            <Link
              to="/account-type"
              className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-primary-600 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-700"
            >
              <Monitor className="w-4 h-4" /> Open Nabri in your browser
            </Link>
          </div>
        )}
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
          {APK_AVAILABLE ? (
            <a
              href={APK_HREF}
              download
              className="inline-flex items-center justify-center gap-3 rounded-2xl bg-[#0D378B] hover:bg-[#123F9C] px-8 py-4 text-base font-bold text-white shadow-lg shadow-[#0D378B]/25 transition-all hover:-translate-y-0.5"
            >
              <Download className="w-5 h-5" />
              Download now
            </a>
          ) : (
            <p className="inline-block rounded-2xl border border-surface-300 dark:border-surface-700 px-6 py-4 text-sm text-surface-500 dark:text-surface-400">
              <span className="mr-2 font-bold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400">Not configured</span>
              The APK isn't attached to this build yet.
            </p>
          )}
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