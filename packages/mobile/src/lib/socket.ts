import { io, Socket } from 'socket.io-client';
import { API_URL } from './env';
import { tokenStore } from './storage';

// Socket.IO connects to the backend origin (strip the "/api" suffix from API_URL).
const SOCKET_URL = API_URL.replace(/\/api\/?$/, '');

let socket: Socket | null = null;

export function getSocket(): Socket {
  const token = tokenStore.getAccessToken();
  if (socket) return socket;
  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1500,
  });
  socket.on('connect_error', (e) => console.warn('[SOCKET] connect_error', e.message));
  socket.io.on('reconnect_attempt', () => {
    // Re-authenticate with the latest token on reconnect.
    const t = tokenStore.getAccessToken();
    if (socket) (socket.auth as any) = { token: t };
  });
  return socket;
}

export function joinBooking(bookingId: string): void {
  getSocket().emit('join_booking', bookingId);
}

export function leaveBooking(bookingId: string): void {
  getSocket().emit('leave_booking', bookingId);
}

export function emitPartnerLocation(bookingId: string, latitude: number, longitude: number): void {
  getSocket().emit('location_update', { bookingId, latitude, longitude });
}

export function emitSos(
  bookingId: string,
  opts?: { latitude?: number; longitude?: number; message?: string }
): void {
  getSocket().emit('sos', { bookingId, ...opts });
}

export function initiateCall(recipientId: string, callType: 'VOICE' | 'VIDEO' = 'VOICE'): void {
  getSocket().emit('initiate_call', { recipientId, callType });
}

export function acceptCall(callerId: string): void {
  getSocket().emit('accept_call', { callerId });
}

export function rejectCall(callerId: string, reason?: string): void {
  getSocket().emit('reject_call', { callerId, reason });
}

export function endCall(otherUserId: string, duration = 0): void {
  getSocket().emit('end_call', { otherUserId, duration });
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
