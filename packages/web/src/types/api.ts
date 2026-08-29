export interface PaginationParams {
  page?: number
  limit?: number
  search?: string
  status?: string
  category?: string
}

export interface BookingCreateInput {
  serviceType: string
  startLocation: string
  endLocation: string
  startLatitude?: number
  startLongitude?: number
  endLatitude?: number
  endLongitude?: number
  durationMinutes?: number
  distanceKm?: number
  notes?: string
  couponCode?: string
}

export interface BookingVerifyPayment {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

export interface BookingRate {
  rating: number
  comment?: string
}

export interface PriceEstimateParams {
  serviceType: string
  durationMinutes: number
  distanceKm?: number
  startLatitude?: number
  startLongitude?: number
  endLatitude?: number
  endLongitude?: number
}

export interface PartnerApplicationInput {
  fullName: string
  email: string
  phone: string
  providesWalking?: boolean
  providesCarry?: boolean
  providesErrands?: boolean
  providesGrocery?: boolean
  providesPrescription?: boolean
  providesPetWalk?: boolean
  providesTechHelp?: boolean
  providesCleaning?: boolean
  providesLaundry?: boolean
  providesMoving?: boolean
  providesTutoring?: boolean
  providesPhotography?: boolean
  providesDelivery?: boolean
  providesOther?: boolean
  bankAccountName?: string
  bankAccountNumber?: string
  bankIfsc?: string
  upiId?: string
}

export interface ToggleAvailability {
  available: boolean
}

export interface UpdateLocation {
  latitude: number
  longitude: number
}

export interface UpdateServices {
  services: string[]
}

export interface KycRejectReason {
  reason: string
}

export interface ReportResolve {
  resolution?: string
}

export interface PricingConfigInput {
  key?: string
  value?: string
  description?: string
  category?: string
  isActive?: boolean
}

export interface AdminAccountInput {
  email?: string
  password?: string
  fullName?: string
  phone?: string
  role?: string
  status?: string
  permissions?: string[]
  department?: string
}

export interface PriceEstimateParams {
  serviceType: string
  durationMinutes: number
  distanceKm?: number
  startLatitude?: number
  startLongitude?: number
  endLatitude?: number
  endLongitude?: number
  draft?: Record<string, number>
}

export interface RegisterInput {
  fullName?: string
  name?: string
  email: string
  phone: string
  password: string
  dateOfBirth?: string
  gender?: string
  accountType?: string
  role?: string
}
