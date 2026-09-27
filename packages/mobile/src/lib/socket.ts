import { io, Socket } from 'socket.io-client';
import { API_URL } from './env';
import { tokenStore } from './storage';

// Socket.IO connects to the backend origin (strip the "/api" suffix from API_URL).
const SOCKET_URL = API_URL.replace(/\/api\/?$/, '');

let socket: Socket | null = null;

// The server rejects the handshake when the token is missing or stale
// (socketService.ts runs the same authenticateToken as the REST API). Previously
// that surfaced as one `connect_error` and then five reconnection attempts, after
// which the socket was dead for the rest of the app session while the UI carried
// on showing "Calling…". Callers now get an explicit signal, and the singleton is
// discarded so the next getSocket() rebuilds it with a fresh token.
let authFailed = false;

export function onSocketAuthFailure(handler: (err: Error) => void): void {
  authFailureHandlers.add(handler);
}
const authFailureHandlers = new Set<(err: Error) => void>();

export function getSocket(): Socket {
  const token = tokenStore.getAccessToken();

  // A socket that was built with no token, or with a token the server rejected,
  // can never authenticate. Throw instead of handing back a dead instance.
  if (socket && (!token || authFailed)) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
    authFailed = false;
  }
  if (socket) return socket;

  authFailed = false;
  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1500,
  });
  socket.on('connect_error', (e) => {
    console.warn('[SOCKET] connect_error', e.message);
    // Handshake rejections are the token's fault; transport failures are not.
    // Retrying those five times then going silent is what made calls look dead.
    if (/unauthor|token|jwt|credential|forbidden/i.test(e.message)) {
      authFailed = true;
      const err = new Error(e.message);
      authFailureHandlers.forEach((h) => h(err));
    }
  });
  socket.io.on('reconnect_attempt', () => {
    // Re-authenticate with the latest token on reconnect.
    const t = tokenStore.getAccessToken();
    if (socket) (socket.auth as any) = { token: t };
  });
  return socket;
}

export function isSocketConnected(): boolean {
  return Boolean(socket?.connected);
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

// In-app calls use the same `call:*` protocol as the web client, keyed on a
// server-generated `callId`. The previous snake_case functions
// (initiate_call / accept_call / reject_call / end_call) were never removed from
// this file after the server migrated, so every call emit went to an event name
// no handler was registered for and nothing happened.
export function inviteCall(receiverId: string, type: 'VOICE' | 'VIDEO' = 'VOICE'): void {
  getSocket().emit('call:invite', { receiverId, type });
}

export function acceptCall(callId: string): void {
  getSocket().emit('call:accept', { callId });
}

export function rejectCall(callId: string, reason?: string): void {
  getSocket().emit('call:reject', { callId, reason });
}

export function endCall(callId: string): void {
  getSocket().emit('call:end', { callId });
}

export function reportCallMediaFailed(callId: string, reason: string): void {
  getSocket().emit('call:media_failed', { callId, reason });
}

export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  authFailed = false;
}
