import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Screen, Title, Card } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { get } from '../../src/lib/api';

export default function Bookings() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ['my-bookings'],
    queryFn: () => get('/bookings'),
  });

  const bookings = (data?.data?.bookings ?? data?.data ?? []) as any[];

  return (
    <Screen>
      <Title>Bookings</Title>
      <Text style={styles.sub}>Your requests and active jobs.</Text>
      {isLoading ? <Text style={styles.sub}>Loading…</Text> : null}
      <FlatList
        data={bookings}
        keyExtractor={(item) => item.id ?? Math.random().toString()}
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/booking/${item.id}`)}>
            <View style={styles.row}>
              <Text style={styles.service}>{item.serviceType ?? 'Service'}</Text>
              <Text style={[styles.badge, statusColor(item.status)]}>{item.status ?? 'UNKNOWN'}</Text>
            </View>
            <Text style={styles.meta}>
              {item.startLocation}
              {item.endLocation ? ` → ${item.endLocation}` : ''}
            </Text>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.sub}>No bookings yet. Create one from Home.</Text>}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </Screen>
  );
}

function statusColor(status?: string) {
  switch ((status ?? '').toUpperCase()) {
    case 'COMPLETED':
    case 'CONFIRMED':
      return { color: Colors.success };
    case 'CANCELLED':
    case 'REFUNDED':
    case 'EXPIRED':
      return { color: Colors.error };
    default:
      return { color: Colors.warning };
  }
}

const styles = StyleSheet.create({
  sub: { fontSize: 14, color: Colors.onSurfaceVariant, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  service: { color: Colors.onSurfaceDark, fontWeight: '700', fontSize: 16 },
  badge: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  meta: { color: Colors.onSurfaceVariant, fontSize: 13, marginTop: 4 },
});
