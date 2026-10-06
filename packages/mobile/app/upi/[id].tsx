import { View, Text, StyleSheet, TextInput } from 'react-native';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'react-native-qrcode-svg';
import { Screen, Title, Card, Button, Alert } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { get, post, errorMessage } from '../../src/lib/api';

export default function UpiPay() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['upi-details', id],
    queryFn: () => get<any>(`/bookings/${id}/upi-details`),
    enabled: !!id,
    retry: 1,
  });
  const d = (data?.data ?? {}) as any;

  const submit = useMutation({
    mutationFn: (ref: string) => post<any>(`/bookings/${id}/upi-reference`, { referenceNumber: ref }),
    onSuccess: () => {
      setDone(true);
      setError(null);
      qc.invalidateQueries({ queryKey: ['booking', id] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  // The server mints the intent URI and rotates its transaction reference every
  // hour; that reference is what an admin matches a bank line against, so the
  // QR must encode the server's URI. Building a second URI here produced a QR
  // paying with no `tr` at all, which could never be tied to this hour's bucket.
  // The local build is kept only for an older backend that sends no upiUri.
  const upiLink = d.upiUri
    || (d.upiId
      ? `upi://pay?pa=${encodeURIComponent(d.upiId)}&pn=${encodeURIComponent(d.accountName || 'RentBuddy')}&am=${d.amount}&tn=${encodeURIComponent(d.referenceNote || id)}`
      : '');

  return (
    <Screen>
      <Title>Pay via UPI</Title>
      <Text style={styles.sub}>
        Scan the QR with any UPI app, pay exactly ₹{Number(d.amount ?? 0).toFixed(2)}, then paste the UTR/reference below. An admin verifies it before the booking is confirmed.
      </Text>

      {isLoading ? <Text style={styles.sub}>Loading…</Text> : null}
      {isError ? (
        // Without this the page showed "Loading…" forever and then an empty QR
        // card, so a failed fetch was indistinguishable from an unconfigured
        // admin. A retry matters most here: most failures are a stale token or
        // a dropped connection, and the payment is still waiting to be made.
        <Card>
          <Text style={styles.sub}>Could not load the payment QR.</Text>
          <Button label="Retry" onPress={() => { void refetch(); }} />
        </Card>
      ) : null}
      {error ? <Alert message={error} tone="error" /> : null}
      {done ? <Alert message="Reference submitted. Awaiting admin verification." tone="success" /> : null}

      <Card style={styles.qrCard}>
        {d.upiId ? (
          <View style={styles.qrWrap}>
            <QRCode value={upiLink || d.upiId} size={180} />
            <Text style={styles.upiId}>{d.upiId}</Text>
            <Text style={styles.sub}>{d.accountName}</Text>
          </View>
        ) : (
          <Text style={styles.sub}>UPI not configured by admin yet.</Text>
        )}
      </Card>

      <Card>
        <Text style={styles.label}>Amount</Text>
        <Text style={styles.value}>₹{Number(d.amount ?? 0).toFixed(2)}</Text>
        <Text style={styles.label}>Note / Reference tag</Text>
        <Text style={styles.value}>{d.referenceNote}</Text>
        {d.qrReference ? (
          <>
            <Text style={styles.label}>Reference inside this QR</Text>
            <Text style={styles.value}>{d.qrReference}</Text>
          </>
        ) : null}
      </Card>

      <TextInput
        style={styles.input}
        placeholder="UTR / Reference number"
        value={reference}
        onChangeText={setReference}
        autoCapitalize="characters"
      />

      <Button
        label="Submit reference"
        onPress={() => submit.mutate(reference)}
        loading={submit.isPending}
        disabled={done || !reference}
      />
      <Button label="Back to bookings" variant="ghost" onPress={() => router.replace('/(tabs)/bookings')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { fontSize: 13, color: Colors.onSurfaceVariant, marginBottom: 12 },
  qrCard: { alignItems: 'center', marginBottom: 12 },
  qrWrap: { alignItems: 'center', padding: 8 },
  upiId: { fontSize: 16, fontWeight: '700', color: Colors.onSurfaceDark, marginTop: 10 },
  label: { color: Colors.onSurfaceVariant, fontSize: 12, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { color: Colors.onSurfaceDark, fontSize: 15, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: 12,
    padding: 12,
    color: Colors.onSurfaceDark,
    backgroundColor: Colors.surfaceDark,
    marginTop: 12,
  },
});
