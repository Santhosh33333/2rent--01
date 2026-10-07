import { Stack } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../src/lib/queryClient';
import { useSosAlerts } from '../src/hooks/useSosAlerts';
import { RealtimeNotifications } from '../src/components/RealtimeNotifications';

export default function RootLayout() {
  // Root-level on purpose: an SOS has to surface whichever screen is showing,
  // including none of them.
  useSosAlerts();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Live banner for socket notifications (feed likes/comments/gifts, SOS
          rows, booking alerts): it must overlay whichever screen is open. */}
      <RealtimeNotifications>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0F0F0F' },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="create" />
          <Stack.Screen name="post/new" />
          <Stack.Screen name="post/[id]" />
          <Stack.Screen name="notifications" />
        </Stack>
      </RealtimeNotifications>
    </QueryClientProvider>
  );
}
