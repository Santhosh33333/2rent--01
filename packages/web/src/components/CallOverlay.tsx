import { useEffect, useRef } from 'react';
import { Mic, MicOff, PhoneOff, Phone, Volume2, VolumeX, User } from 'lucide-react';
import { useInAppCall, formatCallDuration, type CallPeer } from '../hooks/useInAppCall';

function initials(name: string | null): string {
  const parts = (name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function PeerAvatar({ peer, size }: { peer: CallPeer | null; size: 'lg' | 'sm' }) {
  const dimension = size === 'lg' ? 'h-24 w-24 text-3xl' : 'h-16 w-16 text-xl';
  if (peer?.avatarUrl) {
    return (
      <img
        src={peer.avatarUrl}
        alt={peer.fullName || 'Caller'}
        className={`${dimension} rounded-full object-cover ring-4 ring-white/20`}
      />
    );
  }
  return (
    <div
      className={`${dimension} flex items-center justify-center rounded-full bg-white/15 font-semibold text-white ring-4 ring-white/20`}
    >
      {peer?.fullName ? initials(peer.fullName) : <User className="h-10 w-10" aria-hidden />}
    </div>
  );
}

function ActionButton({
  onClick,
  label,
  tone,
  children,
}: {
  onClick: () => void;
  label: string;
  tone: 'danger' | 'neutral' | 'accept';
  children: React.ReactNode;
}) {
  const toneClass =
    tone === 'danger'
      ? 'bg-red-600 hover:bg-red-500'
      : tone === 'accept'
        ? 'bg-emerald-600 hover:bg-emerald-500'
        : 'bg-white/15 hover:bg-white/25';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition focus:outline-none focus:ring-2 focus:ring-white/70 ${toneClass}`}
    >
      {children}
    </button>
  );
}

/**
 * Global in-app call screen. Mounted once at the app root so a call can ring
 * no matter which page the user is on.
 *
 * Only the peer's name and avatar are displayed - never a phone number. The
 * connection is WebRTC, so the two people talk directly without exchanging
 * contact details.
 */
export default function CallOverlay() {
  const {
    state,
    peer,
    callType,
    muted,
    speakerOn,
    duration,
    remoteStream,
    localStream,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleSpeaker,
  } = useInAppCall();

  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  // Attach the peer's media so the browser actually plays the audio.
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) remoteAudioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  if (state === 'idle') return null;

  const isVideo = callType === 'VIDEO';
  const isIncoming = state === 'incoming';

  const statusLine =
    state === 'calling'
      ? 'Calling…'
      : state === 'connecting'
        ? 'Connecting…'
        : state === 'incoming'
          ? `Incoming ${isVideo ? 'video' : 'voice'} call`
          : formatCallDuration(duration);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${statusLine} ${peer?.fullName || ''}`.trim()}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-slate-900/95 px-6 py-12 backdrop-blur-sm sm:px-10"
    >
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 text-center">
        {isVideo && state === 'active' && remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="h-64 w-full max-w-sm rounded-3xl bg-slate-800 object-cover shadow-2xl sm:h-80"
          />
        ) : null}

        <PeerAvatar peer={peer} size="lg" />

        <div className="space-y-1">
          <p className="text-2xl font-semibold text-white">{peer?.fullName || 'Nabri member'}</p>
          <p className="text-sm text-white/70" aria-live="polite">
            {statusLine}
          </p>
          {state === 'active' ? (
            <p className="text-xs text-white/50">Private app call · no numbers shared</p>
          ) : null}
        </div>
      </div>

      {isVideo && state === 'active' ? (
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute bottom-32 right-6 h-32 w-24 rounded-2xl bg-slate-800 object-cover shadow-xl ring-1 ring-white/20 sm:h-40 sm:w-32"
        />
      ) : null}

      <div className="flex w-full items-center justify-center gap-6">
        {isIncoming ? (
          <>
            <ActionButton onClick={declineCall} label="Decline call" tone="danger">
              <PhoneOff className="h-7 w-7" aria-hidden />
            </ActionButton>
            <ActionButton onClick={acceptCall} label="Accept call" tone="accept">
              <Phone className="h-7 w-7" aria-hidden />
            </ActionButton>
          </>
        ) : (
          <>
            {state === 'active' ? (
              <>
                <ActionButton onClick={toggleMute} label={muted ? 'Unmute microphone' : 'Mute microphone'} tone="neutral">
                  {muted ? <MicOff className="h-7 w-7" aria-hidden /> : <Mic className="h-7 w-7" aria-hidden />}
                </ActionButton>
                <ActionButton onClick={toggleSpeaker} label={speakerOn ? 'Turn speaker off' : 'Turn speaker on'} tone="neutral">
                  {speakerOn ? <Volume2 className="h-7 w-7" aria-hidden /> : <VolumeX className="h-7 w-7" aria-hidden />}
                </ActionButton>
              </>
            ) : null}
            <ActionButton onClick={endCall} label="End call" tone="danger">
              <PhoneOff className="h-7 w-7" aria-hidden />
            </ActionButton>
          </>
        )}
      </div>

      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
    </div>
  );
}
