import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen, Title, Card, Button, Alert } from '../src/lib/ui';
import { Colors } from '../src/design-system/tokens/colors';
import { get, post, errorMessage } from '../src/lib/api';

export default function Kyc() {
  const qc = useQueryClient();
  const [aadhaar, setAadhaar] = useState('');
  const [pan, setPan] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const statusQ = useQuery({ queryKey: ['kyc-status'], queryFn: () => get<any>('/verification/status') });
  const status = (statusQ.data?.data?.status ?? 'UNVERIFIED') as string;

  const submit = useMutation({
    mutationFn: () =>
      post<any>('/verification/submit', {
        documents: [
          { docType: 'AADHAAR', docNumber: aadhaar },
          { docType: 'PAN', docNumber: pan },
        ],
        selfieRequired: true,
      }),
    onSuccess: () => {
      setDone('Submitted for verification. We will notify you once approved.');
      setError(null);
      qc.invalidateQueries({ queryKey: ['kyc-status'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const selfie = useMutation({
    mutationFn: () => post<any>('/verification/selfie', {}),
    onSuccess: () => setDone('Selfie captured.'),
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Screen>
      <Title>KYC Verification</Title>
      <Text style={styles.sub}>Status: {status}</Text>

      <Card>
        <Text style={styles.label}>Aadhaar number</Text>
        <TextInput
          style={styles.input}
          value={aadhaar}
          onChangeText={setAadhaar}
          placeholder="XXXX XXXX XXXX"
          placeholderTextColor={Colors.outline}
          keyboardType="numeric"
        />
        <Text style={styles.label}>PAN number</Text>
        <TextInput
          style={styles.input}
          value={pan}
          onChangeText={setPan}
          placeholder="ABCDE1234F"
          placeholderTextColor={Colors.outline}
          autoCapitalize="characters"
        />
      </Card>

      <Button label="Submit documents" onPress={() => submit.mutate()} loading={submit.isPending} />
      <Button label="Capture selfie" variant="ghost" onPress={() => selfie.mutate()} loading={selfie.isPending} />

      {done ? <Alert message={done} tone="success" /> : null}
      {error ? <Alert message={error} tone="error" /> : null}
      {status !== 'VERIFIED' ? <Alert message="Verification is required to create bookings and earn as a partner." tone="info" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { fontSize: 14, color: Colors.onSurfaceVariant, marginBottom: 16 },
  label: { color: Colors.onSurfaceVariant, fontSize: 12, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: Colors.surfaceDark,
    color: Colors.onSurfaceDark,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
    fontSize: 15,
  },
});
