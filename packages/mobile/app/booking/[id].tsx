import { View, Text, StyleSheet, Linking, Pressable, Alert as RNAlert } from 'react-native';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Title, Card, Button, Alert } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { get, post, errorMessage } from '../../src/lib/api';
import { useAuthStore } from '../../src/shared/store/authStore';
import { useBookingRealtime } from '../../src/hooks/useBookingRealtime';
import { useCallSignaling } from '../../src/hooks/useCallSignaling';
import { emitSos } from '../../src/lib/socket';
import { CallModal } from '../../src/components/CallModal';
// Real Razorpay checkout. Requires: npm i react-native-razorpay
import RazorpayCheckout from 'react-native-razorpay';

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [partnerLoc, setPartnerLoc] = useState<{ latitude: number; longitude: number } | null>(null);

  useBookingRealtime(id, {
    onStatus: (s) => setLiveStatus(s),
    onPartnerLocation: (l) => setPartnerLoc(l),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['booking', id],
    queryFn: () => get<any>(`/bookings/${id}`),
    enabled: !!id,
  });
  const booking = (data?.data ?? {}) as any;

  const act = useMutation({
    mutationFn: (action: string) => post<any>(`/bookings/${id}/${action}`, {}),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['booking', id] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const startPay = async () => {
    try {
      setPaying(true);
      setError(null);
      const res = await post<any>(`/bookings/${id}/pay`, {});
      const order = res.data ?? {};
      const data = await RazorpayCheckout.open({
        description: `RentBuddy — ${booking.serviceType ?? 'Booking'}`,
        currency: order.currency ?? 'INR',
        key: order.key || '',
        amount: Math.round((order.amount ?? 0) * 100),
        order_id: order.orderId,
        name: 'RentBuddy',
        prefill: { contact: user?.phone ?? '', email: user?.email ?? '' },
        theme: { color: Colors.primary },
      });
      await post(`/bookings/${id}/verify-payment`, {
        razorpay_payment_id: data.razorpay_payment_id,
        razorpay_order_id: data.razorpay_order_id,
        razorpay_signature: data.razorpay_signature,
      });
      qc.invalidateQueries({ queryKey: ['booking', id] });
    } catch (e: any) {
      if (e?.error?.description) setError(e.error.description);
      else setError(errorMessage(e));
    } finally {
      setPaying(false);
    }
  };

  const callPartner = async () => {
    try {
      await post(`/call/${id}`, {});
    } catch {
      // call session is best-effort; fall back to dialer
    }
    const phone = booking?.assignedPartner?.phone || booking?.partner?.phone || booking?.acceptedBy?.phone;
    if (phone) Linking.openURL(`tel:${phone}`);
  };

  const status = (liveStatus ?? booking.status ?? 'UNKNOWN').toUpperCase();

  const partnerUserId = booking?.assignedPartner?.userId || booking?.partner?.userId || booking?.acceptedPartner?.id;
  const partnerPhone = booking?.assignedPartner?.phone || booking?.partner?.phone || booking?.acceptedBy?.phone;
  const callSig = useCallSignaling();
  const onSos = () => {
    if (!id) return;
    emitSos(id);
    RNAlert.alert('SOS sent', 'Your emergency has been shared with your partner and our safety team.');
  };

  return (
    <Screen>
      <Title>Booking</Title>
      <Text style={styles.sub}>{booking.serviceType ?? 'Service'} · #{String(id).slice(0, 8)}</Text>

      <Card>
        <Text style={styles.label}>Status</Text>
        <Text style={[styles.value, { color: statusColor(status) }]}>{status}</Text>
        <Text style={styles.label}>From</Text>
        <Text style={styles.value}>{booking.startLocation ?? '—'}</Text>
        <Text style={styles.label}>To</Text>
        <Text style={styles.value}>{booking.endLocation ?? '—'}</Text>
        <Text style={styles.label}>Scheduled</Text>
        <Text style={styles.value}>{booking.scheduledAt ? new Date(booking.scheduledAt).toLocaleString('en-IN') : '—'}</Text>
        {booking.amount != null ? (
          <>
            <Text style={styles.label}>Amount</Text>
            <Text style={styles.value}>₹{Number(booking.amount).toFixed(2)}</Text>
          </>
        ) : null}
      </Card>

      {isLoading ? <Text style={styles.sub}>Loading…</Text> : null}

      <View style={styles.actions}>
        {status === 'PENDING' || status === 'AWAITING_ACCEPTANCE' ? (
          <Button label="Accept job" onPress={() => act.mutate('accept')} loading={act.isPending} />
        ) : null}
        {status === 'ACCEPTED' ? (
          <Button label="Start" onPress={() => act.mutate('start')} loading={act.isPending} />
        ) : null}
        {status === 'AWAITING_PAYMENT' || status === 'PENDING_PAYMENT' || status === 'PAYMENT_PENDING' ? (
          booking.paymentMethod === 'UPI_MANUAL' ? (
            <Button label="Pay via UPI QR" onPress={() => router.push(`/upi/${id}`)} />
          ) : (
            <Button label="Pay (Razorpay/Wallet)" onPress={startPay} loading={paying} />
          )
        ) : null}
        {status === 'COMPLETED' ? (
          <Button label="Confirm cash payment" variant="ghost" onPress={() => act.mutate('confirm-cash')} loading={act.isPending} />
        ) : null}
      </View>

      <View style={styles.actions}>
        <Button label="Live tracking" variant="ghost" onPress={() => router.push(`/tracking/${id}`)} />
        <Button label="Call partner" variant="ghost" onPress={() => { callPartner(); if (partnerUserId) callSig.call(partnerUserId, 'VOICE'); }} />
        <Button label="Message" variant="ghost" onPress={() => router.push('/(tabs)/messages')} />
      </View>

      <Pressable style={styles.sos} onPress={onSos}>
        <Text style={styles.sosText}>SOS · Emergency</Text>
      </Pressable>

      <CallModal
        session={callSig.session}
        peerName={booking?.assignedPartner?.name || partnerPhone || 'Partner'}
        onAccept={() => { callSig.accept(); if (partnerPhone) Linking.openURL(`tel:${partnerPhone}`); }}
        onReject={callSig.reject}
        onEnd={callSig.end}
      />

      <Alert message="Live GPS tracking is shared with your partner during an active booking." tone="info" />
      {error ? <Alert message={error} tone="error" /> : null}
    </Screen>
  );
}

function statusColor(status: string) {
  switch (status) {
    case 'COMPLETED':
    case 'CONFIRMED':
      return Colors.success;
    case 'CANCELLED':
    case 'REFUNDED':
    case 'EXPIRED':
      return Colors.error;
    default:
      return Colors.warning;
  }
}

const styles = StyleSheet.create({
  sub: { fontSize: 14, color: Colors.onSurfaceVariant, marginBottom: 16 },
  label: { color: Colors.onSurfaceVariant, fontSize: 12, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { color: Colors.onSurfaceDark, fontSize: 15, fontWeight: '600' },
  actions: { gap: 10, marginTop: 16 },
  sos: {
    marginTop: 14,
    backgroundColor: Colors.error,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sosText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
});
