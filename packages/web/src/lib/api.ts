import axios from 'axios'
import type {
  PaginationParams,
  BookingCreateInput,
  BookingVerifyPayment,
  BookingRate,
  PriceEstimateParams,
  PartnerApplicationInput,
  ToggleAvailability,
  UpdateLocation,
  UpdateServices,
  KycRejectReason,
  ReportResolve,
  PricingConfigInput,
  AdminAccountInput,
} from '../types/api'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'

function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${crypto.randomUUID().slice(0, 8)}`
}

// Backend returns media as relative paths (e.g. /uploads/avatar.jpg).
// Resolve them against the API origin so they work in dev (via the Vite
// /uploads proxy) and in prod/Capacitor builds where the SPA is not
// same-origin with the API.
export function assetUrl(path?: string | null): string | undefined {
  if (!path) return undefined
  if (/^https?:\/\//i.test(path)) return path
  if (!path.startsWith('/')) return path
  return new URL(path, API_BASE_URL.replace(/\/api\/?$/, '')).toString()
}

const refreshClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 60000,
})

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    if (['post', 'put', 'patch'].includes(config.method ?? '') && !config.headers['X-Idempotency-Key']) {
      config.headers['X-Idempotency-Key'] = generateIdempotencyKey()
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Single-flight refresh: concurrent 401s share ONE refresh call so the
// rotating refresh token is consumed exactly once (prevents random logouts).
let refreshPromise: Promise<string> | null = null

function clearSessionStorage() {
  localStorage.removeItem('token')
  localStorage.removeItem('refreshToken')
  localStorage.removeItem('user')
  localStorage.removeItem('activeRole')
  localStorage.removeItem('impersonating')
}

async function doRefresh(refreshToken: string): Promise<string> {
  const refreshResponse = await refreshClient.post('/auth/refresh-token', { refreshToken })
  const payload = refreshResponse.data?.data || refreshResponse.data
  const newAccessToken = payload?.accessToken
  const newRefreshToken = payload?.refreshToken

  if (!newAccessToken) throw new Error('No access token in refresh response')

  localStorage.setItem('token', newAccessToken)
  if (newRefreshToken) localStorage.setItem('refreshToken', newRefreshToken)
  return newAccessToken as string
}

// Shared entry point for ALL token refreshes (interceptor + boot restore).
// Single-flight guarantees the single-use refresh token is consumed once.
export async function refreshSessionTokens(): Promise<string> {
  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) throw new Error('No refresh token available')
  if (!refreshPromise) {
    refreshPromise = doRefresh(refreshToken).finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config || {}
    const status = error.response?.status
    const url = String(originalRequest.url || '')

    const shouldSkipRefresh =
      url.includes('/auth/login') ||
      url.includes('/auth/register') ||
      url.includes('/auth/refresh-token') ||
      url.includes('/auth/google') ||
      url.includes('/auth/phone')

    // --- one retry for transient failures ---------------------------------
    // The production API is on Render's free tier, which spins the instance
    // down when idle. Waking it measured 32.6s end to end on a cold hit, and
    // during that window the proxy answers 502/503/504 or the socket simply
    // fails. On a phone that is the difference between a page that loads and a
    // page that dies, because a rejected read that a page did not guard takes
    // the render down and the app-level ErrorBoundary takes over.
    //
    // Deliberately restricted to GET. A retried POST can duplicate a real
    // write - a booking, a payment order, a wallet debit - and no amount of
    // "it is probably fine" makes that acceptable. Reads are safe to repeat.
    const method = String(originalRequest.method || 'get').toLowerCase()
    const isTransient =
      // No response at all: DNS, offline, connection reset, TLS failure.
      (!error.response && Boolean(error.request)) ||
      status === 502 ||
      status === 503 ||
      status === 504
    // A cancelled request is the caller aborting on purpose (route change,
    // component unmount). Retrying it would resurrect work nobody wants.
    const wasCancelled = error.code === 'ERR_CANCELED' || axios.isCancel?.(error)

    if (method === 'get' && isTransient && !wasCancelled && !originalRequest._transientRetry) {
      originalRequest._transientRetry = true
      await new Promise((resolve) => setTimeout(resolve, 1200))
      return api(originalRequest)
    }

    // Legal consent gate. The server refuses booking / partner-apply with 403 +
    // LEGAL_CONSENT_REQUIRED and names the missing documents. Rather than
    // surfacing a raw error, send the user to sign and return them to the page
    // they were trying to reach, so the interrupted action is recoverable.
    const gateError = error.response?.data?.error
    if (status === 403 && gateError?.code === 'LEGAL_CONSENT_REQUIRED') {
      const gate = String(gateError.gate || 'SIGNUP')
      const currentPath = window.location.pathname + window.location.search
      const onConsentScreen = currentPath.startsWith('/legal/consent')
      if (!onConsentScreen && !url.includes('/legal/')) {
        const next = encodeURIComponent(currentPath)
        window.location.assign(`/legal/consent?gate=${encodeURIComponent(gate)}&next=${next}`)
        // Never resolve the original call as success while navigating away.
        return new Promise(() => {})
      }
    }

    // Paid access gate. The server refuses the paid surface with 403 +
    // PAID_ACCESS_REQUIRED once the 30-day window lapses. Same reasoning as the
    // consent gate: send them to renew and bring them back to the page they were
    // trying to reach, so the interrupted action survives the interruption.
    if (status === 403 && gateError?.code === 'PAID_ACCESS_REQUIRED') {
      const currentPath = window.location.pathname + window.location.search
      const onPaywall = currentPath.startsWith('/subscription')
      if (!onPaywall) {
        const next = encodeURIComponent(currentPath)
        window.location.assign(`/subscription?next=${next}`)
        // Never resolve the original call as success while navigating away.
        return new Promise(() => {})
      }
    }

    if (status === 401 && !originalRequest._retry && !shouldSkipRefresh) {
      originalRequest._retry = true
      try {
        const newAccessToken = await refreshSessionTokens()

        originalRequest.headers = originalRequest.headers || {}
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`
        return api(originalRequest)
      } catch (refreshError) {
        // Generation guard: only wipe when no newer session won the race.
        // If another in-flight refresh already stored fresh tokens, the
        // stored token differs from the one this request attempted with —
        // wiping now would delete a VALID session (the login-loop bug).
        const attempted = String(originalRequest.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
        const current = localStorage.getItem('token') || ''
        if (!current || current === attempted) {
          clearSessionStorage()
          // Entry/portal pages decide routing themselves (Splash, onboarding,
          // account-type, admin login): never yank them to /login.
          if (typeof window !== 'undefined' && !['/', '/login', '/register', '/forgot-password', '/onboarding', '/account-type', '/admin/login'].includes(window.location.pathname)) {
            window.location.replace('/login')
          }
        }
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  }
)

// Booking API
export const bookingApi = {
  create: (data: BookingCreateInput) => api.post('/bookings', data),
  list: (params?: PaginationParams) => api.get('/bookings', { params }),
  getById: (id: string) => api.get(`/bookings/${id}`),
  pay: (id: string) => api.post(`/bookings/${id}/pay`),
  verifyPayment: (id: string, data: BookingVerifyPayment) => api.post(`/bookings/${id}/verify-payment`, data),
  cancel: (id: string, data?: { reason?: string }) => api.post(`/bookings/${id}/cancel`, data),
  rate: (id: string, data: BookingRate) => api.post(`/bookings/${id}/rate`, data),
  priceEstimate: (params: PriceEstimateParams) => api.get('/bookings/price-estimate', { params }),
  tracking: (id: string) => api.get(`/bookings/${id}/tracking`),
  getStartCode: (id: string) => api.post(`/bookings/${id}/start-otp`),
  getCompletionCode: (id: string) => api.post(`/bookings/${id}/completion-otp`),
  selectPaymentMethod: (id: string, data: { paymentMethod: string }) => api.post(`/bookings/${id}/select-payment-method`, data),
}

// Partner API
export const partnerApi = {
  apply: (data: PartnerApplicationInput) => api.post('/partner/apply', data),
  status: () => api.get('/partner/status'),
  nearbyBookings: () => api.get('/partner/nearby-bookings'),
  acceptBooking: (id: string) => api.post(`/partner/bookings/${id}/accept`),
  rejectBooking: (id: string) => api.post(`/partner/bookings/${id}/reject`),
  generateOTP: (id: string) => api.post(`/partner/bookings/${id}/otp/generate`),
  verifyOTP: (id: string, data: { otp: string }) => api.post(`/partner/bookings/${id}/otp/verify`, data),
  goToJob: (id: string) => api.post(`/partner/bookings/${id}/go`),
  markArrived: (id: string) => api.post(`/partner/bookings/${id}/arrived`),
  verifyStartCode: (id: string, data: { startOtp: string }) => api.post(`/partner/bookings/${id}/start-verify`, data),
  requestCompletion: (id: string) => api.post(`/partner/bookings/${id}/request-completion`),
  completeBooking: (id: string, data?: { completionOtp?: string }) => api.post(`/partner/bookings/${id}/complete`, data),
  bookings: (params?: PaginationParams) => api.get('/partner/bookings', { params }),
  performance: () => api.get('/partner/performance'),
  toggleAvailability: (data: ToggleAvailability) => api.put('/partner/availability', data),
  updateLocation: (data: UpdateLocation) => api.put('/partner/location', data),
  updateServices: (data: UpdateServices) => api.put('/partner/services', data),
}

// Admin API
export const adminApi = {
  getDashboard: () => api.get('/admin/dashboard'),
  getDashboardStats: () => api.get('/admin/dashboard'),
  getUsers: (params?: PaginationParams) => api.get('/admin/users', { params }),
  getUserDetail: (id: string) => api.get(`/admin/users/${id}`),
  updateUserStatus: (id: string, status: string) => api.put(`/admin/users/${id}/status`, { status }),
  updateUserPhone: (id: string, phone: string) => api.put(`/admin/users/${id}/phone`, { phone }),
  getKycQueue: (params?: PaginationParams) => api.get('/admin/kyc-queue', { params }),
  approveKyc: (id: string) => api.post(`/admin/kyc/${id}/approve`),
  rejectKyc: (id: string, data: KycRejectReason) => api.post(`/admin/kyc/${id}/reject`, data),
  getPartners: (params?: PaginationParams) => api.get('/admin/walking-partners', { params }),
  approvePartner: (id: string) => api.post(`/admin/walking-partners/${id}/approve`),
  rejectPartner: (id: string, reason?: string) => api.post(`/admin/walking-partners/${id}/reject`, { reason }),
  suspendPartner: (id: string, reason?: string) => api.post(`/admin/walking-partners/${id}/suspend`, { reason }),
  reactivatePartner: (id: string) => api.post(`/admin/walking-partners/${id}/reactivate`),
  promoteUser: (userId: string, role: string) => api.post(`/admin/users/${userId}/promote`, { role }),
  demoteUser: (userId: string, role?: string) => api.post(`/admin/users/${userId}/demote`, { role }),
  getBookings: (params?: PaginationParams) => api.get('/admin/bookings', { params }),
  getBookingDetail: (id: string) => api.get(`/admin/bookings/${id}`),
  getWithdrawals: (params?: PaginationParams) => api.get('/admin/withdrawals', { params }),
  approveWithdrawal: (id: string) => api.post(`/admin/withdrawals/${id}/approve`),
  approveWithdrawalWithProof: (id: string, proof: File) => {
    const fd = new FormData()
    fd.append('proof', proof)
    return api.post(`/admin/withdrawals/${id}/approve-with-proof`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
  },
  rejectWithdrawal: (id: string, reason?: string) => api.post(`/admin/withdrawals/${id}/reject`, { reason }),
  getWallets: (params?: PaginationParams) => api.get('/admin/wallets', { params }),
  getDispatchBoard: (params?: PaginationParams) => api.get('/admin/dispatch-board', { params }),
  getAdminCommunities: (params?: PaginationParams) => api.get('/admin/communities', { params }),
  getAdminEvents: (params?: PaginationParams) => api.get('/admin/events', { params }),
  getServices: () => api.get('/admin/services'),
  getChatReports: (params?: PaginationParams) => api.get('/admin/chat-reports', { params }),
  resolveChatReport: (id: string) => api.post(`/admin/chat-reports/${id}/resolve`),
  getReports: (params?: PaginationParams) => api.get('/admin/reports', { params }),
  resolveReport: (id: string, data?: ReportResolve) => api.post(`/admin/reports/${id}/resolve`, data),
  getAuditLogs: (params?: PaginationParams) => api.get('/admin/audit-logs', { params }),
  // Broadcast email to all users (or one role scope)
  broadcastEmail: (data: { subject: string; body: string; audience?: 'ALL' | 'USERS' | 'PARTNERS' }) =>
    api.post('/admin/email/broadcast', { ...data, audience: data.audience || 'ALL' }),
  getEmailStatus: () => api.get('/admin/email/status'),
  sendTestEmail: (to: string) => api.post('/admin/email/test', { to }),
  // Payment Center (historical order ledger; Cashfree is retired, so these rows
  // are the record of what the gateway used to do rather than a live rail)
  getPayments: (params?: PaginationParams) => api.get('/admin/payments', { params }),
  getPaymentStats: () => api.get('/admin/payments/stats'),
  // Subscription payments collected by manual UPI. Separate from `getPayments`
  // on purpose: the money buys a billing period and never touches a wallet, so
  // folding it into the gateway order ledger would make one payment look like
  // two. This queue was unreachable from the UI for a while - the endpoint
  // existed and nothing called it, which is why subscription payments appeared
  // to vanish.
  getSubscriptionPayments: (params?: PaginationParams) =>
    api.get('/admin/payments/subscriptions', { params }),
  verifySubscriptionPayment: (id: string, data: { action: 'VERIFY' | 'REJECT' | 'REQUEST_INFO'; note?: string }) =>
    api.post(`/admin/payments/subscriptions/${id}/verify`, data),
  // Manual UPI verification (temporary flow for personal UPI accounts)
  getUpiPayments: (params?: PaginationParams) => api.get('/admin/payments/upi', { params }),
  verifyUpiPayment: (id: string, data: { action: 'VERIFY' | 'REJECT' | 'REQUEST_INFO'; note?: string }) =>
    api.post(`/admin/payments/upi/${id}/verify`, data),
  // Manual-UPI top-up review (user pays platform QR, admin credits the wallet)
  getTopupRequests: (params?: PaginationParams) => api.get('/admin/topup-requests', { params }),
  verifyTopupRequest: (id: string, data: { action: 'VERIFY' | 'REJECT' | 'REQUEST_INFO'; note?: string }) =>
    api.post(`/admin/topup-requests/${id}/verify`, data),
  // ---- Bank statement reconciliation --------------------------------------
  // `uploadStatement` posts the file as multipart form-data, which is why it
  // does not reuse `api.post`'s JSON default: setting Content-Type by hand there
  // would strip the multipart boundary the server needs to parse it.
  uploadStatement: (file: File) => {
    const form = new FormData()
    form.append('statement', file)
    return api.post('/admin/bank-statements', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  getBankStatements: (params?: PaginationParams) => api.get('/admin/bank-statements', { params }),
  getBankStatement: (id: string) => api.get(`/admin/bank-statements/${id}`),
  getUnresolvedStatementRows: (params?: PaginationParams) => api.get('/admin/bank-statements/unresolved', { params }),
  applyBankStatement: (id: string, note?: string) => api.post(`/admin/bank-statements/${id}/apply`, { note }),
  rematchBankStatement: (id: string) => api.post(`/admin/bank-statements/${id}/rematch`),
  decideStatementRow: (
    rowId: string,
    data: {
      decision: 'CREDIT' | 'REJECT' | 'IGNORE'
      comment: string
      matchedType?: 'TOPUP' | 'UPI_PAYMENT'
      matchedId?: string
      amountMismatchAccepted?: boolean
    },
  ) => api.post(`/admin/bank-statements/rows/${rowId}/decision`, data),
  getUpiConfig: () => api.get('/admin/settings/upi'),
  setUpiConfig: (data: { upiId: string; accountName?: string; qrUrl?: string }) => api.put('/admin/settings/upi', data),
  // Platform settings (dynamic pricing config, e.g. PLATFORM_FEE_PERCENT)
  getPricingConfigs: (params?: PaginationParams) => api.get('/admin/pricing', { params }),
  createPricingConfig: (data: PricingConfigInput) => api.post('/admin/pricing', data),
  updatePricingConfig: (id: string, data: PricingConfigInput) => api.put(`/admin/pricing/${id}`, data),
  deletePricingConfig: (id: string) => api.delete(`/admin/pricing/${id}`),
  simulatePricing: (data: PriceEstimateParams) => api.post('/admin/pricing/simulate', data),
  // Free trial. One length, read by the landing pages and enforced at signup.
  // `days: null` on setUserTrial revokes access for that account.
  getTrialConfig: () => api.get('/admin/subscriptions/trial'),
  setTrialDays: (days: number, reason?: string) =>
    api.post('/admin/subscriptions/trial', { days, reason }),
  grantTrialToAll: (days?: number, reason?: string) =>
    api.post('/admin/subscriptions/trial/grant-all', { days, reason }),
  setUserTrial: (userId: string, days: number | null, reason?: string) =>
    api.post(`/admin/subscriptions/trial/users/${userId}`, { days, reason }),
  // User / partner account blocking with duration + deletion
  blockUser: (userId: string, data: { durationDays?: number; durationYears?: number; permanent?: boolean; reason?: string }) =>
    api.post(`/admin/users/${userId}/block`, data),
  unblockUser: (userId: string) => api.post(`/admin/users/${userId}/unblock`),
  deleteUser: (userId: string) => api.delete(`/admin/users/${userId}`),
  // Bulk selection for the user table. One request, one audit trail, and the
  // server reports per-account outcomes instead of failing the whole batch.
  bulkUserAction: (action: 'suspend' | 'delete', userIds: string[]) =>
    api.post('/admin/users/bulk-action', { action, userIds }),
  // Admin account provisioning (SUPER_ADMIN only)
  getAdminAccounts: () => api.get('/admin/admins'),
  createAdminAccount: (data: AdminAccountInput) => api.post('/admin/admins', data),
  updateAdminAccount: (userId: string, data: AdminAccountInput) => api.patch(`/admin/admins/${userId}`, data),
  resetAdminPassword: (userId: string) => api.post(`/admin/admins/${userId}/reset-password`),
  // Agreement archive (legal records)
  getAgreements: (params?: PaginationParams) => api.get('/admin/agreements', { params }),
  getAgreement: (id: string) => api.get(`/admin/agreements/${id}`),
}

// Post-KYC agreements (member self-serve)
export const agreementApi = {
  getMyAgreements: () => api.get('/users/agreements'),
  getAgreement: (id: string) => api.get(`/users/agreements/${id}`),
  accept: (id: string) => api.post(`/users/agreements/${id}/accept`),
}

// Versioned legal documents + signed consent capture.
// `accept` records a real signature; the server seals it with the document
// version, a content hash, the IP and the user agent, then mails copies.
export const legalApi = {
  documents: () => api.get('/legal/documents'),
  document: (kind: string) => api.get(`/legal/documents/${kind}`),
  consent: (gate: string) => api.get(`/legal/consent?gate=${encodeURIComponent(gate)}`),
  accept: (body: {
    kind: string
    signatureType: 'TYPED_NAME' | 'DRAWN'
    signatureValue: string
    consentType: string
  }) => api.post('/legal/accept', body),
  myAcceptances: () => api.get('/legal/acceptances'),
  reConsent: () => api.get('/legal/re-consent'),
}

export type LegalDocKind =
  | 'USER_AGREEMENT'
  | 'PARTNER_AGREEMENT'
  | 'PRIVACY_POLICY'
  | 'COMMUNITY_GUIDELINES'
  | 'BOOKING_POLICY'

// Account role switching (USER <-> PARTNER), backend-enforced
export const authRoleApi = {
  switchRole: (role: string) => api.post('/auth/switch-role', { role }),
}

// Manual-UPI wallet top-ups (no gateway — pay the platform QR, then UTR)
export const walletApi = {
  get: () => api.get('/wallet'),
  getConfig: () => api.get('/wallet/config'),
  getTransactions: (params?: PaginationParams) => api.get('/wallet/transactions', { params }),
  getWithdrawals: (params?: PaginationParams) => api.get('/wallet/withdrawals', { params }),
  getMyTopupRequests: () => api.get('/wallet/topup-requests'),
  requestTopup: (data: { amount: number; referenceNumber: string }) => api.post('/wallet/topup-requests', data),
  uploadTopupProof: (id: string, proof: File) => {
    const fd = new FormData()
    fd.append('proof', proof)
    // The backend route is `POST /api/wallet/:id/topup-proof`. This used to
    // include an extra "topup-requests/" segment, so every proof upload 404'd
    // (and the upload has no fallback that would have saved it).
    return api.post(`/wallet/${id}/topup-proof`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
  },
  requestWithdrawal: (data: { amount: number; method: string; accountDetail: string }) => api.post('/wallet/withdraw', data),
  cancelWithdrawal: (id: string) => api.delete(`/wallet/withdraw/${id}`),
}

export const paymentsApi = {
  /**
   * Which rail is live, plus the platform UPI details needed to pay manually.
   *
   * `activeMethod` is the single value a client should branch on: "gateway",
   * "manual_upi" or "none". It exists precisely so that no client has to
   * hardcode a provider, and it was previously unreadable because no client
   * method reached the endpoint at all.
   */
  getConfig: () => api.get('/payments/config'),
}

// Global social feed (/api/posts). No KYC gate on the server, same as the
// mobile client: posting, commenting, liking and gifting work for every
// authenticated account.
export const postApi = {
  feed: (params?: PaginationParams) => api.get('/posts', { params }),
  get: (id: string) => api.get(`/posts/${id}`),
  remove: (id: string) => api.delete(`/posts/${id}`),
  create: (data: { content?: string; imageUrl?: string | null; videoUrl?: string | null; visibility: string }) =>
    api.post('/posts', data),
  // Multipart blobs land in Postgres; the response carries a relative
  // /uploads/... URL that is then attached to the post.
  uploadImage: (file: File) => {
    const form = new FormData();
    form.append('image', file);
    return api.post('/posts/image', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
  },
  uploadVideo: (file: File) => {
    const form = new FormData();
    form.append('video', file);
    return api.post('/posts/video', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180000,
    });
  },
  toggleLike: (id: string) => api.post(`/posts/${id}/like`),
  toggleSave: (id: string) => api.post(`/posts/${id}/save`),
  comments: (id: string, params?: PaginationParams) => api.get(`/posts/${id}/comments`, { params }),
  replies: (id: string, commentId: string, params?: PaginationParams) =>
    api.get(`/posts/${id}/comments/${commentId}/replies`, { params }),
  addComment: (id: string, data: { content: string; parentId?: string | null }) =>
    api.post(`/posts/${id}/comments`, data),
  deleteComment: (id: string, commentId: string) => api.delete(`/posts/${id}/comments/${commentId}`),
  report: (id: string, data: { reason: string; description?: string }) =>
    api.post(`/posts/${id}/report`, data),
  // referenceId is the idempotency key: retries of the same gift succeed once.
  gift: (id: string, data: { amount: number; referenceId: string }) =>
    api.post(`/posts/${id}/gift`, data),
  gifts: (id: string) => api.get(`/posts/${id}/gifts`),
}

export type SupportTicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_USER' | 'RESOLVED' | 'CLOSED'
export type SupportPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
export const SUPPORT_CATEGORIES = [
  { value: 'ACCOUNT', label: 'Account & login' },
  { value: 'PAYMENT', label: 'Payments & refunds' },
  { value: 'BOOKING', label: 'A booking' },
  { value: 'SAFETY', label: 'Safety concern' },
  { value: 'TECHNICAL', label: 'Something is broken' },
  { value: 'PARTNER_ONBOARDING', label: 'Becoming a partner' },
  { value: 'OTHER', label: 'Something else' },
] as const

// Support desk. Ticket ids are server uuids; `reference` (NBR-XXXXXX) is what
// the user quotes in an email, so the UI always shows the reference too.
export const supportApi = {
  myTickets: () => api.get('/support/tickets'),
  myTicket: (id: string) => api.get(`/support/tickets/${id}`),
  createTicket: (data: { category: string; subject: string; body: string }) =>
    api.post('/support/tickets', data),
  reply: (id: string, body: string) => api.post(`/support/tickets/${id}/replies`, { body }),
  updateStatus: (id: string, status: string, extra?: { resolution?: string; note?: string }) =>
    api.patch(`/support/tickets/${id}/status`, { status, ...extra }),
  // Staff only.
  queue: (params?: { status?: string; mine?: boolean }) => api.get('/support/queue', { params }),
  setPriority: (id: string, priority: SupportPriority) =>
    api.patch(`/support/tickets/${id}/priority`, { priority }),
  assign: (id: string, assigneeId: string) =>
    api.patch(`/support/tickets/${id}/assign`, { assigneeId }),
}
