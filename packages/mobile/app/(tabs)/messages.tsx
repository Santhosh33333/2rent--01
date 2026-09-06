import { Text, FlatList, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen, Title, Card } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { get } from '../../src/lib/api';
import { useAuthStore } from '../../src/shared/store/authStore';

export default function Messages() {
  const router = useRouter();
  const meId = useAuthStore((s) => s.user?.id);
  const { data, isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => get<any>('/messages/conversations'),
  });

  const convos = (data?.data?.conversations ?? data?.data ?? []) as any[];

  const otherName = (c: any) => {
    const others = (c.participants ?? []).filter((p: any) => p.id !== meId);
    const o = others[0];
    return o?.fullName || o?.phone || 'Chat';
  };

  return (
    <Screen>
      <Title>Messages</Title>
      <FlatList
        data={convos}
        keyExtractor={(c, index) => c.id ?? `m-${index}`}
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/chat/${item.id}`)}>
            <Text style={styles.name}>{otherName(item)}</Text>
            <Text style={styles.last} numberOfLines={1}>
              {item.lastMessage?.content ?? 'No messages yet'}
            </Text>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading…' : 'No conversations yet.'}</Text>}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { color: Colors.onSurfaceDark, fontWeight: '700', fontSize: 15 },
  last: { color: Colors.onSurfaceVariant, fontSize: 13, marginTop: 4 },
  empty: { color: Colors.onSurfaceVariant, fontSize: 14, marginTop: 8 },
});
