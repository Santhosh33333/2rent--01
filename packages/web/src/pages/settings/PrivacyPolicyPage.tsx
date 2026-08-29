import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Shield } from 'lucide-react'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'

export function PrivacyPolicyPage() {
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
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/25">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Privacy Policy</h1>
              <p className="text-sm text-surface-500">Last updated: August 29, 2026</p>
            </div>
          </div>

          <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-surface-700 dark:text-surface-300">
            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">1. Information We Collect</h2>
              <p className="text-sm leading-relaxed">We collect information you provide directly, including your name, email address, phone number, profile photo, location data (when enabled), and payment information. We also collect usage data such as booking history, chat messages, and app interaction patterns.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">2. How We Use Your Information</h2>
              <p className="text-sm leading-relaxed">We use your information to provide and improve our services, process bookings and payments, match you with service providers, send notifications, ensure safety, and comply with legal obligations. We do not sell your personal data to third parties.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">3. Location Data</h2>
              <p className="text-sm leading-relaxed">When you enable location sharing, we collect your GPS coordinates to facilitate service matching and real-time tracking during active bookings. Location data is not stored longer than necessary and is not shared with other users outside of active service sessions.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">4. Data Sharing</h2>
              <p className="text-sm leading-relaxed">We share your information only with service providers (partners) as needed to fulfill bookings, with payment processors for transactions, and with law enforcement when legally required. Your profile information visible to others is controlled by your privacy settings.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">5. Data Security</h2>
              <p className="text-sm leading-relaxed">We implement industry-standard security measures including encryption in transit (TLS) and at rest, secure authentication tokens, and regular security audits. However, no method of transmission over the Internet is 100% secure.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">6. Data Retention</h2>
              <p className="text-sm leading-relaxed">We retain your account information for as long as your account is active. Booking records are retained for 7 years for legal and accounting purposes. You may request data deletion through the Privacy settings page.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">7. Your Rights</h2>
              <p className="text-sm leading-relaxed">You have the right to access, correct, or delete your personal data. You can manage most privacy preferences directly in the app. For additional requests, contact our support team.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">8. Children's Privacy</h2>
              <p className="text-sm leading-relaxed">Our services are not intended for users under 18. We do not knowingly collect data from minors. If we become aware of such collection, we will delete the information promptly.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">9. Changes to This Policy</h2>
              <p className="text-sm leading-relaxed">We may update this Privacy Policy from time to time. We will notify you of significant changes through the app or via email. Continued use of the app after changes constitutes acceptance of the updated policy.</p>
            </section>

            <section>
              <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-3">10. Contact Us</h2>
              <p className="text-sm leading-relaxed">For privacy-related inquiries, contact us at privacy@rentbuddy.app or through the in-app support channel.</p>
            </section>
          </div>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}
