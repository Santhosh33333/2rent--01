export interface LocationData {
  latitude: number
  longitude: number
  heading?: number
  speed?: number
  timestamp?: number
}

export interface BookingStatusData {
  bookingId: string
  status: string
  timestamp?: number
}

export interface EtaData {
  eta: number | null
  distance: number | null
  timestamp?: number
}

export interface SosAlert {
  bookingId: string
  userId: string
  message?: string
  latitude?: number
  longitude?: number
  timestamp: number
}

export interface MessageData {
  id?: string
  messageId?: string
  conversationId: string
  senderId: string
  senderName?: string
  content: string
  createdAt?: string
  timestamp?: string | number
}

export interface TypingData {
  userId: string
  conversationId: string
  timestamp?: number
}

export interface MessagesReadData {
  conversationId: string
  messageIds: string[]
  readBy: string
}

export interface MessageSentData {
  messageId: string
  conversationId: string
}

  export interface MessageDeletedData {
    conversationId: string
    messageId: string
  }

  export interface MessageReactedData {
    conversationId: string
    messageId: string
    reactions: Record<string, string[]>
  }

export interface UserActiveData {
  userId: string
}

export interface NotificationData {
  id: string
  title: string
  body: string
  type?: string
  data?: Record<string, string>
}

// In-app calling. Identities travel as ids + display names only - a phone
// number is never part of a call payload.
export interface CallPeerData {
  id: string
  fullName: string | null
  avatarUrl: string | null
}

export interface CallRingingData {
  callId: string
  type: 'VOICE' | 'VIDEO'
  peer: CallPeerData
}

export interface CallIncomingData extends CallRingingData {
  ringTimeoutMs?: number
}

export interface CallAcceptedData {
  callId: string
  peer: CallPeerData
  initiator?: boolean
}

export interface CallSignalData {
  callId: string
  payload: unknown
}

export interface CallEndedData {
  callId: string
  reason?: string
  duration?: number | null
}

export interface CallUnavailableData {
  reason?: string
}
