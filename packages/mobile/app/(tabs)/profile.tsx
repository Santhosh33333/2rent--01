import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Share, Alert as RNAlert, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Title, Card, Button, Alert } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { get, post, upload, mediaUrl, errorMessage } from '../../src/lib/api';
import { tokenStore } from '../../src/lib/storage';
import { useAuthStore } from '../../src/shared/store/authStore';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // backend MAX_FILE_SIZE

export default function Profile() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const queryClient = useQueryClient();
  const [photoBusy, setPhotoBusy] = React.useState(false);
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

  // Shares the ['notifications'] cache with the inbox screen and is invalidated
  // by the realtime banner when a row lands, so the badge stays live.
  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => get('/notifications', { page: 1, limit: 1 }),
  });
  const unreadCount = Number((notifData?.data as any)?.unreadCount ?? 0);

  const avatarUrl = profile.avatarUrl ?? user?.avatarUrl ?? null;

  const uploadPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: true,
      });
      if (result.canceled || !result.assets[0]) return;
      const a = result.assets[0];
      if (a.fileSize && a.fileSize > MAX_PHOTO_BYTES) {
        RNAlert.alert('Photo too large', 'Profile photos are limited to 5 MB.');
        return;
      }
      const extMatch = a.uri.match(/\.([a-zA-Z0-9]+)(\?|$)/);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
      setPhotoBusy(true);
      const env = await upload('/users/profile-photo', 'photo', {
        uri: a.uri,
        name: a.fileName ?? `avatar_${Date.now()}.${ext}`,
        type: a.mimeType ?? (ext === 'png' ? 'image/png' : 'image/jpeg'),
        size: a.fileSize,
      });
      if (!env.success) throw new Error(env.message || 'Upload failed');
      const newAvatar = env.data?.avatarUrl as string | undefined;
      if (newAvatar) updateUser({ avatarUrl: newAvatar });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    } catch (e) {
      RNAlert.alert('Upload failed', errorMessage(e, 'Could not upload the photo.'));
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Profile</Title>
      <Card>
        <View style={styles.avatarRow}>
          {avatarUrl ? (
            <Image source={{ uri: mediaUrl(avatarUrl) }} style={styles.avatarImage} contentFit="cover" />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitial}>{(profile.fullName ?? user?.fullName ?? '?').trim().charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.avatarText}>
            <Text style={styles.name}>{profile.fullName ?? user?.fullName ?? '—'}</Text>
            <Text style={styles.meta}>{profile.email ?? user?.email ?? ''}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.photoBtn} onPress={uploadPhoto} disabled={photoBusy}>
          {photoBusy ? (
            <ActivityIndicator color={Colors.primary} size="small" />
          ) : (
            <Text style={styles.photoBtnText}>{avatarUrl ? 'Change photo' : 'Add a profile photo'}</Text>
          )}
        </TouchableOpacity>
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
      <Button
        label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        onPress={() => router.push('/notifications')}
      />
      <Button label="Verify KYC" onPress={() => router.push('/kyc')} />
      <Button label="Log out" variant="ghost" onPress={doLogout} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { color: Colors.onSurfaceDark, fontWeight: '800', fontSize: 20 },
  meta: { color: Colors.onSurfaceVariant, fontSize: 14, marginTop: 4 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  avatarText: { flex: 1 },
  avatarImage: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.primary },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: Colors.onPrimary, fontWeight: '800', fontSize: 26 },
  photoBtn: {
    alignSelf: 'flex-start',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '22',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 12,
  },
  photoBtnText: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
  referralTitle: { color: Colors.onSurfaceVariant, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  referralCode: {
    color: Colors.onSurfaceDark,
    fontWeight: '800',
    fontSize: 24,
    marginTop: 4,
    letterSpacing: 2,
  },
});
