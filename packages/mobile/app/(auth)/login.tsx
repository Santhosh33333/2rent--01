import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen, Title, Subtitle, Button, TextField, Alert } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { post, errorMessage } from '../../src/lib/api';
import { tokenStore } from '../../src/lib/storage';
import { useAuthStore, AuthUser } from '../../src/shared/store/authStore';

export default function Login() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const accountType = (params.type as string) ?? 'USER';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setUser = useAuthStore((s) => s.setUser);

  const submit = async () => {
    setError('');
    if (!email || !password) {
      setError('Email and password are required.');
      return;
    }
    setLoading(true);
    try {
      const res = await post<{ accessToken: string; refreshToken: string; user: any }>('/auth/login', {
        email,
        password,
      });
      if (!res.success || !res.data?.accessToken) {
        setError(res.message ?? 'Login failed.');
        return;
      }
      tokenStore.setTokens(res.data.accessToken, res.data.refreshToken);
      const u = res.data.user;
      const mapped: AuthUser = {
        id: u.id,
        firebaseUid: u.firebaseUid ?? '',
        email: u.email ?? email,
        phone: u.phone ?? '',
        fullName: u.fullName ?? '',
        displayName: u.displayName ?? null,
        avatarUrl: u.avatarUrl ?? null,
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
      setError(errorMessage(err, 'Login failed.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title>Sign in</Title>
      <Subtitle>{accountType === 'PARTNER' ? 'Partner login' : 'User login'}</Subtitle>
      {error ? <Alert message={error} /> : null}

      <TextField placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <TextField placeholder="Password" value={password} onChangeText={setPassword} secure />

      <Button label="Sign in" onPress={submit} loading={loading} />

      <TouchableOpacity style={styles.row} onPress={() => router.push({ pathname: '/(auth)/signup', params: { type: accountType } })}>
        <Text style={styles.link}>New here? Create an account</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.row} onPress={() => router.push({ pathname: '/(auth)/otp', params: { type: accountType } })}>
        <Text style={styles.link}>Use phone OTP instead</Text>
      </TouchableOpacity>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { marginTop: 14, alignItems: 'center' },
  link: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
});
