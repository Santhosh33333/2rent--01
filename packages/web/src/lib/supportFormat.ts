// Shared formatting for the support desk, so the requester's view and the staff
// queue cannot drift into showing different words for the same state.

export const SUPPORT_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_USER: 'Waiting on you',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
}

export function supportTicketStatusLabel(status: string): string {
  return SUPPORT_STATUS_LABELS[status] || status
}

export function supportStatusClass(status: string): string {
  const map: Record<string, string> = {
    OPEN: 'bg-blue-900/30 text-blue-300',
    IN_PROGRESS: 'bg-amber-900/30 text-amber-300',
    WAITING_ON_USER: 'bg-purple-900/30 text-purple-300',
    RESOLVED: 'bg-emerald-900/30 text-emerald-300',
    CLOSED: 'bg-gray-700 text-gray-400',
  }
  return map[status] || 'bg-gray-700 text-gray-400'
}

export function supportPriorityClass(priority: string): string {
  const map: Record<string, string> = {
    LOW: 'bg-gray-700 text-gray-400',
    NORMAL: 'bg-gray-700 text-gray-300',
    HIGH: 'bg-amber-900/30 text-amber-300',
    URGENT: 'bg-red-900/40 text-red-300',
  }
  return map[priority] || 'bg-gray-700 text-gray-400'
}

export function supportCategoryLabel(category: string): string {
  const map: Record<string, string> = {
    ACCOUNT: 'Account & login',
    PAYMENT: 'Payments & refunds',
    BOOKING: 'A booking',
    SAFETY: 'Safety concern',
    TECHNICAL: 'Something is broken',
    PARTNER_ONBOARDING: 'Becoming a partner',
    OTHER: 'Something else',
  }
  return map[category] || category
}

/** The transitions the current status actually allows, so the UI cannot offer a
 *  move the server will reject with a 409. */
export function allowedNextStatuses(status: string): string[] {
  const map: Record<string, string[]> = {
    OPEN: ['IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED'],
    IN_PROGRESS: ['WAITING_ON_USER', 'RESOLVED', 'CLOSED'],
    WAITING_ON_USER: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
    RESOLVED: ['IN_PROGRESS', 'CLOSED'],
    CLOSED: ['IN_PROGRESS'],
  }
  return map[status] || []
}

/** Resolving needs an explanation, so the control that moves there is different
 *  from the plain status buttons. */
export function requiresResolution(status: string): boolean {
  return status !== 'RESOLVED' && status !== 'CLOSED' && status !== 'OPEN'
}
