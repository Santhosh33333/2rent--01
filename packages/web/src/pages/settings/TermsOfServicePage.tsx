import { useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText } from 'lucide-react'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'

export function TermsOfServicePage() {
  const navigate = useNavigate()

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group">
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back</span>
      </button>

      <AnimatedPage>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Terms of Service</h1>
              <p className="text-sm text-surface-500">Last updated: August 29, 2026</p>
            </div>
          </div>

          <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-surface-700 dark:text-surface-300">
            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">1. Acceptance of Terms</h2>
              <p className="text-sm leading-relaxed">By accessing or using RentBuddy, you agree to be bound by these Terms of Service. If you do not agree, do not use the application.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">2. Eligibility</h2>
              <p className="text-sm leading-relaxed">You must be at least 18 years old to use RentBuddy. You must provide accurate and complete registration information. One account per person.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">3. Services</h2>
              <p className="text-sm leading-relaxed">RentBuddy connects users with service providers (partners) for walking companions, carry assistance, and other community services. We are a platform — we do not directly provide the services listed.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">4. Bookings & Payments</h2>
              <p className="text-sm leading-relaxed">All bookings are subject to availability and partner acceptance. Payments are processed through Razorpay. Wallet top-ups are non-refundable once used for bookings. Cancellations follow the cancellation policy displayed during booking creation.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">5. User Conduct</h2>
              <p className="text-sm leading-relaxed">You agree not to misuse the platform, harass other users, provide false information, attempt to circumvent safety features, or use the service for any illegal purpose. Violation may result in account suspension or termination.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">6. Partner Obligations</h2>
              <p className="text-sm leading-relaxed">Partners must maintain accurate profiles, complete KYC verification, provide services professionally, and comply with all applicable laws. Partners are independent contractors, not employees of RentBuddy.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">7. Liability</h2>
              <p className="text-sm leading-relaxed">RentBuddy is not liable for injuries, damages, or losses during service delivery. Our liability is limited to the amount of fees paid for the specific booking in question. We provide the platform "as is" without warranties.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">8. Dispute Resolution</h2>
              <p className="text-sm leading-relaxed">Disputes should first be reported through in-app support. Unresolved disputes will be subject to binding arbitration under Indian law. Class action lawsuits are waived to the extent permitted by law.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">9. Modifications</h2>
              <p className="text-sm leading-relaxed">We reserve the right to modify these terms at any time. Material changes will be communicated via the app. Continued use after changes constitutes acceptance.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">10. Contact</h2>
              <p className="text-sm leading-relaxed">For questions about these Terms, contact us at legal@rentbuddy.app or through the in-app support channel.</p>
            </section>
          </div>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}
