import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen, Title, Subtitle, Button, TextField, Alert } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { post, errorMessage } from '../../src/lib/api';
import { tokenStore } from '../../src/lib/storage';
import { useAuthStore, AuthUser } from '../../src/shared/store/authStore';

export default function Otp() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const mode = (params.mode as string) ?? 'phone';
  const userId = (params.userId as string) ?? '';
  const accountType = (params.type as string) ?? 'USER';

  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const setUser = useAuthStore((s) => s.setUser);

  const send = async () => {
    setError('');
    if (!phone) {
      setError('Phone number is required.');
      return;
    }
    setLoading(true);
    try {
      const res = await post('/auth/phone/send-otp', { phone });
      if (!res.success) {
        setError(res.message ?? 'Could not send OTP.');
        return;
      }
      setSent(true);
      setInfo('OTP sent. In dev mode the code is logged on the server console.');
    } catch (err) {
      setError(errorMessage(err, 'Could not send OTP.'));
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setError('');
    if (!otp) {
      setError('Enter the OTP.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'verify') {
        const res = await post('/auth/verify-email', { userId, otp });
        if (!res.success) {
          setError(res.message ?? 'Invalid OTP.');
          return;
        }
        setInfo('Email verified. You can sign in.');
        router.replace({ pathname: '/(auth)/login', params: { type: accountType } });
        return;
      }
      const res = await post<{ accessToken: string; refreshToken: string; user: any }>('/auth/phone/verify-otp', {
        phone,
        otp,
      });
      if (!res.success || !res.data?.accessToken) {
        setError(res.message ?? 'Invalid OTP.');
        return;
      }
      tokenStore.setTokens(res.data.accessToken, res.data.refreshToken);
      const u = res.data.user;
      const mapped: AuthUser = {
        id: u.id,
        firebaseUid: u.firebaseUid ?? '',
        email: u.email ?? '',
        phone: u.phone ?? phone,
        fullName: u.fullName ?? '',
        displayName: null,
        avatarUrl: null,
        role: u.role ?? accountType,
        activeRole: u.activeRole ?? u.role ?? accountType,
        kycStatus: u.kycStatus ?? 'UNVERIFIED',
        trustScore: u.trustScore ?? 0,
        status: u.status ?? 'ACTIVE',
        city: u.city ?? null,
        language: u.language ?? 'en',
        emailVerified: u.emailVerified ?? false,
        phoneVerified: u.phoneVerified ?? false,
      };
      setUser(mapped);
      router.replace('/(tabs)');
    } catch (err) {
      setError(errorMessage(err, 'Invalid OTP.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title>{mode === 'verify' ? 'Verify email' : 'Phone sign-in'}</Title>
      <Subtitle>{mode === 'verify' ? 'Enter the OTP sent to your email.' : 'We’ll send a one-time code to your phone.'}</Subtitle>
      {error ? <Alert message={error} /> : null}
      {info ? <Alert message={info} tone="success" /> : null}

      {!sent ? (
        <>
          <TextField placeholder="Phone (+91...)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Button label="Send OTP" onPress={send} loading={loading} />
        </>
      ) : (
        <>
          <TextField placeholder="6-digit OTP" value={otp} onChangeText={setOtp} keyboardType="number-pad" />
          <Button label="Verify & continue" onPress={verify} loading={loading} />
        </>
      )}

      <TouchableOpacity style={styles.row} onPress={() => router.back()}>
        <Text style={styles.link}>Back</Text>
      </TouchableOpacity>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { marginTop: 14, alignItems: 'center' },
  link: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
});
