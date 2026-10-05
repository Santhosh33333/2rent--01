import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/**
 * The admin page header.
 *
 * Every admin page hand-rolled the same block - back link to the portal, a
 * title, a subtitle, and an action slot - in slightly different greys. That is
 * why the console reads as 26 separate pages rather than one product. This
 * extracts it so the shell is decided once.
 *
 * The console is deliberately dark: it is an ops surface with dense tables,
 * long sessions, and status colours tuned against a dark background. Forcing
 * it to follow the consumer theme would fight every status colour in the system
 * for no user benefit.
 *
 * `tone="surface"` exists for the handful of admin pages that are already
 * theme-aware (`AdminTopups`, `AdminUpiVerification`, `AdminPricing`). Those
 * keep their own background and only borrow the header's structure and
 * spacing, so adopting this component never silently costs a page its light
 * mode.
 */
export type AdminHeaderTone = 'console' | 'surface' | 'slate'

const TONE: Record<
  AdminHeaderTone,
  {
    wrap: string
    back: string
    title: string
    subtitle: string
  }
> = {
  console: {
    wrap: 'flex items-center gap-3 mb-6',
    back: 'p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition',
    title: 'text-2xl font-bold font-display text-white',
    subtitle: 'text-gray-400 text-sm mt-1',
  },
  surface: {
    wrap: 'flex items-center gap-3 mb-6',
    back: 'p-2 rounded-lg bg-surface-200 dark:bg-surface-800 hover:bg-surface-300 dark:hover:bg-surface-700 text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white transition',
    title: 'text-2xl font-bold font-display text-surface-900 dark:text-white',
    subtitle: 'text-surface-500 dark:text-surface-400 text-sm mt-1',
  },
  // AdminPricing predates the app's surface tokens and is built on Tailwind's
  // `slate` ramp. It gets the structure without being re-themed, so adopting
  // this component does not quietly change how that page looks.
  slate: {
    wrap: 'flex items-center gap-3 mb-6',
    back: 'p-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-slate-900 transition',
    title: 'text-2xl font-bold font-display text-slate-900',
    subtitle: 'text-slate-500 text-sm mt-1',
  },
}

export function AdminPageHeader({
  title,
  subtitle,
  actions,
  leading,
  backTo = '/admin/portal',
  backLabel = 'Back to admin portal',
  showBack = true,
  tone = 'console',
  className = '',
}: {
  title: string
  subtitle?: string
  /** Right-aligned controls (export, filters, primary action). */
  actions?: ReactNode
  /**
   * Extra control rendered next to the title. The portal uses this for the
   * account role switcher, which must sit in the header row.
   */
  leading?: ReactNode
  /** Overridable because the portal itself links out to /dashboard. */
  backTo?: string
  backLabel?: string
  /**
   * Off for pages reached in a context where "back to portal" is not the
   * useful destination (Live Tracking is opened from Dispatch).
   */
  showBack?: boolean
  /** 'surface' for the theme-aware pages. */
  tone?: AdminHeaderTone
  /** Extra classes on the row, for pages that need different vertical spacing. */
  className?: string
}) {
  const t = TONE[tone]

  return (
    <div className={`${t.wrap} ${className}`}>
      {showBack ? (
        <Link to={backTo} aria-label={backLabel} className={t.back}>
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
      ) : (
        leading
      )}

      <div className="min-w-0">
        <h1 className={t.title}>{title}</h1>
        {subtitle && <p className={t.subtitle}>{subtitle}</p>}
      </div>

      {showBack && leading}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  )
}

/**
 * The standard admin page shell: dark console surface, centred column,
 * consistent padding. Paired with AdminPageHeader so a new admin page gets the
 * right chrome without copying a template.
 */
export function AdminShell({
  children,
  width = 'max-w-5xl',
}: {
  children: ReactNode
  width?: string
}) {
  return (
    <div className="bg-gray-950 p-4 sm:p-6 rounded-3xl">
      <div className={`${width} mx-auto`}>{children}</div>
    </div>
  )
}
