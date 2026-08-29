import { useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, Shield, Lock, Scale } from 'lucide-react'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'

export function TermsPage() {
  const navigate = useNavigate()
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group">
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back</span>
      </button>
      <AnimatedPage>
        <GlassCard variant="elevated" padding="lg" className="prose prose-sm dark:prose-invert max-w-none">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center"><FileText className="w-6 h-6 text-white" /></div>
            <div><h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white !mb-0">Terms & Conditions</h1><p className="text-xs text-surface-500 !mt-1">Effective Date: July 19, 2026</p></div>
          </div>
          <div className="space-y-6 text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">1. Acceptance of Terms</h2><p>By accessing or using RentBuddy ("the App"), you agree to be bound by these Terms & Conditions. If you do not agree, do not use the App.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">2. Eligibility</h2><p>You must be at least 18 years old to use RentBuddy. By using the App, you represent that you meet this age requirement and have the legal capacity to enter into these Terms.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">3. Account Registration</h2><p>You must provide accurate and complete information during registration. You are responsible for maintaining the confidentiality of your account credentials. You must notify us immediately of any unauthorized use of your account.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">4. User Conduct</h2><p>You agree not to: harass, bully, or abuse other users; share inappropriate, offensive, or illegal content; impersonate any person or entity; attempt to gain unauthorized access to other accounts or systems; use the App for any illegal purpose; or engage in commercial solicitation without authorization.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">5. Walking Partner Services</h2><p>Walking Partner services are provided by independent individuals. RentBuddy facilitates connections but is not a party to any agreement between users and walking partners. Users should exercise caution and use the OTP verification system for safety.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">6. Payment Terms</h2><p>All payments are processed through our secure payment system. Platform fees are deducted as configured. Withdrawal requests are subject to approval. Refund requests are handled on a case-by-case basis.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">7. Privacy</h2><p>Your use of RentBuddy is also governed by our Privacy Policy. Please review it to understand our practices regarding your personal data.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">8. Intellectual Property</h2><p>All content, trademarks, and intellectual property on RentBuddy are owned by or licensed to us. You may not reproduce, distribute, or create derivative works without our written consent.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">9. Limitation of Liability</h2><p>RentBuddy is provided "as is" without warranties of any kind. We are not liable for any indirect, incidental, special, or consequential damages arising from your use of the App.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">10. Termination</h2><p>We reserve the right to suspend or terminate your account at any time for violation of these Terms or for any other reason at our sole discretion.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">11. Governing Law</h2><p>These Terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of courts in India.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">12. Changes to Terms</h2><p>We may update these Terms from time to time. Continued use of the App after changes constitutes acceptance of the updated Terms.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">13. Contact</h2><p>For questions about these Terms, contact us at support@rentbuddy.app</p></section>
          </div>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}

export function PrivacyPolicyPage() {
  const navigate = useNavigate()
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group">
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back</span>
      </button>
      <AnimatedPage>
        <GlassCard variant="elevated" padding="lg" className="prose prose-sm dark:prose-invert max-w-none">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center"><Shield className="w-6 h-6 text-white" /></div>
            <div><h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white !mb-0">Privacy Policy</h1><p className="text-xs text-surface-500 !mt-1">Effective Date: July 19, 2026</p></div>
          </div>
          <div className="space-y-6 text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">1. Information We Collect</h2><p>We collect information you provide directly: name, email, phone number, date of birth, gender, location, profile photos, government ID for verification, bank/UPI details for payments, and emergency contact information. We also collect device information, usage data, and location data when you use our services.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">2. How We Use Your Information</h2><p>We use your information to: provide and improve our services, process payments, verify your identity, ensure safety, communicate with you, send notifications, prevent fraud, and comply with legal obligations.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">3. Information Sharing</h2><p>We share your information only: with other users as needed for service delivery (e.g., walking partners see your name during active requests), with service providers who assist our operations, when required by law, and with your explicit consent. We never sell your personal data to third parties.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">4. Data Security</h2><p>We implement industry-standard security measures including encryption, secure servers, access controls, and regular security audits. However, no method of transmission over the Internet is 100% secure.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">5. Data Retention</h2><p>We retain your information for as long as your account is active or as needed to provide services. After account deletion, we retain certain data for legal and operational purposes for up to 90 days.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">6. Your Rights</h2><p>You have the right to: access your personal data, correct inaccurate data, request deletion of your data, export your data, opt out of notifications, and disable location sharing. You can exercise these rights through the App settings or by contacting us.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">7. Children's Privacy</h2><p>RentBuddy is not intended for users under 18 years of age. We do not knowingly collect information from children under 18.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">8. Location Data</h2><p>We collect and process location data only when you actively use location-dependent features (e.g., live walk tracking, nearby people). You can disable location sharing at any time through Settings.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">9. Contact Us</h2><p>For privacy-related inquiries, contact our Data Protection Officer at privacy@rentbuddy.app</p></section>
          </div>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}

export function DataSafetyPage() {
  const navigate = useNavigate()
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group">
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back</span>
      </button>
      <AnimatedPage>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center"><Lock className="w-6 h-6 text-white" /></div>
            <div><h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white !mb-0">Data Safety</h1><p className="text-xs text-surface-500 !mt-1">Google Play Data Safety Disclosure</p></div>
          </div>
          <div className="space-y-6 text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
            <section>
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Data Collected</h2>
              <div className="space-y-3 mt-3">
                <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                  <p className="font-medium text-surface-900 dark:text-white">Personal Info</p>
                  <p>Name, email, phone number, date of birth, gender</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                  <p className="font-medium text-surface-900 dark:text-white">Financial Info</p>
                  <p>Bank account, UPI ID (for partner withdrawals only)</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                  <p className="font-medium text-surface-900 dark:text-white">Location</p>
                  <p>Approximate and precise location (only during active walk requests)</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                  <p className="font-medium text-surface-900 dark:text-white">Photos & Media</p>
                  <p>Profile photos, verification documents (encrypted storage)</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                  <p className="font-medium text-surface-900 dark:text-white">Contacts</p>
                  <p>Emergency contact information (only for safety features)</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                  <p className="font-medium text-surface-900 dark:text-white">Activity</p>
                  <p>Usage history, search queries, walk history, transactions</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                  <p className="font-medium text-surface-900 dark:text-white">Device Info</p>
                  <p>Device type, OS version, FCM token for push notifications</p>
                </div>
              </div>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">How Data Is Used</h2>
              <ul className="list-disc list-inside space-y-1 mt-2">
                <li>To provide core services (matching, payments, communication)</li>
                <li>For identity verification and fraud prevention</li>
                <li>To improve app performance and user experience</li>
                <li>For safety features (SOS, live tracking with consent)</li>
                <li>To comply with legal obligations</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Data Sharing</h2>
              <p className="mt-2">We share limited data with: other users during active service requests, payment processors (for transactions), and analytics providers (anonymized). We do NOT sell personal data.</p>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Data Security</h2>
              <p className="mt-2">Data is encrypted in transit (TLS 1.3) and at rest (AES-256). We use secure cloud infrastructure with SOC 2 compliance. Regular security audits are conducted.</p>
            </section>
            <section>
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Data Deletion</h2>
              <p className="mt-2">Users can delete their account and all associated data at any time through Settings → Privacy → Delete Account. Data is permanently deleted within 90 days.</p>
            </section>
          </div>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}

export function CommunityGuidelinesPage() {
  const navigate = useNavigate()
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group">
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back</span>
      </button>
      <AnimatedPage>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center"><Scale className="w-6 h-6 text-white" /></div>
            <div><h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white !mb-0">Community Guidelines</h1><p className="text-xs text-surface-500 !mt-1">Building a safe and respectful community</p></div>
          </div>
          <div className="space-y-6 text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">Be Respectful</h2><p>Treat all users with respect and dignity. Harassment, bullying, hate speech, discrimination, and personal attacks are strictly prohibited.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">Stay Safe</h2><p>Always use the OTP verification system for walks. Meet in public places. Share your live location with trusted contacts. Use the SOS feature in emergencies. Trust your instincts.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">Be Honest</h2><p>Maintain accurate profile information. Do not impersonate others. Do not create fake accounts. Verified profiles build trust in our community.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">No Illegal Activity</h2><p>RentBuddy must not be used for any illegal activities including but not limited to: theft, fraud, drug use, violence, or any activity that violates Indian law.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">Protect Privacy</h2><p>Do not share other users' personal information without consent. Do not record or photograph others without their permission. Respect everyone's right to privacy.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">Report Issues</h2><p>If you encounter inappropriate behavior, safety concerns, or rule violations, please report them immediately. You can block users who make you uncomfortable.</p></section>
            <section><h2 className="text-lg font-semibold text-surface-900 dark:text-white">Consequences</h2><p>Violation of these guidelines may result in warnings, temporary suspension, or permanent account termination. Severe violations will be reported to law enforcement.</p></section>
          </div>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}
