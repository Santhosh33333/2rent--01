import { View, Text, TouchableOpacity, StyleSheet, Share } from 'react-native';
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

  // Own code plus whether this account already redeemed somebody else's. The
  // APK had no surface for either, so a mobile user could not see their own
  // code and therefore could never originate a referral.
  const { data: referralData } = useQuery({
    queryKey: ['referral-profile'],
    queryFn: () => get('/referrals/me'),
  });
  const referral = (referralData?.data ?? null) as
    | { code?: string; referredByCode?: string | null }
    | null;

  const shareCode = async () => {
    const code = referral?.code;
    if (!code) return;
    try {
      await Share.share({
        title: 'Join me on Nabri',
        message:
          `Join me on Nabri — people nearby for walks, events, dating and more. ` +
          `Use my code ${code} when you sign up: ` +
          `https://2rent-01.vercel.app/register?ref=${code}`,
      });
    } catch {
      // Dismissed, or no share sheet available on this device.
    }
  };

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

      {referral?.code && (
        <Card>
          <Text style={styles.referralTitle}>Your invite code</Text>
          <Text style={styles.referralCode}>{referral.code}</Text>
          <Text style={styles.meta}>Rewards unlock after their first completed booking.</Text>
          {referral.referredByCode ? (
            <Text style={styles.meta}>You joined with code {referral.referredByCode}</Text>
          ) : null}
          <Button label="Share your code" onPress={shareCode} />
        </Card>
      )}

      <Button label="Wallet" onPress={() => router.push('/(tabs)/wallet')} />
      <Button label="Verify KYC" onPress={() => router.push('/kyc')} />
      <Button label="Log out" variant="ghost" onPress={doLogout} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { color: Colors.onSurfaceDark, fontWeight: '800', fontSize: 20 },
  meta: { color: Colors.onSurfaceVariant, fontSize: 14, marginTop: 4 },
  referralTitle: { color: Colors.onSurfaceVariant, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  referralCode: {
    color: Colors.onSurfaceDark,
    fontWeight: '800',
    fontSize: 24,
    marginTop: 4,
    letterSpacing: 2,
  },
});
