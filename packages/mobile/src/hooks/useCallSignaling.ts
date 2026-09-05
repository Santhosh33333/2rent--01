import { useEffect, useRef, useState } from 'react';
import { getSocket, acceptCall, rejectCall, endCall, initiateCall } from '../lib/socket';

export type CallStatus = 'idle' | 'incoming' | 'calling' | 'connected' | 'rejected' | 'ended';

export interface CallSession {
  status: CallStatus;
  callType?: 'VOICE' | 'VIDEO';
  peerId?: string;
}

// Manages the socket call-signaling state machine (ring → accept/reject → connected → end).
// The actual audio path is the phone dialer; this surfaces in-app ring/accept UI.
export function useCallSignaling(onIncoming?: (peerId: string, callType: string) => void) {
  const [session, setSession] = useState<CallSession>({ status: 'idle' });
  const metaRef = useRef<{ peerId?: string; callType?: 'VOICE' | 'VIDEO' }>({});
  const incomingRef = useRef(onIncoming);
  incomingRef.current = onIncoming;

  useEffect(() => {
    const s = getSocket();
    const onIncomingEvt = (p: any) => {
      metaRef.current = { peerId: p.callerId, callType: p.callType };
      setSession({ status: 'incoming', callType: p.callType, peerId: p.callerId });
      incomingRef.current?.(p.callerId, p.callType);
    };
    const onAccepted = (p: any) =>
      setSession({ status: 'connected', callType: metaRef.current.callType, peerId: p.recipientId });
    const onRejected = (p: any) =>
      setSession({ status: 'rejected', callType: metaRef.current.callType, peerId: p.rejectedBy });
    const onEnded = (p: any) =>
      setSession({ status: 'ended', callType: metaRef.current.callType, peerId: p.endedBy });

    s.on('incoming_call', onIncomingEvt);
    s.on('call_accepted', onAccepted);
    s.on('call_rejected', onRejected);
    s.on('call_ended', onEnded);

    return () => {
      s.off('incoming_call', onIncomingEvt);
      s.off('call_accepted', onAccepted);
      s.off('call_rejected', onRejected);
      s.off('call_ended', onEnded);
    };
  }, []);

  const call = (recipientId: string, callType: 'VOICE' | 'VIDEO' = 'VOICE') => {
    metaRef.current = { peerId: recipientId, callType };
    setSession({ status: 'calling', peerId: recipientId, callType });
    initiateCall(recipientId, callType);
  };

  const accept = () => {
    if (metaRef.current.peerId) acceptCall(metaRef.current.peerId);
    setSession((s) => ({ ...s, status: 'connected' }));
  };

  const reject = () => {
    if (metaRef.current.peerId) rejectCall(metaRef.current.peerId);
    setSession({ status: 'rejected', peerId: metaRef.current.peerId });
  };

  const end = (duration = 0) => {
    if (metaRef.current.peerId) endCall(metaRef.current.peerId, duration);
    setSession({ status: 'ended', peerId: metaRef.current.peerId });
  };

  const reset = () => {
    metaRef.current = {};
    setSession({ status: 'idle' });
  };

  return { session, call, accept, reject, end, reset };
}
