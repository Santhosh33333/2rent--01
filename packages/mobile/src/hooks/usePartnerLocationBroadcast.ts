import { useEffect } from 'react';
import * as Location from 'expo-location';
import { emitPartnerLocation } from '../lib/socket';

// Partner broadcasts their GPS to the assigned booking room so the user sees
// live tracking. Stops automatically when bookingId is cleared/unmounted.
export function usePartnerLocationBroadcast(bookingId: string | undefined): void {
  useEffect(() => {
    if (!bookingId) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        (pos) => {
          if (!cancelled) emitPartnerLocation(bookingId, pos.coords.latitude, pos.coords.longitude);
        }
      );
    })();

    return () => {
      cancelled = true;
      if (sub) sub.remove();
    };
  }, [bookingId]);
}
