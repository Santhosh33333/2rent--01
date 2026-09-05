import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen, Title, Card, Button, Alert } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { get, post } from '../../src/lib/api';
import { tokenStore } from '../../src/lib/storage';
import { useAuthStore } from '../../src/shared/store/authStore';

export default function Profile() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const { data } = useQuery({ queryKey: ['profile'], queryFn: () => get('/users/profile') });
  const profile = (data?.data ?? user ?? {}) as any;

  const doLogout = async () => {
    try {
      await post('/auth/logout', {});
    } catch {
      // ignore — local clear is authoritative
    }
    tokenStore.clear();
    logout();
    router.replace('/(auth)/account-type');
  };

  return (
    <Screen>
      <Title>Profile</Title>
      <Card>
        <Text style={styles.name}>{profile.fullName ?? user?.fullName ?? '—'}</Text>
        <Text style={styles.meta}>{profile.email ?? user?.email ?? ''}</Text>
        <Text style={styles.meta}>Role: {profile.activeRole ?? user?.activeRole ?? 'USER'}</Text>
        <Text style={styles.meta}>KYC: {profile.kycStatus ?? user?.kycStatus ?? 'UNVERIFIED'}</Text>
        <Text style={styles.meta}>Phone: {profile.phone ?? user?.phone ?? '—'}</Text>
      </Card>

      <Alert message="Complete KYC to unlock bookings and partner features." tone="info" />

      <Button label="Wallet" onPress={() => router.push('/(tabs)/wallet')} />
      <Button label="Verify KYC" onPress={() => router.push('/kyc')} />
      <Button label="Log out" variant="ghost" onPress={doLogout} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { color: Colors.onSurfaceDark, fontWeight: '800', fontSize: 20 },
  meta: { color: Colors.onSurfaceVariant, fontSize: 14, marginTop: 4 },
});
