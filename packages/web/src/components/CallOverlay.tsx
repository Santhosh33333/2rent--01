import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, MicOff, PhoneOff, Phone, Volume2, VolumeX } from 'lucide-react';
import { useInAppCall, formatCallDuration, registerCallController, type CallPeer } from '../hooks/useInAppCall';
import { useScreenLock } from '../hooks/useScreenLock';
import { callApi, type CallTerms } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Avatar } from './Avatar';

function PeerAvatar({ peer, size }: { peer: CallPeer | null; size: 'lg' | 'sm' }) {
  const dimension = size === 'lg' ? 'h-24 w-24 text-3xl' : 'h-16 w-16 text-xl';
  // `peer.avatarUrl` comes straight off the socket as a relative `/uploads/...`
  // path. It used to be used as a raw `src`, which resolved against the *web*
  // origin: dev hid that behind the Vite /uploads proxy, but in production the
  // SPA catch-all answered with index.html and a 200, so the browser got HTML
  // for an image and drew a broken glyph. Avatar resolves it via assetUrl()
  // against the API origin and falls back to initials when it cannot load.
  return (
    <Avatar
      src={peer?.avatarUrl}
      name={peer?.fullName}
      className={`${dimension} ring-4 ring-white/20`}
      textClassName="ring-4 ring-white/20"
    />
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
  const call = useInAppCall();
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
  } = call;

  // An in-progress call owns the screen: Back must not drop the user out of it
  // (the way out is End call / Decline). Idle releases the lock.
  useScreenLock(state !== 'idle');

  // Publish this instance to the call registry so CallUserButton and the pages
  // start calls through this state machine. That path takes the microphone
  // before ringing; firing the invite directly (what the launcher used to do)
  // deferred the mic prompt to accept time and could leave a silent call.
  useEffect(() => {
    registerCallController(call);
  });
  useEffect(() => () => registerCallController(null), []);

  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  // Latest call state, readable from the notification listener without
  // re-subscribing on every state change.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // What a call costs this user. Fetched once (the rate is admin-edited rarely)
  // so the price is shown before the meter starts, and an exempt account is told
  // its call is free rather than quoted a price it will not be charged.
  const { user } = useAuth();
  const [terms, setTerms] = useState<CallTerms | null>(null);
  useEffect(() => {
    // Only after sign-in: the overlay is mounted at the app root, so fetching
    // before a session exists would be a guaranteed 401 on every public page.
    if (!user?.id) return;
    let alive = true;
    callApi
      .terms()
      .then((res) => {
        if (alive) setTerms(res.data.data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user?.id]);

  const navigate = useNavigate();

  // A tapped push notification is routed here. For an incoming call that has
  // already timed out this opens the caller's chat so the user can ring back;
  // while a call is still ringing the overlay already owns the screen, so we
  // leave the user where they are. Every other push deep-links through the
  // `route` the backend attached (new message, dating like/match, chat request
  // accepted, ...): previously only call taps were handled, so a tapped message
  // notification opened the app and left the user where they already were.
  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<{
        type?: string;
        callerId?: string;
        senderId?: string;
        route?: string;
      }>).detail;
      if (!detail) return;
      if (detail.type === 'INCOMING_CALL' && detail.callerId) {
        if (stateRef.current === 'incoming') return;
        navigate(`/messages/${detail.callerId}`);
        return;
      }
      if (typeof detail.route === 'string' && detail.route.startsWith('/')) {
        navigate(detail.route);
        return;
      }
      // Message pushes that predate the `route` field still know the sender.
      if (detail.type === 'message' && detail.senderId) {
        navigate(`/messages/${detail.senderId}`);
      }
    };
    window.addEventListener('nabri:notification-action', onAction);
    return () => window.removeEventListener('nabri:notification-action', onAction);
  }, [navigate]);

  // Attach the peer's media so the browser actually plays the audio. `autoPlay`
  // alone is not reliable inside the Android WebView: the track arrives after
  // the accept tap, so the user gesture that unlocks autoplay has already been
  // consumed. Call play() explicitly and retry once metadata is ready.
  useEffect(() => {
    const el = remoteAudioRef.current;
    if (!el || !remoteStream) return;
    el.srcObject = remoteStream;
    const attempt = () => {
      void el.play().catch(() => {});
    };
    attempt();
    el.onloadedmetadata = attempt;
    return () => {
      el.onloadedmetadata = null;
    };
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
            <>
              <p className="text-xs text-white/50">Private app call · no numbers shared</p>
              {/* Voice is the one channel we cannot scan - the PII guard only
                  sees text - so the call UI has to carry the warning itself. */}
              <p className="text-[11px] leading-relaxed text-amber-300/80">
                Voice isn&rsquo;t filtered like chat — never share your number, OTP or address.
              </p>
            </>
          ) : null}
          {(state === 'calling' || state === 'connecting' || state === 'active') && terms?.enabled ? (
            <p className="text-xs text-amber-300/90">
              ₹{terms.ratePerMinute.toFixed(2)}/min · billed per started minute
            </p>
          ) : null}
          {(state === 'calling' || state === 'connecting' || state === 'active') && terms?.exempt ? (
            <p className="text-xs text-emerald-300/90">Free call · verified access</p>
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
