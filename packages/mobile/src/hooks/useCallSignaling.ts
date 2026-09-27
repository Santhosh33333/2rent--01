import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getSocket,
  inviteCall,
  acceptCall as emitAccept,
  rejectCall as emitReject,
  endCall as emitEnd,
  reportCallMediaFailed,
} from '../lib/socket';

export type CallStatus =
  | 'idle'
  | 'calling'
  | 'incoming'
  | 'connected'
  | 'rejected'
  | 'ended'
  | 'unavailable';

export type CallType = 'VOICE' | 'VIDEO';

export interface CallPeer {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface CallSession {
  status: CallStatus;
  /** Server-generated ledger id. Every accept/reject/end must echo it back. */
  callId: string | null;
  callType: CallType;
  peer: CallPeer | null;
  /** True for the side that sent `call:invite`. */
  initiator: boolean;
  /**
   * The mobile app has no native WebRTC media stack, so this is always false.
   * The UI must present the call as signaling-only rather than implying that
   * live audio is flowing. The server is told explicitly when a web peer
   * starts negotiating, so the caller sees "media unavailable" instead of a
   * silent dead call.
   */
  mediaReady: boolean;
  endReason?: string;
  durationSeconds?: number;
}

const IDLE: CallSession = {
  status: 'idle',
  callId: null,
  callType: 'VOICE',
  peer: null,
  initiator: false,
  mediaReady: false,
};

function readPeer(raw: unknown): CallPeer | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const id = String(p.id || '');
  if (!id) return null;
  return {
    id,
    fullName: (p.fullName as string) ?? null,
    avatarUrl: (p.avatarUrl as string) ?? null,
  };
}

function readType(raw: unknown): CallType {
  return String(raw) === 'VIDEO' ? 'VIDEO' : 'VOICE';
}

export function useCallSignaling() {
  const [session, setSession] = useState<CallSession>(IDLE);
  // Listeners are registered once; reading the id from a ref keeps them from
  // capturing a stale session and dropping a `call:ended` for a newer call.
  const callIdRef = useRef<string | null>(null);

  useEffect(() => {
    const s = getSocket();
    callIdRef.current = session.callId;
  }, [session.callId]);

  useEffect(() => {
    const s = getSocket();

    const adopt = (callId: unknown) => {
      const id = callId ? String(callId) : null;
      callIdRef.current = id;
      return id;
    };

    const onRinging = (p: any) => {
      adopt(p?.callId);
      setSession({
        status: 'calling',
        callId: String(p?.callId || ''),
        callType: readType(p?.type),
        peer: readPeer(p?.peer),
        initiator: true,
        mediaReady: false,
      });
    };

    const onIncoming = (p: any) => {
      adopt(p?.callId);
      setSession({
        status: 'incoming',
        callId: String(p?.callId || ''),
        callType: readType(p?.type),
        peer: readPeer(p?.peer),
        initiator: false,
        mediaReady: false,
      });
    };

    const onAccepted = (p: any) => {
      adopt(p?.callId);
      setSession((prev) => ({
        ...prev,
        status: 'connected',
        callId: String(p?.callId || prev.callId || ''),
        peer: readPeer(p?.peer) || prev.peer,
        initiator: Boolean(p?.initiator),
        mediaReady: false,
      }));
    };

    const onRejected = (p: any) => {
      if (callIdRef.current && p?.callId && String(p.callId) !== callIdRef.current) return;
      setSession((prev) => ({ ...prev, status: 'rejected', endReason: 'DECLINED' }));
    };

    const onEnded = (p: any) => {
      if (callIdRef.current && p?.callId && String(p.callId) !== callIdRef.current) return;
      setSession((prev) => ({
        ...prev,
        status: 'ended',
        endReason: p?.reason ? String(p.reason) : 'HANGUP',
        durationSeconds: typeof p?.duration === 'number' ? p.duration : undefined,
      }));
      callIdRef.current = null;
    };

    const onUnavailable = (p: any) => {
      setSession((prev) => ({
        ...prev,
        status: 'unavailable',
        endReason: p?.reason ? String(p.reason) : 'UNAVAILABLE',
      }));
      callIdRef.current = null;
    };

    // The web client is a full WebRTC peer. When it starts negotiating we
    // cannot answer, so we fail the call loudly on the server instead of
    // leaving the caller in a permanent "connecting" state.
    const onNegotiationAttempt = (p: any) => {
      const id = p?.callId ? String(p.callId) : callIdRef.current;
      if (id) reportCallMediaFailed(id, 'MOBILE_MEDIA_UNAVAILABLE');
      setSession((prev) => ({ ...prev, status: 'ended', endReason: 'MEDIA_UNAVAILABLE' }));
      callIdRef.current = null;
    };

    s.on('call:ringing', onRinging);
    s.on('call:incoming', onIncoming);
    s.on('call:accepted', onAccepted);
    s.on('call:rejected', onRejected);
    s.on('call:ended', onEnded);
    s.on('call:unavailable', onUnavailable);
    s.on('call:offer', onNegotiationAttempt);
    s.on('call:answer', onNegotiationAttempt);
    s.on('call:ice', onNegotiationAttempt);

    return () => {
      s.off('call:ringing', onRinging);
      s.off('call:incoming', onIncoming);
      s.off('call:accepted', onAccepted);
      s.off('call:rejected', onRejected);
      s.off('call:ended', onEnded);
      s.off('call:unavailable', onUnavailable);
      s.off('call:offer', onNegotiationAttempt);
      s.off('call:answer', onNegotiationAttempt);
      s.off('call:ice', onNegotiationAttempt);
    };
  }, []);

  // Named `call`/`end` to match the existing call sites in partner.tsx and
  // booking/[id].tsx.
  const call = useCallback((receiverId: string, type: CallType = 'VOICE') => {
    inviteCall(receiverId, type);
    // Optimistic local state: the server replaces callId on `call:ringing`, and
    // drops the attempt entirely on `call:unavailable`.
    setSession({ ...IDLE, status: 'calling', callType: type, initiator: true });
  }, []);

  const accept = useCallback(() => {
    if (!callIdRef.current) return;
    emitAccept(callIdRef.current);
    setSession((prev) => ({ ...prev, status: 'connected' }));
  }, []);

  const reject = useCallback((reason?: string) => {
    if (!callIdRef.current) return;
    emitReject(callIdRef.current, reason);
    setSession((prev) => ({ ...prev, status: 'rejected', endReason: 'DECLINED' }));
  }, []);

  const end = useCallback(() => {
    if (!callIdRef.current) return;
    emitEnd(callIdRef.current);
    setSession((prev) => ({ ...prev, status: 'ended', endReason: 'HANGUP' }));
    callIdRef.current = null;
  }, []);

  const reset = useCallback(() => {
    callIdRef.current = null;
    setSession(IDLE);
  }, []);

  return { session, call, accept, reject, end, reset };
}
