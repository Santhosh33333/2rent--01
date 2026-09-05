import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Title, Card } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { get } from '../../src/lib/api';

export default function Explore() {
  const { data, isLoading } = useQuery({
    queryKey: ['discovery-people'],
    queryFn: () => get('/discovery/people'),
  });

  const people = (data?.data?.people ?? data?.data ?? []) as any[];

  return (
    <Screen>
      <Title>Explore</Title>
      <Text style={styles.sub}>People and partners near you.</Text>
      {isLoading ? <Text style={styles.sub}>Loading…</Text> : null}
      <FlatList
        data={people}
        keyExtractor={(item) => item.id ?? Math.random().toString()}
        renderItem={({ item }) => (
          <Card>
            <Text style={styles.name}>{item.fullName ?? item.name ?? 'Member'}</Text>
            <Text style={styles.meta}>
              {[item.city, item.activeRole ?? item.role].filter(Boolean).join(' · ')}
            </Text>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.sub}>No members found yet.</Text>}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { fontSize: 14, color: Colors.onSurfaceVariant, marginBottom: 16 },
  name: { color: Colors.onSurfaceDark, fontWeight: '700', fontSize: 16 },
  meta: { color: Colors.onSurfaceVariant, fontSize: 13, marginTop: 2 },
});
