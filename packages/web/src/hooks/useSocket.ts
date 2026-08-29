import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../lib/auth';
import type {
  LocationData,
  BookingStatusData,
  EtaData,
  SosAlert,
  MessageData,
  TypingData,
  MessagesReadData,
  MessageSentData,
  MessageDeletedData,
  UserActiveData,
  NotificationData,
  CallData,
} from '../types/socket-events';

interface UseSocketOptions {
  autoConnect?: boolean;
  debug?: boolean;
}

let globalSocket: Socket | null = null;

/**
 * Force-disconnect the shared socket (called on logout so the session does
 * not stay alive after the user leaves).
 */
export function disconnectGlobalSocket(): void {
  if (globalSocket) {
    globalSocket.removeAllListeners();
    globalSocket.disconnect();
    globalSocket = null;
  }
}

/**
 * Hook for real-time Socket.io communication
 * Manages connection lifecycle and provides event handlers
 */
export function useSocket(options: UseSocketOptions = {}) {
  const { autoConnect = true, debug = false } = options;
  const { user } = useAuth();
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const socketRef = useRef<Socket | null>(null);
  const isConnectingRef = useRef(false);

  useEffect(() => {
    // Logout cleanup: no user -> tear down any live socket
    if (!user && globalSocket) {
      disconnectGlobalSocket();
      socketRef.current = null;
      return;
    }
    if (!autoConnect || !token) return;
    if (isConnectingRef.current) return;
    if (globalSocket?.connected) {
      socketRef.current = globalSocket;
      return;
    }

    isConnectingRef.current = true;

    try {
      const socket = io((import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/api$/, ''), {
        // Read the CURRENT token on every (re)connection attempt — prevents
        // stale-token reconnect loops after an access-token refresh.
        auth: (cb) => cb({ token: typeof window !== 'undefined' ? localStorage.getItem('token') : null }),
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      });

      socket.on('connect', () => {
        if (debug) console.log('[SOCKET DEBUG] Connection established');
      });

      socket.on('disconnect', () => {
        if (debug) console.log('[SOCKET DEBUG] Disconnected');
      });

      socket.on('connect_error', (error: Error) => {
        if (debug) console.error('[SOCKET DEBUG] Connection error:', error);
      });

      socket.on('error', (error: Error) => {
        if (debug) console.error('[SOCKET DEBUG] Error:', error);
      });

      socketRef.current = socket;
      globalSocket = socket;
      isConnectingRef.current = false;
    } catch (err) {
      if (debug) console.error('[SOCKET DEBUG] Failed to connect:', err);
      isConnectingRef.current = false;
    }

    return () => {
      // Don't disconnect here - keep connection alive for multiple hooks
    };
  }, [token, autoConnect, debug, user]);

  const getSocket = useCallback(() => {
    return socketRef.current || globalSocket;
  }, []);

  // Emit event
  const emit = useCallback(
    (event: string, data?: unknown) => {
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit(event, data);
      } else if (debug) {
        console.warn(`[SOCKET DEBUG] Cannot emit '${event}' - not connected`);
      }
    },
    [getSocket, debug]
  );

  // Listen to event
  const on = useCallback(
    (event: string, callback: (...args: unknown[]) => void): (() => void) | undefined => {
      const socket = getSocket();
      if (socket) {
        socket.on(event, callback);
        return () => {
          socket.off(event, callback);
        };
      }
      return undefined;
    },
    [getSocket]
  );

  // Listen to event once
  const once = useCallback(
    (event: string, callback: (...args: unknown[]) => void): void => {
      const socket = getSocket();
      if (socket) {
        socket.once(event, callback);
      }
    },
    [getSocket]
  );

  // Remove event listener
  const off = useCallback(
    (event: string, callback?: (...args: unknown[]) => void): void => {
      const socket = getSocket();
      if (socket) {
        socket.off(event, callback);
      }
    },
    [getSocket]
  );

  // Check if connected
  const isConnected = useCallback(() => {
    return getSocket()?.connected || false;
  }, [getSocket]);

  return {
    socket: getSocket(),
    emit,
    on,
    once,
    off,
    isConnected,
  };
}

/**
 * Hook for booking live tracking
 */
export function useBookingTracking(bookingId: string) {
  const { emit, on } = useSocket({ autoConnect: true });

  const joinBooking = useCallback(() => {
    emit('join_booking', bookingId);
  }, [bookingId, emit]);

  const leaveBooking = useCallback(() => {
    emit('leave_booking', bookingId);
  }, [bookingId, emit]);

  const sendLocation = useCallback(
    (latitude: number, longitude: number, heading?: number, speed?: number) => {
      emit('location_update', {
        bookingId,
        partnerId: '',
        latitude,
        longitude,
        heading,
        speed,
      });
    },
    [bookingId, emit]
  );

  const sendUserLocation = useCallback(
    (latitude: number, longitude: number, heading?: number, speed?: number) => {
      emit('user_location_update', {
        bookingId,
        latitude,
        longitude,
        heading,
        speed,
      });
    },
    [bookingId, emit]
  );

  const updateStatus = useCallback(
    (status: string) => {
      emit('booking_status_update', { bookingId, status });
    },
    [bookingId, emit]
  );

  const requestETA = useCallback(() => {
    emit('request_eta', bookingId);
  }, [bookingId, emit]);

  const sendSOS = useCallback(
    (message?: string, latitude?: number, longitude?: number) => {
      emit('sos', { bookingId, message, latitude, longitude });
    },
    [bookingId, emit]
  );

  const listenToLocationUpdates = useCallback(
    (callback: (data: LocationData) => void) => {
      return on('partner_location', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  const listenToUserLocationUpdates = useCallback(
    (callback: (data: LocationData) => void) => {
      return on('user_location', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  const listenToStatusChanges = useCallback(
    (callback: (data: BookingStatusData) => void) => {
      return on('booking_status_changed', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  const listenToETAUpdates = useCallback(
    (callback: (data: EtaData) => void) => {
      return on('eta_update', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  const listenToSOSAlerts = useCallback(
    (callback: (data: SosAlert) => void) => {
      return on('sos_alert', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  // Auto-join on mount
  useEffect(() => {
    if (bookingId) {
      joinBooking();
    }
    return () => {
      if (bookingId) {
        leaveBooking();
      }
    };
  }, [bookingId, joinBooking, leaveBooking]);

  return {
    joinBooking,
    leaveBooking,
    sendLocation,
    sendUserLocation,
    updateStatus,
    requestETA,
    listenToLocationUpdates,
    listenToUserLocationUpdates,
    listenToStatusChanges,
    listenToETAUpdates,
    listenToSOSAlerts,
    sendSOS,
  };
}

/**
 * Hook for real-time chat
 */
export function useChat(conversationId: string) {
  const { emit, on } = useSocket({ autoConnect: true });

  const joinChat = useCallback(() => {
    emit('join_chat', conversationId);
  }, [conversationId, emit]);

  const leaveChat = useCallback(() => {
    emit('leave_chat', conversationId);
  }, [conversationId, emit]);

  const sendMessage = useCallback(
    (content: string, receiverId?: string) => {
      emit('send_message', receiverId ? { conversationId, content, receiverId } : { conversationId, content });
    },
    [conversationId, emit]
  );

  const markAsRead = useCallback(
    (messageIds: string[], conversationIdOverride?: string) => {
      emit('mark_read', { conversationId: conversationIdOverride || conversationId, messageIds });
    },
    [conversationId, emit]
  );

  const setTyping = useCallback(
    (isTyping: boolean) => {
      if (isTyping) {
        emit('typing', conversationId);
      } else {
        emit('stop_typing', conversationId);
      }
    },
    [conversationId, emit]
  );

  const listenToMessages = useCallback(
    (callback: (data: MessageData) => void) => {
      return on('new_message', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  const listenToUserTyping = useCallback(
    (callback: (data: TypingData) => void) => {
      return on('user_typing', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  const listenToUserStoppedTyping = useCallback(
    (callback: (data: TypingData) => void) => {
      return on('user_stopped_typing', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  const listenToMessagesRead = useCallback(
    (callback: (data: MessagesReadData) => void) => {
      return on('messages_read', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  const listenToMessageSent = useCallback(
    (callback: (data: MessageSentData) => void) => {
      return on('message_sent', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  const listenToMessageDeleted = useCallback(
    (callback: (data: MessageDeletedData) => void) => {
      return on('message_deleted', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  const listenToUserActive = useCallback(
    (callback: (data: UserActiveData) => void) => {
      return on('user_active', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  const listenToUserInactive = useCallback(
    (callback: (data: UserActiveData) => void) => {
      return on('user_inactive', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  // Auto-join on mount
  useEffect(() => {
    if (conversationId) {
      joinChat();
    }
    return () => {
      if (conversationId) {
        leaveChat();
      }
    };
  }, [conversationId, joinChat, leaveChat]);

  return {
    joinChat,
    leaveChat,
    sendMessage,
    markAsRead,
    setTyping,
    listenToMessages,
    listenToUserTyping,
    listenToUserStoppedTyping,
    listenToMessagesRead,
    listenToMessageSent,
    listenToMessageDeleted,
    listenToUserActive,
    listenToUserInactive,
  };
}

/**
 * Hook for real-time notifications
 */
export function useNotifications() {
  const { emit, on } = useSocket({ autoConnect: true });

  const subscribe = useCallback(() => {
    emit('subscribe_notifications');
  }, [emit]);

  const unsubscribe = useCallback(() => {
    emit('unsubscribe_notifications');
  }, [emit]);

  const listenToNotifications = useCallback(
    (callback: (data: NotificationData) => void) => {
      return on('notification', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  // Auto-subscribe on mount
  useEffect(() => {
    subscribe();
    return () => {
      unsubscribe();
    };
  }, [subscribe, unsubscribe]);

  return {
    subscribe,
    unsubscribe,
    listenToNotifications,
  };
}

/**
 * Hook for voice/video calls
 */
export function useCalls() {
  const { emit, on } = useSocket({ autoConnect: true });

  const initiateCall = useCallback(
    (recipientId: string, callType: 'VOICE' | 'VIDEO') => {
      emit('initiate_call', { recipientId, callType });
    },
    [emit]
  );

  const acceptCall = useCallback(
    (callerId: string) => {
      emit('accept_call', { callerId });
    },
    [emit]
  );

  const rejectCall = useCallback(
    (callerId: string, reason?: string) => {
      emit('reject_call', { callerId, reason });
    },
    [emit]
  );

  const endCall = useCallback(
    (otherUserId: string, duration: number) => {
      emit('end_call', { otherUserId, duration });
    },
    [emit]
  );

  const listenToIncomingCall = useCallback(
    (callback: (data: CallData) => void) => {
      return on('incoming_call', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  const listenToCallAccepted = useCallback(
    (callback: (data: CallData) => void) => {
      return on('call_accepted', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  const listenToCallRejected = useCallback(
    (callback: (data: CallData) => void) => {
      return on('call_rejected', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  const listenToCallEnded = useCallback(
    (callback: (data: CallData) => void) => {
      return on('call_ended', callback as (...args: unknown[]) => void);
    },
    [on]
  );

  return {
    initiateCall,
    acceptCall,
    rejectCall,
    endCall,
    listenToIncomingCall,
    listenToCallAccepted,
    listenToCallRejected,
    listenToCallEnded,
  };
}
