import { Share2, UserPlus, Wallet } from 'lucide-react'
import { AnimatedPage } from '../../components/AnimatedPage'
import { PageHeader } from '../../components/PageHeader'
import { ReferralCard } from '../../components/account/ReferralCard'

/**
 * A dedicated surface for the invite loop.
 *
 * The referral card lived only on the profile, where most users never scrolled
 * to it. Growth is word of mouth for an app like this, so the one screen whose
 * whole job is "bring a friend" gets its own route, its own QR, and a plain
 * explanation of what happens after the share.
 */

const steps = [
  {
    icon: Share2,
    title: 'Share your link',
    text: 'Send it on WhatsApp, SMS or anywhere. Your code is built into the link, so your friend never has to type it.',
  },
  {
    icon: UserPlus,
    title: 'They join Nabri',
    text: 'They sign up through your link and the code is applied to their account automatically.',
  },
  {
    icon: Wallet,
    title: 'You both get rewarded',
    text: 'The reward lands in both wallets after their first completed booking.',
  },
]

export function InvitePage() {
  return (
    <AnimatedPage className="mx-auto max-w-2xl">
      <PageHeader
        title="Invite & earn"
        subtitle="Nabri grows by word of mouth. Share your code and you both get rewarded."
      />

      <ReferralCard showQr />

      <section aria-label="How inviting works" className="mt-6 grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <div key={step.title} className="prism-card prism-ring p-4">
            <span className="prism-chip h-9 w-9 text-white">
              <step.icon className="h-4 w-4" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-bold text-surface-900 dark:text-white">
              {index + 1}. {step.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-surface-500 dark:text-surface-400">
              {step.text}
            </p>
          </div>
        ))}
      </section>
    </AnimatedPage>
  )
}
