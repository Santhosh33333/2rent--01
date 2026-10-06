import { useEffect } from 'react';
import { Alert } from 'react-native';
import { getSocket } from '../lib/socket';
import { useAuthStore } from '../shared/store/authStore';

interface SosAlert {
  message?: string;
  bookingId?: string;
  latitude?: number | null;
  longitude?: number | null;
  triggeredBy?: string;
}

/**
 * Shows an SOS the moment it lands while the app is open.
 *
 * Two separate channels reach a recipient, and they cover different states:
 * the `sos_alert` room broadcast handled here is what makes an open app react
 * immediately, while the Notification row the server writes alongside it is
 * what produces the system-tray push when the app is backgrounded. Listening
 * to `notification` here as well would fire twice for the same emergency, so
 * this handler stays on the room event alone.
 *
 * Registered at the root rather than on the booking screen, because an admin
 * or a partner who has navigated away still has to see it.
 */
export function useSosAlerts(): void {
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    // Signed out: there is no session to listen with, and building a socket
    // here would only manufacture a rejected handshake on every cold start.
    if (!user) return;

    const socket = getSocket();

    const onSos = (alert: SosAlert) => {
      // The button that fires an SOS already shows its own confirmation, and
      // the broadcast still reaches the sender through the booking room.
      // Echoing it back as a blocking dialog just interrupts the person who
      // already knows they pressed it.
      if (alert?.triggeredBy && alert.triggeredBy === user.id) return;

      const lines = [alert?.message || 'Emergency SOS'];
      if (alert?.latitude != null && alert?.longitude != null) {
        lines.push(`Location: ${alert.latitude}, ${alert.longitude}`);
      }
      if (alert?.bookingId) lines.push(`Booking ${alert.bookingId}`);

      Alert.alert('Emergency SOS', lines.join('\n'));
    };

    socket.on('sos_alert', onSos);
    return () => {
      socket.off('sos_alert', onSos);
    };
  }, [user]);
}
