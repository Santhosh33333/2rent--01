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
  timeout: 15000,
})

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
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
      url.includes('/auth/phone') ||
      url.includes('/auth/clerk')

    if (status === 401 && !originalRequest._retry && !shouldSkipRefresh) {
      originalRequest._retry = true
      try {
        const refreshToken = localStorage.getItem('refreshToken')
        if (!refreshToken) throw error

        if (!refreshPromise) {
          refreshPromise = doRefresh(refreshToken).finally(() => {
            refreshPromise = null
          })
        }

        const newAccessToken = await refreshPromise

        originalRequest.headers = originalRequest.headers || {}
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`
        return api(originalRequest)
      } catch (refreshError) {
        clearSessionStorage()
        if (typeof window !== 'undefined' && !['/login', '/register', '/forgot-password'].includes(window.location.pathname)) {
          window.location.assign('/login')
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
  completeBooking: (id: string) => api.post(`/partner/bookings/${id}/complete`),
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
  getKycQueue: (params?: PaginationParams) => api.get('/admin/kyc-queue', { params }),
  approveKyc: (id: string) => api.post(`/admin/kyc/${id}/approve`),
  rejectKyc: (id: string, data: KycRejectReason) => api.post(`/admin/kyc/${id}/reject`, data),
  getPartners: (params?: PaginationParams) => api.get('/admin/walking-partners', { params }),
  approvePartner: (id: string) => api.post(`/admin/walking-partners/${id}/approve`),
  rejectPartner: (id: string, reason?: string) => api.post(`/admin/walking-partners/${id}/reject`, { reason }),
  getBookings: (params?: PaginationParams) => api.get('/admin/bookings', { params }),
  getBookingDetail: (id: string) => api.get(`/admin/bookings/${id}`),
  getWithdrawals: (params?: PaginationParams) => api.get('/admin/withdrawals', { params }),
  approveWithdrawal: (id: string) => api.post(`/admin/withdrawals/${id}/approve`),
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
  // Payment Center (real Razorpay order/payment ledger)
  getPayments: (params?: PaginationParams) => api.get('/admin/payments', { params }),
  getPaymentStats: () => api.get('/admin/payments/stats'),
  // Platform settings (dynamic pricing config, e.g. PLATFORM_FEE_PERCENT)
  getPricingConfigs: (params?: PaginationParams) => api.get('/admin/pricing', { params }),
  createPricingConfig: (data: PricingConfigInput) => api.post('/admin/pricing', data),
  updatePricingConfig: (id: string, data: PricingConfigInput) => api.put(`/admin/pricing/${id}`, data),
  deletePricingConfig: (id: string) => api.delete(`/admin/pricing/${id}`),
  simulatePricing: (data: PriceEstimateParams) => api.post('/admin/pricing/simulate', data),
  // User / partner account blocking with duration + deletion
  blockUser: (userId: string, data: { durationDays?: number; durationYears?: number; permanent?: boolean; reason?: string }) =>
    api.post(`/admin/users/${userId}/block`, data),
  unblockUser: (userId: string) => api.post(`/admin/users/${userId}/unblock`),
  deleteUser: (userId: string) => api.delete(`/admin/users/${userId}`),
  // Admin account provisioning (SUPER_ADMIN only)
  getAdminAccounts: () => api.get('/admin/admins'),
  createAdminAccount: (data: AdminAccountInput) => api.post('/admin/admins', data),
  updateAdminAccount: (userId: string, data: AdminAccountInput) => api.patch(`/admin/admins/${userId}`, data),
}

// Account role switching (USER <-> PARTNER), backend-enforced
export const authRoleApi = {
  switchRole: (role: 'USER' | 'PARTNER') => api.post('/auth/switch-role', { role }),
}
