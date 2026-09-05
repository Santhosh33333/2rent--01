import { View, Text, StyleSheet } from 'react-native';
import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import MapView, { Marker } from 'react-native-maps';
import { Screen, Title, Card } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { get } from '../../src/lib/api';
import { useBookingRealtime } from '../../src/hooks/useBookingRealtime';

const FALLBACK = { latitude: 20.5937, longitude: 78.9629 };

export default function Tracking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ['tracking', id],
    queryFn: () => get<any>(`/bookings/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
  const b = (data?.data ?? {}) as any;

  const [liveLoc, setLiveLoc] = useState<{ latitude: number; longitude: number } | null>(null);
  useBookingRealtime(id, { onPartnerLocation: (l) => setLiveLoc(l) });

  const pLat = liveLoc?.latitude ?? b?.partnerLatitude ?? b?.assignedPartner?.latitude;
  const pLon = liveLoc?.longitude ?? b?.partnerLongitude ?? b?.assignedPartner?.longitude;
  const sLat = b?.startLatitude;
  const sLon = b?.startLongitude;

  const region = {
    latitude: Number(pLat ?? sLat ?? FALLBACK.latitude),
    longitude: Number(pLon ?? sLon ?? FALLBACK.longitude),
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  };

  return (
    <Screen>
      <Title>Live Tracking</Title>
      <Text style={styles.sub}>Booking #{String(id).slice(0, 8)} · {b.status ?? '—'}</Text>

      <Card style={styles.mapCard}>
        <MapView style={styles.map} region={region} showsUserLocation>
          {sLat != null && sLon != null ? (
            <Marker coordinate={{ latitude: Number(sLat), longitude: Number(sLon) }} title="Pickup" pinColor="#6750A4" />
          ) : null}
          {pLat != null && pLon != null ? (
            <Marker coordinate={{ latitude: Number(pLat), longitude: Number(pLon) }} title="Partner" />
          ) : null}
        </MapView>
      </Card>

      <Card>
        <Text style={styles.label}>Partner</Text>
        <Text style={styles.value}>{b?.assignedPartner?.fullName ?? b?.partner?.user?.fullName ?? '—'}</Text>
        <Text style={styles.label}>Live location</Text>
        {pLat != null && pLon != null ? (
          <Text style={styles.value}>{Number(pLat).toFixed(5)}, {Number(pLon).toFixed(5)}</Text>
        ) : (
          <Text style={styles.value}>Waiting for partner location…</Text>
        )}
        <Text style={styles.label}>Pickup</Text>
        <Text style={styles.value}>{b.startLocation ?? '—'}</Text>
        <Text style={styles.label}>Drop</Text>
        <Text style={styles.value}>{b.endLocation ?? '—'}</Text>
      </Card>

      {isLoading ? <Text style={styles.sub}>Loading…</Text> : null}
      <Text style={styles.note}>Location refreshes every 5s.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { fontSize: 14, color: Colors.onSurfaceVariant, marginBottom: 16 },
  mapCard: { padding: 0, overflow: 'hidden' },
  map: { width: '100%', height: 220, borderRadius: 16 },
  label: { color: Colors.onSurfaceVariant, fontSize: 12, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { color: Colors.onSurfaceDark, fontSize: 15, fontWeight: '600' },
  note: { color: Colors.onSurfaceVariant, fontSize: 12, marginTop: 12, fontStyle: 'italic' },
});
