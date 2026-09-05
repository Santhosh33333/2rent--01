import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen, Title, Subtitle, Button, TextField, Alert } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { post, errorMessage } from '../../src/lib/api';
import { tokenStore } from '../../src/lib/storage';
import { useAuthStore, AuthUser } from '../../src/shared/store/authStore';

export default function Signup() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const accountType = (params.type as string) ?? 'USER';
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | 'OTHER'>('MALE');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const setUser = useAuthStore((s) => s.setUser);

  const submit = async () => {
    setError('');
    if (!fullName || !email || !phone || !password || !dob) {
      setError('All fields are required.');
      return;
    }
    setLoading(true);
    try {
      const res = await post<{ accessToken?: string; refreshToken?: string; user?: any }>('/auth/register', {
        fullName,
        email,
        phone,
        password,
        dateOfBirth: dob,
        gender,
      });
      if (!res.success) {
        setError(res.message ?? 'Registration failed.');
        return;
      }
      const u = res.data?.user;
      if (res.data?.accessToken && u) {
        tokenStore.setTokens(res.data.accessToken, res.data.refreshToken);
        const mapped: AuthUser = {
          id: u.id,
          firebaseUid: u.firebaseUid ?? '',
          email: u.email ?? email,
          phone: u.phone ?? phone,
          fullName: u.fullName ?? fullName,
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
        return;
      }
      // No token yet — email/phone verification step (dev OTP is logged server-side).
      if (u?.id) {
        setInfo('Account created. Verify your email — check the server console for the dev OTP.');
        router.push({ pathname: '/(auth)/otp', params: { mode: 'verify', userId: u.id, type: accountType } });
      } else {
        setInfo('Account created. You can now sign in.');
        router.replace({ pathname: '/(auth)/login', params: { type: accountType } });
      }
    } catch (err) {
      setError(errorMessage(err, 'Registration failed.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title>Create your account</Title>
      <Subtitle>{accountType === 'PARTNER' ? 'Become a partner' : 'Join as a user'}</Subtitle>
      {error ? <Alert message={error} /> : null}
      {info ? <Alert message={info} tone="success" /> : null}

      <TextField placeholder="Full name" value={fullName} onChangeText={setFullName} />
      <TextField placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <TextField placeholder="Phone (+91...)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <TextField placeholder="Password (min 8 chars)" value={password} onChangeText={setPassword} secure />
      <TextField placeholder="Date of birth (YYYY-MM-DD)" value={dob} onChangeText={setDob} />
      <View style={styles.genderRow}>
        {(['MALE', 'FEMALE', 'OTHER'] as const).map((g) => (
          <TouchableOpacity
            key={g}
            style={[styles.genderBtn, gender === g && styles.genderActive]}
            onPress={() => setGender(g)}
          >
            <Text style={[styles.genderText, gender === g && styles.genderTextActive]}>{g}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Button label="Create account" onPress={submit} loading={loading} />
      <TouchableOpacity style={styles.row} onPress={() => router.push({ pathname: '/(auth)/login', params: { type: accountType } })}>
        <Text style={styles.link}>Already have an account? Sign in</Text>
      </TouchableOpacity>
    </Screen>
  );
}

const styles = StyleSheet.create({
  genderRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  genderBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    alignItems: 'center',
    backgroundColor: Colors.surfaceDark,
  },
  genderActive: { borderColor: Colors.primary, backgroundColor: 'rgba(103,80,164,0.25)' },
  genderText: { color: Colors.onSurfaceVariant, fontWeight: '600' },
  genderTextActive: { color: Colors.onSurfaceDark },
  row: { marginTop: 14, alignItems: 'center' },
  link: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
});
