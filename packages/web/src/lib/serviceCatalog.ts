// Frontend mirror of the backend Expanded Partner Ecosystem catalog.
// Key/label/icon MUST stay in sync with packages/backend/src/services/serviceCatalog.ts.
export interface ServiceOption {
  key: string
  title: string
  subtitle: string
  icon: string // emoji used as the service glyph
  requiresItem: boolean
  accent: string // tailwind gradient classes for the icon chip
}

export const SERVICES: ServiceOption[] = [
  { key: 'WALKING', title: 'Walking Buddy', subtitle: 'Companion walks, pet walks & strolls', icon: '🚶', requiresItem: false, accent: 'from-emerald-500 to-emerald-600' },
  { key: 'CARRY_BUDDY', title: 'Carry Buddy', subtitle: 'Heavy lifting, shifting & items', icon: '📦', requiresItem: true, accent: 'from-amber-500 to-orange-600' },
  { key: 'FLAT_SHIFT', title: 'Flat Shift', subtitle: 'Flat shuffling & rearrangement', icon: '🛋️', requiresItem: false, accent: 'from-sky-500 to-sky-600' },
  { key: 'LOCAL_MOVE', title: 'Local Move', subtitle: 'Small house/room local shifting', icon: '🚚', requiresItem: false, accent: 'from-indigo-500 to-indigo-600' },
  { key: 'RIDE_BUDDY', title: 'Ride Buddy', subtitle: 'Buddy ride for short hops', icon: '🛵', requiresItem: false, accent: 'from-rose-500 to-pink-600' },
  { key: 'ERRAND_BUDDY', title: 'Errand Buddy', subtitle: 'Pickups, drops & quick errands', icon: '🏃', requiresItem: false, accent: 'from-teal-500 to-teal-600' },
  { key: 'WAIT_BUDDY', title: 'Wait Buddy', subtitle: 'Stand in queue / wait for you', icon: '⏳', requiresItem: false, accent: 'from-cyan-500 to-cyan-600' },
  { key: 'STUDY_BUDDY', title: 'Study Buddy', subtitle: 'Peer study & doubt clearing', icon: '📚', requiresItem: false, accent: 'from-violet-500 to-purple-600' },
  { key: 'SPOT_BUDDY', title: 'Spot Buddy', subtitle: 'Hold a spot on your behalf', icon: '📍', requiresItem: false, accent: 'from-fuchsia-500 to-fuchsia-600' },
  { key: 'TRAVEL_BUDDY', title: 'Travel Buddy', subtitle: 'Companion for trips & transit', icon: '✈️', requiresItem: false, accent: 'from-blue-500 to-blue-600' },
  { key: 'EVENT_BUDDY', title: 'Event Buddy', subtitle: 'On-ground help for events', icon: '🎉', requiresItem: false, accent: 'from-pink-500 to-rose-600' },
  { key: 'BUSINESS_BUDDY', title: 'Business Buddy', subtitle: 'Business errands & courier', icon: '💼', requiresItem: false, accent: 'from-slate-500 to-slate-600' },
  { key: 'PET_BUDDY', title: 'Pet Buddy', subtitle: 'Pet sitting, walking & care', icon: '🐾', requiresItem: false, accent: 'from-lime-500 to-green-600' },
  { key: 'COMMERCIAL', title: 'Commercial & Industrial', subtitle: 'Bulk commercial support', icon: '🏭', requiresItem: false, accent: 'from-orange-500 to-red-600' },
]

export function serviceTitle(key: string): string {
  return SERVICES.find((s) => s.key === key)?.title ?? key
}

export function serviceRequiresItem(key: string): boolean {
  return SERVICES.find((s) => s.key === key)?.requiresItem ?? false
}
