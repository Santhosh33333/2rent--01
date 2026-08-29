import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useBookingTracking } from '../hooks/useSocket';

interface UBooking {
  id: string;
  status: string;
}

// Streams the booking owner's live GPS for their active booking so that the
// assigned partner AND admins can see both parties' positions for safety.
const TRACK_STATUSES = ['PARTNER_ACCEPTED', 'OTP_GENERATED', 'IN_PROGRESS'];

export function UserLiveLocationSharer() {
  const { user } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await api.get('/bookings');
        const data = res.data?.data ?? res.data ?? [];
        const arr: UBooking[] = Array.isArray(data) ? data : data.items ?? [];
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
  const { sendUserLocation } = useBookingTracking(bookingId);
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
        sendUserLocation(pos.coords.latitude, pos.coords.longitude, heading, speed);
      },
      () => {
        // non-fatal: admin simply won't see live user movement
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );

    return () => navigator.geolocation.clearWatch(watch);
  }, [bookingId, sendUserLocation]);

  return null;
}
