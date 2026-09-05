import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useAuthStore } from '../src/shared/store/authStore';

export default function Index() {
  const router = useRouter();
  const segments = useSegments();
  const { isAuthenticated, isLoading } = useAuthStore();

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      router.replace('/(tabs)');
    } else {
      router.replace('/(auth)/account-type');
    }
  }, [isLoading, isAuthenticated]);

  return (
    <View style={{ flex: 1, backgroundColor: '#0F0F0F', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#6750A4" size="large" />
    </View>
  );
}
