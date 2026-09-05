import { useEffect, useRef } from 'react';
import { getSocket, joinBooking, leaveBooking } from '../lib/socket';

type RealtimeHandlers = {
  onStatus?: (status: string) => void;
  onPartnerLocation?: (loc: { latitude: number; longitude: number }) => void;
  onEta?: (data: { minutes?: number; distance?: number }) => void;
};

// Subscribes to realtime updates for a single booking room. The socket is shared
// app-wide; the booking room carries status changes, live partner location and ETA.
export function useBookingRealtime(bookingId: string | undefined, handlers: RealtimeHandlers): void {
  const ref = useRef<RealtimeHandlers>(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!bookingId) return;
    const s = getSocket();

    const onStatus = (p: any) => {
      if (p?.bookingId === bookingId) ref.current.onStatus?.(p.status);
    };
    const onLoc = (p: any) => {
      if (p?.bookingId === bookingId) {
        ref.current.onPartnerLocation?.({ latitude: Number(p.latitude), longitude: Number(p.longitude) });
      }
    };
    const onEta = (p: any) => {
      if (p?.bookingId === bookingId) ref.current.onEta?.(p);
    };

    s.on('booking_status_changed', onStatus);
    s.on('partner_location', onLoc);
    s.on('eta_update', onEta);
    joinBooking(bookingId);

    return () => {
      s.off('booking_status_changed', onStatus);
      s.off('partner_location', onLoc);
      s.off('eta_update', onEta);
      leaveBooking(bookingId);
    };
  }, [bookingId]);
}
