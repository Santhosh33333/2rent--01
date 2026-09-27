import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Title, Card } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { get, toList } from '../../src/lib/api';

function money(n?: number) {
  if (n == null || !Number.isFinite(Number(n))) return '₹0.00';
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Wallet() {
  const walletQ = useQuery({ queryKey: ['wallet'], queryFn: () => get<any>('/wallet') });
  const txQ = useQuery({ queryKey: ['wallet-tx'], queryFn: () => get<any>('/wallet/transactions') });

  const wallet = (walletQ.data?.data ?? {}) as any;
  const txns = toList(txQ.data?.data, 'transactions');
  // `GET /wallet` returns a computed `withdrawable`. Fall back to the balance
  // rather than rendering "₹NaN" if an older deployment omits it.
  const balance = Number(wallet.balance);
  const withdrawable = Number.isFinite(Number(wallet.withdrawable))
    ? Number(wallet.withdrawable)
    : balance;

  return (
    <Screen>
      <Title>Wallet</Title>
      <Card>
        <Text style={styles.label}>Balance</Text>
        <Text style={styles.balance}>{money(balance)}</Text>
        <Text style={styles.label}>Withdrawable</Text>
        <Text style={styles.value}>{money(withdrawable)}</Text>
      </Card>

      <Text style={styles.section}>Transactions</Text>
      {txQ.isLoading ? <Text style={styles.sub}>Loading…</Text> : null}
      <FlatList
        data={txns}
        keyExtractor={(t, index) => t.id ?? `w-${index}`}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.row}>
              <Text style={styles.type}>{item.type ?? 'TXN'}</Text>
              <Text style={[styles.amt, item.amount >= 0 ? { color: Colors.success } : { color: Colors.error }]}>
                {money(Number(item.amount))}
              </Text>
            </View>
            <Text style={styles.meta}>{item.description ?? ''}</Text>
            <Text style={styles.meta}>{item.createdAt ? new Date(item.createdAt).toLocaleString('en-IN') : ''}</Text>
          </Card>
        )}
        ListEmptyComponent={<Text style={styles.sub}>No transactions yet.</Text>}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { color: Colors.onSurfaceVariant, fontSize: 12, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  balance: { color: Colors.onSurfaceDark, fontSize: 30, fontWeight: '800' },
  value: { color: Colors.onSurfaceDark, fontSize: 16, fontWeight: '700' },
  section: { color: Colors.onSurfaceDark, fontWeight: '800', fontSize: 18, marginVertical: 12 },
  sub: { fontSize: 14, color: Colors.onSurfaceVariant, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  type: { color: Colors.onSurfaceDark, fontWeight: '700', fontSize: 15 },
  amt: { fontSize: 15, fontWeight: '800' },
  meta: { color: Colors.onSurfaceVariant, fontSize: 13, marginTop: 4 },
});
