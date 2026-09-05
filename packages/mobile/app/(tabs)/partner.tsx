import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Title, Card, Button, Alert } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { get, post, errorMessage } from '../../src/lib/api';
import { useAuthStore } from '../../src/shared/store/authStore';
import { usePartnerLocationBroadcast } from '../../src/hooks/usePartnerLocationBroadcast';
import { useCallSignaling } from '../../src/hooks/useCallSignaling';
import { CallModal } from '../../src/components/CallModal';

export default function Partner() {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const [error, setError] = useState<string | null>(null);

  const isPartner = (user?.activeRole ?? user?.role) === 'PARTNER';

  const statusQ = useQuery({ queryKey: ['partner-status'], queryFn: () => get<any>('/partner/status'), enabled: isPartner });
  const perfQ = useQuery({ queryKey: ['partner-perf'], queryFn: () => get<any>('/partner/performance'), enabled: isPartner });
  const nearbyQ = useQuery({ queryKey: ['partner-nearby'], queryFn: () => get<any>('/partner/nearby-bookings'), enabled: isPartner });
  const jobsQ = useQuery({ queryKey: ['partner-jobs'], queryFn: () => get<any>('/partner/bookings'), enabled: isPartner });

  const status = (statusQ.data?.data ?? {}) as any;
  const perf = (perfQ.data?.data ?? {}) as any;
  const nearby = (nearbyQ.data?.data?.bookings ?? nearbyQ.data?.data ?? []) as any[];
  const jobs = (jobsQ.data?.data?.bookings ?? jobsQ.data?.data ?? []) as any[];

  const activeJobId = jobs.find((j: any) =>
    ['ACCEPTED', 'PARTNER_ASSIGNED', 'OTP_GENERATED', 'IN_PROGRESS', 'STARTED', 'ARRIVING', 'ARRIVED'].includes(
      (j.status || '').toUpperCase()
    )
  )?.id;
  usePartnerLocationBroadcast(activeJobId);
  const callSig = useCallSignaling();

  const doSwitch = useMutation({
    mutationFn: () => post<any>('/role/switch', { role: 'PARTNER' }),
    onSuccess: () => {
      updateUser({ activeRole: 'PARTNER' });
      qc.invalidateQueries();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => post<any>(`/partner/bookings/${id}/${action}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-nearby'] }),
    onError: (e) => setError(errorMessage(e)),
  });

  if (!isPartner) {
    return (
      <Screen>
        <Title>Partner Mode</Title>
        <Alert message="Switch to Partner to see jobs, earnings and go online." tone="info" />
        <Button label="Switch to Partner" onPress={() => doSwitch.mutate()} loading={doSwitch.isPending} />
        {error ? <Alert message={error} tone="error" /> : null}
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Partner Dashboard</Title>
      <Card>
        <Text style={styles.row}>
          Status: <Text style={{ color: status.approved ? Colors.success : Colors.warning }}>{status.approved ? 'APPROVED' : 'PENDING'}</Text>
        </Text>
        <Text style={styles.meta}>Completed jobs: {perf.completedJobs ?? 0}</Text>
        <Text style={styles.meta}>Earnings: ₹{Number(perf.lifetimeEarnings ?? 0).toLocaleString('en-IN')}</Text>
        <Text style={styles.meta}>Rating: {perf.averageRating ?? '—'}</Text>
      </Card>

      <Text style={styles.section}>Nearby jobs</Text>
      <FlatList
        data={nearby}
        keyExtractor={(i) => i.id ?? Math.random().toString()}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.service}>{item.serviceType ?? 'Job'}</Text>
              <Text style={styles.amount}>₹{Number(item.estimatedAmount ?? 0).toFixed(2)}</Text>
            </View>
            <Text style={styles.meta}>{item.startLocation}{item.endLocation ? ` → ${item.endLocation}` : ''}</Text>
            <Button label="Accept" onPress={() => act.mutate({ id: item.id, action: 'accept' })} loading={act.isPending} />
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.sub}>No nearby jobs right now.</Text>}
        contentContainerStyle={{ paddingBottom: 12 }}
      />

      <Text style={styles.section}>My jobs</Text>
      <FlatList
        data={jobs}
        keyExtractor={(i) => i.id ?? Math.random().toString()}
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/booking/${item.id}`)}>
            <View style={styles.rowBetween}>
              <Text style={styles.service}>{item.serviceType ?? 'Job'}</Text>
              <Text style={[styles.badge, statusColor(item.status)]}>{item.status ?? 'UNKNOWN'}</Text>
            </View>
            {item.status === 'ACCEPTED' ? (
              <Button label="Complete" variant="ghost" onPress={() => act.mutate({ id: item.id, action: 'complete' })} loading={act.isPending} />
            ) : null}
            {item.userId ? (
              <Button label="Call user" variant="ghost" onPress={() => callSig.call(item.userId, 'VOICE')} />
            ) : null}
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.sub}>No active jobs.</Text>}
        contentContainerStyle={{ paddingBottom: 20 }}
        refreshControl={<RefreshControl refreshing={nearbyQ.isFetching || jobsQ.isFetching} onRefresh={() => { nearbyQ.refetch(); jobsQ.refetch(); }} />}
      />
      {error ? <Alert message={error} tone="error" /> : null}
      <CallModal
        session={callSig.session}
        peerName="User"
        onAccept={callSig.accept}
        onReject={callSig.reject}
        onEnd={callSig.end}
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
  section: { color: Colors.onSurfaceDark, fontWeight: '800', fontSize: 18, marginVertical: 12 },
  sub: { fontSize: 14, color: Colors.onSurfaceVariant, marginBottom: 16 },
  row: { color: Colors.onSurfaceDark, fontSize: 15, fontWeight: '600' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  service: { color: Colors.onSurfaceDark, fontWeight: '700', fontSize: 16 },
  amount: { color: Colors.onSurfaceDark, fontWeight: '800', fontSize: 15 },
  badge: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  meta: { color: Colors.onSurfaceVariant, fontSize: 13, marginTop: 4 },
});
