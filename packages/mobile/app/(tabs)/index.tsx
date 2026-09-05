import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen, Title, Card } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { get } from '../../src/lib/api';
import { useAuthStore } from '../../src/shared/store/authStore';

const SERVICES = [
  { key: 'WALKING_BUDDY', label: 'Walking Buddy', icon: '🚶' },
  { key: 'CARRY_BUDDY', label: 'CarryBuddy', icon: '🎒' },
  { key: 'MOVIE_PARTNER', label: 'Movie Partner', icon: '🎬' },
  { key: 'TRAVEL_BUDDY', label: 'Travel Buddy', icon: '✈️' },
  { key: 'FITNESS_PARTNER', label: 'Fitness', icon: '💪' },
  { key: 'STUDY_PARTNER', label: 'Study', icon: '📚' },
  { key: 'FOOD_COFFEE_PARTNER', label: 'Food/Coffee', icon: '☕' },
  { key: 'LANGUAGE_PARTNER', label: 'Language', icon: '🗣️' },
];

export default function Home() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const { data } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => get('/dashboard/stats'),
  });

  const stats = (data?.data ?? {}) as any;

  const { data: bd } = useQuery({
    queryKey: ['home-bookings'],
    queryFn: () => get('/bookings'),
    enabled: !!user,
  });
  const myBookings = (bd?.data?.bookings ?? bd?.data ?? []) as any[];
  const ACTIVE_STATES = [
    'PARTNER_SEARCHING',
    'PARTNER_ASSIGNED',
    'PARTNER_ACCEPTED',
    'OTP_GENERATED',
    'IN_PROGRESS',
    'STARTED',
    'ARRIVING',
    'AWAITING_PAYMENT',
    'PAYMENT_PENDING',
  ];
  const activeBooking = myBookings.find((b) => ACTIVE_STATES.includes((b.status || '').toUpperCase()));

  return (
    <Screen>
      <Title>Hi {user?.fullName?.split(' ')[0] ?? 'there'} 👋</Title>
      <Text style={styles.sub}>What do you need today?</Text>

      {activeBooking ? (
        <Card style={styles.active} onPress={() => router.push(`/booking/${activeBooking.id}`)}>
          <Text style={styles.activeTitle}>Active booking · {activeBooking.status}</Text>
          <Text style={styles.activeSub}>{activeBooking.serviceType ?? 'Booking'} — tap to open</Text>
        </Card>
      ) : null}

      <View style={styles.grid}>
        {SERVICES.map((s) => (
          <TouchableOpacity
            key={s.key}
            style={styles.tile}
            onPress={() => router.push({ pathname: '/create', params: { serviceType: s.key } })}
          >
            <Text style={styles.tileIcon}>{s.icon}</Text>
            <Text style={styles.tileLabel}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Card onPress={() => router.push('/(tabs)/bookings')}>
        <Text style={styles.cardTitle}>Your bookings</Text>
        <Text style={styles.cardSub}>
          {typeof stats.activeBookings === 'number'
            ? `${stats.activeBookings} active · ${stats.completedBookings ?? 0} completed`
            : 'Tap to view your requests'}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { fontSize: 14, color: Colors.onSurfaceVariant, marginBottom: 18 },
  active: { backgroundColor: Colors.primary + '1A', borderColor: Colors.primary, marginBottom: 16 },
  activeTitle: { color: Colors.onSurfaceDark, fontWeight: '800', fontSize: 15 },
  activeSub: { color: Colors.onSurfaceVariant, fontSize: 13, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  tile: {
    width: '47%',
    backgroundColor: Colors.surfaceDark,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  tileIcon: { fontSize: 28, marginBottom: 8 },
  tileLabel: { color: Colors.onSurfaceDark, fontWeight: '600', fontSize: 14 },
  cardTitle: { color: Colors.onSurfaceDark, fontWeight: '700', fontSize: 16 },
  cardSub: { color: Colors.onSurfaceVariant, fontSize: 13, marginTop: 4 },
});
