// Initiates in-app calls without owning call state.
//
// The single call state machine lives in the global <CallOverlay /> at the app
// root; pages only ask it to start a call and let the overlay take over. That
// keeps one WebRTC session per app, so a call started on the bookings screen
// keeps ringing after the user navigates elsewhere.
//
// This used to fire the `call:invite` socket event itself instead of going
// through the overlay. That skipped `startCall`'s up-front microphone capture,
// so the caller's permission prompt only appeared after the callee had already
// accepted - and a missed prompt left the call connected but silent. It now
// delegates to the registered controller so there is exactly one call path.
import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { useSocket } from './useSocket';
import { getCallController, type CallPeer } from './useInAppCall';

export function useCallLauncher() {
  const { isConnected } = useSocket();

  return useCallback(
    (peer: CallPeer | null | undefined, callType: 'VOICE' | 'VIDEO' = 'VOICE') => {
      if (!peer?.id) {
        toast.error('This person is not available for calls right now.');
        return;
      }
      if (!isConnected()) {
        toast.error('You are offline. Reconnect to place a call.');
        return;
      }
      const controller = getCallController();
      if (!controller) {
        // The overlay mounts at the app root, so this only happens before the
        // app has finished booting. Saying so beats ringing into the void.
        toast.error('Calling is still starting up. Please try again in a moment.');
        return;
      }
      controller.startCall(peer, callType);
    },
    [isConnected]
  );
}
