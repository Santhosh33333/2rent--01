import { Phone, Video } from 'lucide-react';
import { useCallLauncher } from '../hooks/useCallLauncher';
import type { CallPeer } from '../hooks/useInAppCall';

interface CallUserButtonProps {
  peer: CallPeer | null | undefined;
  callType?: 'VOICE' | 'VIDEO';
  /** "icon" = compact circular button, "label" = icon + text. */
  variant?: 'icon' | 'label';
  className?: string;
  disabled?: boolean;
  label?: string;
}

/**
 * Places an in-app WebRTC call to another member.
 *
 * Deliberately not a `tel:` link: the call is brokered by the app, so neither
 * party ever sees or shares the other's phone number.
 */
export default function CallUserButton({
  peer,
  callType = 'VOICE',
  variant = 'icon',
  className = '',
  disabled = false,
  label,
}: CallUserButtonProps) {
  const startCall = useCallLauncher();
  const isVideo = callType === 'VIDEO';
  const Icon = isVideo ? Video : Phone;
  const text = label ?? (isVideo ? 'Start video call' : 'Call');

  if (variant === 'label') {
    return (
      <button
        type="button"
        onClick={() => startCall(peer, callType)}
        disabled={disabled || !peer?.id}
        title={`${text} inside the app - your number stays private`}
        className={`inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <Icon className="h-4 w-4" aria-hidden />
        {text}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => startCall(peer, callType)}
      disabled={disabled || !peer?.id}
      aria-label={`${text} ${peer?.fullName || 'this person'} inside the app`}
      title={`${text} inside the app - your number stays private`}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary-600 text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </button>
  );
}
