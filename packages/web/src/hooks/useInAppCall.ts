// In-app voice calling over WebRTC.
//
// PRIVACY: media flows peer-to-peer between the two participants and the
// server only brokers the handshake. No phone number is requested, shown,
// stored or used at any point, so two people can talk without exchanging
// contact details.
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useSocket } from './useSocket';
import { useAuth } from '../lib/auth';
import { startCallRingtone, stopCallRingtone } from '../lib/notificationSound';

export type CallState = 'idle' | 'calling' | 'incoming' | 'connecting' | 'active';

export interface CallPeer {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface InAppCall {
  state: CallState;
  callId: string | null;
  peer: CallPeer | null;
  direction: 'outgoing' | 'incoming' | null;
  callType: 'VOICE' | 'VIDEO';
  muted: boolean;
  speakerOn: boolean;
  duration: number;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  /** Place a call. The peer's phone number is never used or requested. */
  startCall: (peer: CallPeer, callType?: 'VOICE' | 'VIDEO') => void;
  acceptCall: () => void;
  declineCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
}

// Google's public STUN servers let most peers find each other directly. Networks
// that block direct connections additionally need a relay, configured through
// VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
if (turnUrl) {
  ICE_SERVERS.push({
    urls: turnUrl,
    username: import.meta.env.VITE_TURN_USERNAME as string | undefined,
    credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
  });
}

const UNAVAILABLE_MESSAGES: Record<string, string> = {
  SELF_CALL: 'You cannot call yourself.',
  NO_RELATIONSHIP: 'You can only call people you have interacted with.',
  FORBIDDEN: 'You are not allowed to make this call.',
  NO_RECEIVER: 'This person is not available for calls.',
  CALL_GONE: 'This call already ended.',
  MEDIA_FAILED: 'The other person could not connect their microphone.',
  MIC_DENIED: 'Microphone access was blocked. Enable it to make calls.',
  DECLINED: 'Call declined.',
  NO_ANSWER: 'No answer.',
  REPLACED: 'Call cancelled.',
  DISCONNECTED: 'The other person lost connection.',
  CONNECTION_LOST: 'The call connection dropped.',
};

export function useInAppCall(): InAppCall {
  const { emit, on } = useSocket();
  const { user } = useAuth();

  const [state, setState] = useState<CallState>('idle');
  const [callId, setCallId] = useState<string | null>(null);
  const [peer, setPeer] = useState<CallPeer | null>(null);
  const [direction, setDirection] = useState<'outgoing' | 'incoming' | null>(null);
  const [callType, setCallType] = useState<'VOICE' | 'VIDEO'>('VOICE');
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [duration, setDuration] = useState(0);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<string | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  // Refs mirror state so the socket subscriptions stay stable (a re-subscribing
  // effect would drop call events mid-negotiation).
  const stateRef = useRef<CallState>('idle');
  const callTypeRef = useRef<'VOICE' | 'VIDEO'>('VOICE');
  const userId = user?.id;

  const applyState = useCallback((next: CallState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const applyCallType = useCallback((next: 'VOICE' | 'VIDEO') => {
    callTypeRef.current = next;
    setCallType(next);
  }, []);

  const teardownMedia = useCallback(() => {
    stopCallRingtone();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    pcRef.current?.close();
    pcRef.current = null;
    pendingCandidatesRef.current = [];
  }, []);

  const resetCall = useCallback(() => {
    teardownMedia();
    applyState('idle');
    setCallId(null);
    setPeer(null);
    setDirection(null);
    setMuted(false);
    setSpeakerOn(false);
    setDuration(0);
    callIdRef.current = null;
  }, [applyState, teardownMedia]);

  const endWithNotice = useCallback(
    (reason: string) => {
      const message = UNAVAILABLE_MESSAGES[reason];
      if (message) toast(message);
      resetCall();
    },
    [resetCall]
  );

  /** Ask for the microphone up front so permission errors surface immediately. */
  const acquireLocalMedia = useCallback(async (type: 'VOICE' | 'VIDEO'): Promise<MediaStream> => {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: type === 'VIDEO' ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  /** Create the peer connection and attach the local tracks. */
  const buildConnection = useCallback(
    async (targetCallId: string, type: 'VOICE' | 'VIDEO'): Promise<RTCPeerConnection> => {
      const stream = await acquireLocalMedia(type);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        const [remote] = event.streams;
        if (remote) {
          remoteStreamRef.current = remote;
        } else {
          const existing = remoteStreamRef.current ?? new MediaStream();
          existing.addTrack(event.track);
          remoteStreamRef.current = existing;
        }
        setRemoteStream(remoteStreamRef.current);
        applyState('active');
        stopCallRingtone();
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          emit('call:ice', { callId: targetCallId, payload: event.candidate.toJSON() });
        }
      };

      pc.onconnectionstatechange = () => {
        // Only react to a genuine failure; 'closed' is expected during teardown.
        if (pc.connectionState === 'failed') {
          emit('call:end', { callId: targetCallId });
          endWithNotice('CONNECTION_LOST');
        }
      };

      return pc;
    },
    [acquireLocalMedia, applyState, emit, endWithNotice]
  );

  /** Apply ICE candidates that arrived before the remote description. */
  const flushCandidates = useCallback(async (pc: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // A stale candidate is harmless; the handshake continues.
      }
    }
  }, []);

  const startCall = useCallback(
    (target: CallPeer, type: 'VOICE' | 'VIDEO' = 'VOICE') => {
      if (!userId || !target?.id) return;
      if (target.id === userId) {
        toast(UNAVAILABLE_MESSAGES.SELF_CALL);
        return;
      }
      teardownMedia();
      setPeer(target);
      setDirection('outgoing');
      applyCallType(type);
      applyState('calling');
      // Take the microphone before ringing so a blocked mic fails quietly for
      // the caller instead of dropping the other person into a dead call.
      void acquireLocalMedia(type)
        .then(() => {
          startCallRingtone();
          emit('call:invite', { receiverId: target.id, type });
        })
        .catch(() => endWithNotice('MIC_DENIED'));
    },
    [acquireLocalMedia, applyCallType, applyState, emit, endWithNotice, teardownMedia, userId]
  );

  const acceptCall = useCallback(() => {
    const targetCallId = callIdRef.current;
    if (!targetCallId) return;
    applyState('connecting');
    void buildConnection(targetCallId, callTypeRef.current)
      .then(() => emit('call:accept', { callId: targetCallId }))
      .catch(() => {
        emit('call:media_failed', { callId: targetCallId, reason: 'MIC_DENIED' });
        endWithNotice('MIC_DENIED');
      });
  }, [applyState, buildConnection, emit, endWithNotice]);

  const declineCall = useCallback(() => {
    const targetCallId = callIdRef.current;
    if (targetCallId) emit('call:reject', { callId: targetCallId });
    resetCall();
  }, [emit, resetCall]);

  const endCall = useCallback(() => {
    const targetCallId = callIdRef.current;
    if (targetCallId) emit('call:end', { callId: targetCallId });
    resetCall();
  }, [emit, resetCall]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  }, [muted]);

  const toggleSpeaker = useCallback(() => {
    const next = !speakerOn;
    setSpeakerOn(next);
    // Prefer the loudspeaker over the earpiece where the browser supports it;
    // other devices simply keep their default output.
    remoteStreamRef.current?.getAudioTracks().forEach((track) => {
      if (typeof track.applyConstraints === 'function') {
        void track
          // @ts-expect-error - advanced speaker constraint is not in lib.dom
          .applyConstraints({ advanced: [{ speaker: next ? 'on' : 'off' }] })
          .catch(() => undefined);
      }
    });
  }, [speakerOn]);

  // ---------------------------------------------------------------------
  // Socket events. Deps are intentionally stable so listeners are attached
  // once per session instead of re-binding on every state change.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!userId) return;

    // Caller side: the server confirmed the call exists, start ringing locally.
    const offRinging = on('call:ringing', (raw) => {
      const data = raw as { callId: string; type: 'VOICE' | 'VIDEO'; peer: CallPeer };
      callIdRef.current = data.callId;
      setCallId(data.callId);
      setPeer(data.peer);
      applyCallType(data.type === 'VIDEO' ? 'VIDEO' : 'VOICE');
      applyState('calling');
      startCallRingtone();
    });

    const offIncoming = on('call:incoming', (raw) => {
      const data = raw as { callId: string; type: 'VOICE' | 'VIDEO'; peer: CallPeer };
      // Already busy: decline straight away instead of dropping the current call.
      if (stateRef.current === 'active' || stateRef.current === 'calling' || stateRef.current === 'connecting') {
        emit('call:reject', { callId: data.callId });
        toast('Busy on another call.');
        return;
      }
      teardownMedia();
      callIdRef.current = data.callId;
      setCallId(data.callId);
      setPeer(data.peer);
      applyCallType(data.type === 'VIDEO' ? 'VIDEO' : 'VOICE');
      setDirection('incoming');
      applyState('incoming');
      startCallRingtone();
    });

    // The caller is the single offerer; the callee only answers. Sending two
    // offers would deadlock the handshake.
    const offAccepted = on('call:accepted', (raw) => {
      const data = raw as { callId: string; peer: CallPeer; initiator?: boolean };
      if (callIdRef.current !== data.callId) return;
      setPeer(data.peer);
      if (data.initiator === false) {
        // Callee: microphone already acquired in acceptCall, just wait for the offer.
        return;
      }
      void (async () => {
        try {
          const pc = pcRef.current ?? (await buildConnection(data.callId, callTypeRef.current));
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          emit('call:offer', { callId: data.callId, payload: pc.localDescription?.toJSON() });
        } catch {
          // Caller side: close the call outright, otherwise the callee would
          // sit in "connecting" with an open microphone.
          emit('call:end', { callId: data.callId });
          endWithNotice('CONNECTION_LOST');
        }
      })();
    });

    const offOffer = on('call:offer', (raw) => {
      const data = raw as { callId: string; payload: RTCSessionDescriptionInit };
      if (callIdRef.current !== data.callId) return;
      void (async () => {
        try {
          const pc = pcRef.current;
          if (!pc) return;
          await pc.setRemoteDescription(new RTCSessionDescription(data.payload));
          await flushCandidates(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          emit('call:answer', { callId: data.callId, payload: pc.localDescription?.toJSON() });
        } catch (err) {
          console.error('[CALL] could not answer the call:', err);
        }
      })();
    });

    const offAnswer = on('call:answer', (raw) => {
      const data = raw as { callId: string; payload: RTCSessionDescriptionInit };
      if (callIdRef.current !== data.callId) return;
      void (async () => {
        try {
          const pc = pcRef.current;
          if (!pc) return;
          await pc.setRemoteDescription(new RTCSessionDescription(data.payload));
          await flushCandidates(pc);
        } catch (err) {
          console.error('[CALL] could not apply the answer:', err);
        }
      })();
    });

    const offIce = on('call:ice', (raw) => {
      const data = raw as { callId: string; payload: RTCIceCandidateInit };
      if (callIdRef.current !== data.callId) return;
      const pc = pcRef.current;
      if (pc?.remoteDescription) {
        void pc.addIceCandidate(data.payload).catch(() => undefined);
      } else {
        // Candidates can outrun the SDP, so hold them until the description lands.
        pendingCandidatesRef.current.push(data.payload);
      }
    });

    const offRejected = on('call:rejected', (raw) => {
      const data = raw as { callId: string };
      if (callIdRef.current !== data.callId) return;
      endWithNotice('DECLINED');
    });

    const offEnded = on('call:ended', (raw) => {
      const data = raw as { callId: string; reason?: string };
      if (callIdRef.current && callIdRef.current !== data.callId) return;
      if (data.reason === 'NO_ANSWER') {
        endWithNotice('NO_ANSWER');
        return;
      }
      resetCall();
    });

    const offUnavailable = on('call:unavailable', (raw) => {
      const data = raw as { reason?: string };
      endWithNotice(data.reason ?? '');
    });

    return () => {
      offRinging?.();
      offIncoming?.();
      offAccepted?.();
      offOffer?.();
      offAnswer?.();
      offIce?.();
      offRejected?.();
      offEnded?.();
      offUnavailable?.();
    };
  }, [applyCallType, applyState, buildConnection, emit, endWithNotice, flushCandidates, on, resetCall, teardownMedia, userId]);

  // Call timer.
  useEffect(() => {
    if (state !== 'active') return;
    const timer = window.setInterval(() => setDuration((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  // Drop an unanswered ring when the app goes to the background, but keep a
  // connected call alive (the user may be checking another app).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      if (stateRef.current === 'calling' || stateRef.current === 'incoming') endCall();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [endCall]);

  // Never leave a live microphone behind on sign-out.
  useEffect(() => {
    if (!userId) resetCall();
  }, [resetCall, userId]);

  return {
    state,
    callId,
    peer,
    direction,
    callType,
    muted,
    speakerOn,
    duration,
    remoteStream,
    localStream,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleSpeaker,
  };
}

/** Format a call timer as m:ss. */
export function formatCallDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
