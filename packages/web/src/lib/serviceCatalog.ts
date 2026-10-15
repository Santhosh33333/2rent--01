// Frontend mirror of the backend service catalog. Key/label/icon MUST stay in
// sync with packages/backend/src/services/serviceCatalog.ts.
//
// The catalogue is in-app companionship (talk, vent, time-pass, date, friends),
// delivered over an in-app call or chat — so nothing here needs an item or a
// drop-off. The retired local-services names still render for historical
// bookings through LEGACY_SERVICE_LABELS below.
export interface ServiceOption {
  key: string
  title: string
  subtitle: string
  icon: string // emoji used as the service glyph
  requiresItem: boolean
  requiresDropoff: boolean // pickup-to-drop: destination mandatory
  minDuration: number // shortest session length, in minutes (matches the backend)
  accent: string // tailwind gradient classes for the icon chip
}

export const SERVICES: ServiceOption[] = [
  { key: 'TALK', title: 'Talk', subtitle: 'One-to-one talk over an in-app call or chat', icon: '💬', requiresItem: false, requiresDropoff: false, minDuration: 15, accent: 'from-sky-500 to-blue-600' },
  { key: 'VENT', title: 'Vent', subtitle: 'Let it all out to someone who listens', icon: '🫂', requiresItem: false, requiresDropoff: false, minDuration: 15, accent: 'from-violet-500 to-purple-600' },
  { key: 'TIME_PASS', title: 'Time-pass', subtitle: 'Easy company to pass the time', icon: '⏳', requiresItem: false, requiresDropoff: false, minDuration: 15, accent: 'from-teal-500 to-cyan-600' },
  { key: 'DATE', title: 'Date', subtitle: 'A companion for a date, over call or chat', icon: '💞', requiresItem: false, requiresDropoff: false, minDuration: 30, accent: 'from-rose-500 to-pink-600' },
  { key: 'FRIENDS', title: 'Friends', subtitle: 'Meet a new friend and hang out', icon: '🤝', requiresItem: false, requiresDropoff: false, minDuration: 30, accent: 'from-emerald-500 to-green-600' },
  { key: 'OTHER', title: 'Other', subtitle: 'Something else — describe it in the details', icon: '✨', requiresItem: false, requiresDropoff: false, minDuration: 15, accent: 'from-slate-500 to-slate-600' },
]

/** Names for the retired local-services catalogue — display-only, for history. */
export const LEGACY_SERVICE_LABELS: Record<string, string> = {
  WALKING: 'Walking Buddy',
  CARRY_BUDDY: 'Carry Buddy',
  FLAT_SHIFT: 'Flat Shift',
  LOCAL_MOVE: 'Local Move',
  RIDE_BUDDY: 'Ride Buddy',
  ERRAND_BUDDY: 'Errand Buddy',
  WAIT_BUDDY: 'Wait Buddy',
  STUDY_BUDDY: 'Study Buddy',
  SPOT_BUDDY: 'Spot Buddy',
  TRAVEL_BUDDY: 'Travel Buddy',
  EVENT_BUDDY: 'Event Buddy',
  BUSINESS_BUDDY: 'Business Buddy',
  PET_BUDDY: 'Pet Buddy',
  COMMERCIAL: 'Commercial & Industrial',
}

/** Human name for any service key, current or retired. */
export function serviceTitle(key: string): string {
  return SERVICES.find((s) => s.key === key)?.title ?? LEGACY_SERVICE_LABELS[key] ?? key
}

/** The catalogue entry for a key, if it is still offered. */
export function serviceOption(key: string): ServiceOption | undefined {
  return SERVICES.find((s) => s.key === key)
}

export function serviceIcon(key: string): string {
  return serviceOption(key)?.icon ?? '✨'
}

export function serviceAccent(key: string): string {
  return serviceOption(key)?.accent ?? 'from-surface-400 to-surface-500'
}

export function serviceRequiresItem(key: string): boolean {
  return serviceOption(key)?.requiresItem ?? false
}

export function serviceRequiresDropoff(key: string): boolean {
  return serviceOption(key)?.requiresDropoff ?? false
}

export interface OtpLabels {
  start: string
  complete: string
  startHint: string
  completeHint: string
  startToast: string
}

// Pickup-to-drop services speak pickup/delivery; companion services speak
// start/completion. One helper so every screen labels the same codes.
export function otpLabels(serviceType: string): OtpLabels {
  if (serviceRequiresDropoff(serviceType)) {
    return {
      start: 'Pickup Code',
      complete: 'Delivery Code',
      startHint: 'Ask the customer to read out their pickup code in person. Never accept codes over chat.',
      completeHint: 'The customer confirms delivery and reads out their delivery code in person.',
      startToast: 'Arrival recorded. Ask the user for the pickup code.',
    }
  }
  return {
    start: 'Start Code',
    complete: 'Completion Code',
    startHint: 'Ask the customer to read out their start code in person. Never accept codes over chat.',
    completeHint: 'The customer confirms the work and reads out their completion code in person.',
    startToast: 'Arrival recorded. Ask the user for the start code.',
  }
}
