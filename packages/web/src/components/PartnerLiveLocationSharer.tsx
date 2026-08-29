import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useBookingTracking } from '../hooks/useSocket';

interface PBooking {
  id: string;
  status: string;
}

// Share the partner's live GPS from the moment a booking is accepted until it is
// completed/cancelled, so the user can track the partner in real time. Without
// this, the user-side BookingTracker never receives partner_location and the
// "share location during walks" feature shows nothing.
const TRACK_STATUSES = ['PARTNER_ACCEPTED', 'OTP_GENERATED', 'IN_PROGRESS'];

export function PartnerLiveLocationSharer() {
  const { user } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!user || (user.role !== 'PARTNER' && user.activeRole !== 'PARTNER')) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await api.get('/partner/bookings');
        const data = res.data?.data ?? res.data ?? [];
        const arr: PBooking[] = Array.isArray(data) ? data : data.items ?? [];
        const active = arr.find((b) => TRACK_STATUSES.includes(b.status));
        if (!cancelled) setActiveId(active ? active.id : null);
      } catch {
        // keep previous state on transient errors
      }
    };

    load();
    const iv = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [user]);

  if (!activeId) return null;
  return <LiveShare bookingId={activeId} />;
}

function LiveShare({ bookingId }: { bookingId: string }) {
  const { sendLocation } = useBookingTracking(bookingId);
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSentRef.current < 2000) return; // throttle ~2s
        lastSentRef.current = now;
        const heading =
          typeof pos.coords.heading === 'number' ? pos.coords.heading : undefined;
        const speed =
          typeof pos.coords.speed === 'number' && pos.coords.speed >= 0
            ? pos.coords.speed * 3.6
            : undefined;
        sendLocation(pos.coords.latitude, pos.coords.longitude, heading, speed);
      },
      () => {
        // location errors are non-fatal; the user simply won't see live movement
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );

    return () => navigator.geolocation.clearWatch(watch);
  }, [bookingId, sendLocation]);

  return null;
}
