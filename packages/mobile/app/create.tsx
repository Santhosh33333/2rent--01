import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen, Title, Subtitle, Button, TextField, Alert } from '../src/lib/ui';
import { Colors } from '../src/design-system/tokens/colors';
import { post, errorMessage } from '../src/lib/api';

const SERVICE_OPTIONS = [
  'WALKING_BUDDY',
  'CARRY_BUDDY',
  'MOVIE_PARTNER',
  'TRAVEL_BUDDY',
  'FITNESS_PARTNER',
  'GAMING_PARTNER',
  'STUDY_PARTNER',
  'FOOD_COFFEE_PARTNER',
  'EVENT_PARTNER',
  'LANGUAGE_PARTNER',
  'HOBBY_PARTNER',
  'NETWORKING_PARTNER',
  'SHOPPING_PARTNER',
];

export default function CreateRequest() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [serviceType, setServiceType] = useState((params.serviceType as string) ?? SERVICE_OPTIONS[0]);
  const [startLocation, setStart] = useState('');
  const [endLocation, setEnd] = useState('');
  const [scheduledAt, setScheduled] = useState('');
  const [durationMode, setDurationMode] = useState<'HOURS' | 'DAYS'>('HOURS');
  const [durationValue, setDurationValue] = useState('1');
  const durationMinutes =
    durationMode === 'HOURS'
      ? Math.round(Number(durationValue) * 60)
      : Math.round(Number(durationValue) * 24 * 60);
  const [paymentMethod, setPaymentMethod] = useState<'ONLINE' | 'UPI_MANUAL' | 'CASH'>('ONLINE');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const PAYMENT_OPTIONS: { key: 'ONLINE' | 'UPI_MANUAL' | 'CASH'; label: string }[] = [
    { key: 'ONLINE', label: 'Wallet' },
    { key: 'UPI_MANUAL', label: 'UPI QR' },
    { key: 'CASH', label: 'Cash' },
  ];

  const submit = async () => {
    setError('');
    setInfo('');
    if (!startLocation || !endLocation || !scheduledAt) {
      setError('Start, destination and date/time are required.');
      return;
    }
    setLoading(true);
    try {
      const res = await post('/bookings', {
        serviceType,
        startLocation,
        endLocation,
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: durationMinutes || undefined,
        notes: JSON.stringify({ paymentMethod }),
      });
      if (!res.success) {
        setError(res.message ?? 'Could not create request.');
        return;
      }
      setInfo('Request created. Finding eligible partners…');
      router.replace('/(tabs)/bookings');
    } catch (err) {
      const msg = errorMessage(err, 'Could not create request.');
      if (msg.toLowerCase().includes('kyc')) {
        setError('KYC verification required before creating a booking. Complete KYC in your profile.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title>New request</Title>
      <Subtitle>Choose a service and where you need it.</Subtitle>
      {error ? <Alert message={error} /> : null}
      {info ? <Alert message={info} tone="success" /> : null}

      <Text style={styles.label}>Service</Text>
      <View style={styles.chips}>
        {SERVICE_OPTIONS.map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.chip, serviceType === s && styles.chipActive]}
            onPress={() => setServiceType(s)}
          >
            <Text style={[styles.chipText, serviceType === s && styles.chipTextActive]}>{s.replace('_PARTNER', '').replace('_', ' ')}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TextField placeholder="Start location" value={startLocation} onChangeText={setStart} />
      <TextField placeholder="Destination" value={endLocation} onChangeText={setEnd} />
      <TextField placeholder="Date/time (YYYY-MM-DD HH:mm)" value={scheduledAt} onChangeText={setScheduled} />

      <Text style={styles.label}>Duration</Text>
      <View style={styles.chips}>
        {(['HOURS', 'DAYS'] as const).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.chip, durationMode === m && styles.chipActive]}
            onPress={() => setDurationMode(m)}
          >
            <Text style={[styles.chipText, durationMode === m && styles.chipTextActive]}>
              {m === 'HOURS' ? 'Hours' : 'Days'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.chips}>
        {(durationMode === 'HOURS' ? [1, 2, 3, 4, 6, 8, 12, 24] : [1, 2, 3, 5, 7]).map((v) => (
          <TouchableOpacity
            key={v}
            style={[styles.chip, Number(durationValue) === v && styles.chipActive]}
            onPress={() => setDurationValue(String(v))}
          >
            <Text style={[styles.chipText, Number(durationValue) === v && styles.chipTextActive]}>
              {v}
              {durationMode === 'HOURS' ? 'h' : 'd'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextField
        placeholder={`Custom duration (${durationMode === 'HOURS' ? 'hours' : 'days'})`}
        value={durationValue}
        onChangeText={setDurationValue}
        keyboardType="number-pad"
      />

      <Text style={styles.label}>Payment method</Text>
      <View style={styles.chips}>
        {PAYMENT_OPTIONS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.chip, paymentMethod === p.key && styles.chipActive]}
            onPress={() => setPaymentMethod(p.key)}
          >
            <Text style={[styles.chipText, paymentMethod === p.key && styles.chipTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Button label="Create request" onPress={submit} loading={loading} />
      <TouchableOpacity style={styles.row} onPress={() => router.back()}>
        <Text style={styles.link}>Cancel</Text>
      </TouchableOpacity>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { color: Colors.onSurfaceVariant, fontSize: 13, marginBottom: 8, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceDark,
  },
  chipActive: { borderColor: Colors.primary, backgroundColor: 'rgba(103,80,164,0.25)' },
  chipText: { color: Colors.onSurfaceVariant, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: Colors.onSurfaceDark },
  row: { marginTop: 14, alignItems: 'center' },
  link: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
});
