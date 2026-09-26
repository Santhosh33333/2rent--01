// Initiates in-app calls without owning call state.
//
// The single call state machine lives in the global <CallOverlay /> at the app
// root; pages only fire the invite and let the overlay take over. That keeps
// one WebRTC session per app, so a call started on the bookings screen keeps
// ringing after the user navigates elsewhere.
import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { useSocket } from './useSocket';
import type { CallPeer } from './useInAppCall';

export function useCallLauncher() {
  const { emit, isConnected } = useSocket();

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
      emit('call:invite', { receiverId: peer.id, type: callType });
    },
    [emit, isConnected]
  );
}
