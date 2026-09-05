import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Title, Subtitle, Card } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';

export default function AccountType() {
  const router = useRouter();
  const go = (type: 'USER' | 'PARTNER') =>
    router.push({ pathname: '/(auth)/login', params: { type } });

  return (
    <Screen>
      <Title>How do you want to use RentBuddy?</Title>
      <Subtitle>Choose your account type. You can switch later if your account allows it.</Subtitle>

      <Card onPress={() => go('USER')}>
        <Text style={styles.h}>👤 I&apos;m a User</Text>
        <Text style={styles.p}>Book services, discover local help, and manage my account.</Text>
      </Card>

      <Card onPress={() => go('PARTNER')}>
        <Text style={styles.h}>🤝 I&apos;m a Partner</Text>
        <Text style={styles.p}>Offer services, accept work, and get paid securely.</Text>
      </Card>

      <TouchableOpacity onPress={() => router.push('/(auth)/login')} style={styles.link}>
        <Text style={styles.linkText}>Already have an account? Sign in</Text>
      </TouchableOpacity>
    </Screen>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 18, fontWeight: '700', color: Colors.onSurfaceDark, marginBottom: 4 },
  p: { fontSize: 14, color: Colors.onSurfaceVariant },
  link: { marginTop: 24 },
  linkText: { color: Colors.primary, textAlign: 'center', fontSize: 15, fontWeight: '600' },
});
