import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ThemeProvider } from './lib/themeContext'

// Lazy-loaded auth pages
const LoginPage = lazy(() => import('./pages/auth/LoginPage').then(m => ({ default: m.LoginPage })))
const ClerkSignInPage = lazy(() => import('./pages/auth/ClerkSignInPage').then(m => ({ default: m.ClerkSignInPage })))
const ClerkSignUpPage = lazy(() => import('./pages/auth/ClerkSignUpPage').then(m => ({ default: m.ClerkSignUpPage })))
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage').then(m => ({ default: m.RegisterPage })))
const AccountTypePage = lazy(() => import('./pages/auth/AccountTypePage').then(m => ({ default: m.AccountTypePage })))
const AdminLoginPage = lazy(() => import('./pages/admin/AdminLoginPage').then(m => ({ default: m.AdminLoginPage })))
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })))
const VerifyEmailPage = lazy(() => import('./pages/auth/VerifyEmailPage').then(m => ({ default: m.VerifyEmailPage })))
const VerifyMobilePage = lazy(() => import('./pages/auth/VerifyMobilePage').then(m => ({ default: m.VerifyMobilePage })))

// Splash & Onboarding
const SplashPage = lazy(() => import('./pages/splash/SplashPage').then(m => ({ default: m.SplashPage })))
const OnboardingPage = lazy(() => import('./pages/onboarding/OnboardingPage').then(m => ({ default: m.OnboardingPage })))
const ProfileCompletionPage = lazy(() => import('./pages/profile/ProfileCompletionPage').then(m => ({ default: m.ProfileCompletionPage })))

// User pages
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })))
const ProfilePage = lazy(() => import('./pages/profile/ProfilePage').then(m => ({ default: m.ProfilePage })))
const VerificationPage = lazy(() => import('./pages/verification/VerificationPage').then(m => ({ default: m.VerificationPage })))
const KycStep1PersonalDetails = lazy(() => import('./pages/verification/KycStep1PersonalDetails').then(m => ({ default: m.KycStep1PersonalDetails })))
const KycStep2GovId = lazy(() => import('./pages/verification/KycStep2GovId').then(m => ({ default: m.KycStep2GovId })))
const KycStep3Selfie = lazy(() => import('./pages/verification/KycStep3Selfie').then(m => ({ default: m.KycStep3Selfie })))
const KycStep4AddressProof = lazy(() => import('./pages/verification/KycStep4AddressProof').then(m => ({ default: m.KycStep4AddressProof })))
const KycStep5EmergencyContact = lazy(() => import('./pages/verification/KycStep5EmergencyContact').then(m => ({ default: m.KycStep5EmergencyContact })))
const KycStep6Review = lazy(() => import('./pages/verification/KycStep6Review').then(m => ({ default: m.KycStep6Review })))
const VerifySelfiePage = lazy(() => import('./pages/verification/VerifySelfiePage').then(m => ({ default: m.VerifySelfiePage })))
const VerifyGovIdPage = lazy(() => import('./pages/verification/VerifyGovIdPage').then(m => ({ default: m.VerifyGovIdPage })))
const VerifyAddressPage = lazy(() => import('./pages/verification/VerifyAddressPage').then(m => ({ default: m.VerifyAddressPage })))
const WalletPage = lazy(() => import('./pages/wallet/WalletPage').then(m => ({ default: m.WalletPage })))
const TransactionHistoryPage = lazy(() => import('./pages/wallet/TransactionHistoryPage').then(m => ({ default: m.TransactionHistoryPage })))
const TopUpPage = lazy(() => import('./pages/wallet/TopUpPage').then(m => ({ default: m.TopUpPage })))
const WalkingRequestsPage = lazy(() => import('./pages/walking-requests/WalkingRequestsPage').then(m => ({ default: m.WalkingRequestsPage })))
const CreateWalkingRequestPage = lazy(() => import('./pages/walking-requests/CreateWalkingRequestPage').then(m => ({ default: m.CreateWalkingRequestPage })))
const WalkingRequestDetailPage = lazy(() => import('./pages/walking-requests/WalkingRequestDetailPage').then(m => ({ default: m.WalkingRequestDetailPage })))
const CommunitiesPage = lazy(() => import('./pages/communities/CommunitiesPage').then(m => ({ default: m.CommunitiesPage })))
const CommunityDetailPage = lazy(() => import('./pages/communities/CommunityDetailPage').then(m => ({ default: m.CommunityDetailPage })))
const EventsPage = lazy(() => import('./pages/events/EventsPage').then(m => ({ default: m.EventsPage })))
const EventDetailPage = lazy(() => import('./pages/events/EventDetailPage').then(m => ({ default: m.EventDetailPage })))
const MessagesPage = lazy(() => import('./pages/messages/MessagesPage').then(m => ({ default: m.MessagesPage })))
const ConversationPage = lazy(() => import('./pages/messages/ConversationPage').then(m => ({ default: m.ConversationPage })))
const PartnerJobsPage = lazy(() => import('./pages/partner/PartnerJobsPage').then(m => ({ default: m.PartnerJobsPage })))
const PartnerWalletPage = lazy(() => import('./pages/partner/PartnerWalletPage').then(m => ({ default: m.PartnerWalletPage })))
const PartnerProfilePage = lazy(() => import('./pages/partner/PartnerProfilePage').then(m => ({ default: m.PartnerProfilePage })))

// Admin pages
const AdminPortalPage = lazy(() => import('./pages/admin/AdminPortalPage').then(m => ({ default: m.AdminPortalPage })))
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage').then(m => ({ default: m.AdminDashboardPage })))
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage').then(m => ({ default: m.AdminUsersPage })))
const AdminKycPage = lazy(() => import('./pages/admin/AdminKycPage').then(m => ({ default: m.AdminKycPage })))
const AdminPartnersPage = lazy(() => import('./pages/admin/AdminWalkingPartnersPage').then(m => ({ default: m.AdminWalkingPartnersPage })))
const AdminWithdrawalsPage = lazy(() => import('./pages/admin/AdminWithdrawalsPage').then(m => ({ default: m.AdminWithdrawalsPage })))
const AdminBookingsPage = lazy(() => import('./pages/admin/AdminBookingsPage').then(m => ({ default: m.AdminBookingsPage })))
const AdminWalletsPage = lazy(() => import('./pages/admin/AdminWalletsPage').then(m => ({ default: m.AdminWalletsPage })))
const AdminDispatchPage = lazy(() => import('./pages/admin/AdminDispatchPage').then(m => ({ default: m.AdminDispatchPage })))
const AdminCommunitiesPage = lazy(() => import('./pages/admin/AdminCommunitiesPage').then(m => ({ default: m.AdminCommunitiesPage })))
const AdminEventsPage = lazy(() => import('./pages/admin/AdminEventsPage').then(m => ({ default: m.AdminEventsPage })))
const AdminServicesPage = lazy(() => import('./pages/admin/AdminServicesPage').then(m => ({ default: m.AdminServicesPage })))
const AdminChatReportsPage = lazy(() => import('./pages/admin/AdminChatReportsPage').then(m => ({ default: m.AdminChatReportsPage })))
const AdminReportsPage = lazy(() => import('./pages/admin/AdminReportsPage').then(m => ({ default: m.AdminReportsPage })))
const AdminAuditLogsPage = lazy(() => import('./pages/admin/AdminAuditLogsPage').then(m => ({ default: m.AdminAuditLogsPage })))
const AdminAdminsPage = lazy(() => import('./pages/admin/AdminAdminsPage').then(m => ({ default: m.AdminAdminsPage })))
const AdminPaymentsPage = lazy(() => import('./pages/admin/AdminPaymentsPage').then(m => ({ default: m.AdminPaymentsPage })))
const AdminSettingsPage = lazy(() => import('./pages/admin/AdminSettingsPage').then(m => ({ default: m.AdminSettingsPage })))
const AdminPricingPage = lazy(() => import('./pages/admin/AdminPricingPage').then(m => ({ default: m.AdminPricingPage })))
const AdminLiveTrackingPage = lazy(() => import('./pages/admin/AdminLiveTrackingPage').then(m => ({ default: m.AdminLiveTrackingPage })))

// Settings pages
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage').then(m => ({ default: m.SettingsPage })))
const PrivacyPage = lazy(() => import('./pages/settings/PrivacyPage').then(m => ({ default: m.PrivacyPage })))
const PrivacyPolicyPage = lazy(() => import('./pages/settings/PrivacyPolicyPage').then(m => ({ default: m.PrivacyPolicyPage })))
const TermsOfServicePage = lazy(() => import('./pages/settings/TermsOfServicePage').then(m => ({ default: m.TermsOfServicePage })))

// Notifications
const NotificationsPage = lazy(() => import('./pages/notifications/NotificationsPage').then(m => ({ default: m.NotificationsPage })))

// Wallet
const WithdrawalPage = lazy(() => import('./pages/wallet/WithdrawalPage').then(m => ({ default: m.WithdrawalPage })))

// New pages
const HomePage = lazy(() => import('./pages/home/HomePage').then(m => ({ default: m.HomePage })))
const DiscoverPage = lazy(() => import('./pages/discovery/DiscoveryHubPage').then(m => ({ default: m.DiscoveryHubPage })))
const DiscoveryCategoryPage = lazy(() => import('./components/DiscoveryCategoryPage').then(m => ({ default: m.DiscoveryCategoryPage })))
const BookingsListPage = lazy(() => import('./pages/bookings/BookingsListPage').then(m => ({ default: m.BookingsListPage })))
const CreateBookingPage = lazy(() => import('./pages/bookings/CreateBookingPage').then(m => ({ default: m.CreateBookingPage })))
const BookingDetailPage = lazy(() => import('./pages/bookings/BookingDetailPage').then(m => ({ default: m.BookingDetailPage })))
const BookingPaymentPage = lazy(() => import('./pages/bookings/BookingPaymentPage').then(m => ({ default: m.BookingPaymentPage })))
const BookingTrackingPage = lazy(() => import('./pages/bookings/BookingTrackingPage').then(m => ({ default: m.BookingTrackingPage })))
const RatingPage = lazy(() => import('./pages/bookings/RatingPage').then(m => ({ default: m.RatingPage })))
const PartnerDashboardPage = lazy(() => import('./pages/partner/PartnerDashboardPage').then(m => ({ default: m.PartnerDashboardPage })))
const PartnerGatePage = lazy(() => import('./pages/partner/PartnerGatePage').then(m => ({ default: m.PartnerGatePage })))
const PartnerMapPage = lazy(() => import('./pages/partner/PartnerMapPage').then(m => ({ default: m.PartnerMapPage })))
const PartnerPerformancePage = lazy(() => import('./pages/partner/PartnerPerformancePage').then(m => ({ default: m.PartnerPerformancePage })))
const SearchPage = lazy(() => import('./pages/search/SearchPage').then(m => ({ default: m.SearchPage })))

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="w-8 h-8 rounded-full border-2 border-surface-200 dark:border-surface-700 border-t-primary-500 animate-spin" />
    </div>
  )
}

function DiscoveryCategoryRoute() {
  const { categoryKey } = useParams()
  return <DiscoveryCategoryPage categoryKey={(categoryKey || 'dating') as any} />
}

export function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <Toaster position="top-center" toastOptions={{ duration: 3000, style: { background: '#18181b', color: '#fafafa', borderRadius: '16px' } }} />
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
          <Route path="/" element={<SplashPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/account-type" element={<AccountTypePage />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/sign-in" element={<ClerkSignInPage />} />
        <Route path="/sign-up" element={<ClerkSignUpPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/verify-mobile" element={<VerifyMobilePage />} />

          <Route element={<ProtectedRoute allowedRoles={['USER']} />}>
            <Route element={<Layout />}>
              <Route path="/profile/complete" element={<ProfileCompletionPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/verification" element={<VerificationPage />} />
              <Route path="/verification/step1" element={<KycStep1PersonalDetails />} />
              <Route path="/verification/step2" element={<KycStep2GovId />} />
              <Route path="/verification/step3" element={<KycStep3Selfie />} />
              <Route path="/verification/step4" element={<KycStep4AddressProof />} />
              <Route path="/verification/step5" element={<KycStep5EmergencyContact />} />
              <Route path="/verification/step6" element={<KycStep6Review />} />
              <Route path="/verification/selfie" element={<VerifySelfiePage />} />
              <Route path="/verification/gov-id" element={<VerifyGovIdPage />} />
              <Route path="/verification/address" element={<VerifyAddressPage />} />
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/wallet/topup" element={<TopUpPage />} />
              <Route path="/wallet/withdraw" element={<WithdrawalPage />} />
              <Route path="/wallet/transactions" element={<TransactionHistoryPage />} />
              <Route path="/wallet/history" element={<TransactionHistoryPage />} />
              {/* New Home & Discovery */}
              <Route path="/home" element={<HomePage />} />
              <Route path="/discover" element={<DiscoverPage />} />
              <Route path="/discover/:categoryKey" element={<DiscoveryCategoryRoute />} />

              {/* New Booking System */}
              <Route path="/bookings" element={<BookingsListPage />} />
              <Route path="/bookings/create" element={<CreateBookingPage />} />
              <Route path="/bookings/:id" element={<BookingDetailPage />} />
              <Route path="/bookings/:id/payment" element={<BookingPaymentPage />} />
              <Route path="/bookings/:id/tracking" element={<BookingTrackingPage />} />
              <Route path="/bookings/:id/rate" element={<RatingPage />} />

              <Route path="/walking-requests" element={<WalkingRequestsPage />} />
              <Route path="/walking-requests/create" element={<CreateWalkingRequestPage />} />
              <Route path="/walking-requests/:id" element={<WalkingRequestDetailPage />} />
              <Route path="/communities" element={<CommunitiesPage />} />
              <Route path="/communities/:id" element={<CommunityDetailPage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route path="/events/:id" element={<EventDetailPage />} />
              <Route path="/messages" element={<MessagesPage />} />
              <Route path="/messages/:userId" element={<ConversationPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/privacy" element={<PrivacyPage />} />
              <Route path="/settings/privacy/privacy-policy" element={<PrivacyPolicyPage />} />
              <Route path="/settings/privacy/terms" element={<TermsOfServicePage />} />
              <Route path="/search" element={<SearchPage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['PARTNER']} />}>
            <Route element={<Layout />}>
              <Route path="/partner/pending" element={<PartnerGatePage />} />
              <Route path="/partner/dashboard" element={<PartnerDashboardPage />} />
              <Route path="/partner/jobs" element={<PartnerJobsPage />} />
              <Route path="/partner/map" element={<PartnerMapPage />} />
              <Route path="/partner/wallet" element={<PartnerWalletPage />} />
              <Route path="/partner/performance" element={<PartnerPerformancePage />} />
              <Route path="/partner/profile" element={<PartnerProfilePage />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['ADMIN', 'SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'FINANCE']} />}>
            <Route element={<Layout />}>
              <Route path="/admin/portal" element={<AdminPortalPage />} />
              <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/kyc" element={<AdminKycPage />} />
              <Route path="/admin/partners" element={<AdminPartnersPage />} />
              <Route path="/admin/withdrawals" element={<AdminWithdrawalsPage />} />
              <Route path="/admin/bookings" element={<AdminBookingsPage />} />
              <Route path="/admin/wallets" element={<AdminWalletsPage />} />
              <Route path="/admin/dispatch" element={<AdminDispatchPage />} />
              <Route path="/admin/communities" element={<AdminCommunitiesPage />} />
              <Route path="/admin/events" element={<AdminEventsPage />} />
              <Route path="/admin/services" element={<AdminServicesPage />} />
              <Route path="/admin/chat-reports" element={<AdminChatReportsPage />} />
              <Route path="/admin/reports" element={<AdminReportsPage />} />
              <Route path="/admin/audit-logs" element={<AdminAuditLogsPage />} />
              <Route path="/admin/admins" element={<AdminAdminsPage />} />
              <Route path="/admin/payments" element={<AdminPaymentsPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
          <Route path="/admin/pricing" element={<AdminPricingPage />} />
          <Route path="/admin/live-tracking" element={<AdminLiveTrackingPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </ErrorBoundary>
    </ThemeProvider>
  )
}
