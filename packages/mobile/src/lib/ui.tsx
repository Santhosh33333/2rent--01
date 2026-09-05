import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { Colors } from '../design-system/tokens/colors';

export const Screen: React.FC<{
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  padded?: boolean;
}> = ({ children, scroll = true, style, padded = true }) => {
  const content = <View style={[styles.screen, padded && styles.padded, style]}>{children}</View>;
  return scroll ? <ScrollView style={styles.flex} contentContainerStyle={styles.flex}>{content}</ScrollView> : content;
};

export const Title: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text style={styles.title}>{children}</Text>
);

export const Subtitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text style={styles.subtitle}>{children}</Text>
);

export const Button: React.FC<{
  label: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
}> = ({ label, onPress, loading, variant = 'primary', disabled }) => (
  <TouchableOpacity
    style={[styles.btn, variant === 'ghost' && styles.btnGhost, disabled && styles.btnDisabled]}
    onPress={onPress}
    disabled={disabled || loading}
    activeOpacity={0.85}
  >
    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{label}</Text>}
  </TouchableOpacity>
);

export const TextField: React.FC<{
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  secure?: boolean;
  keyboardType?: any;
  autoCapitalize?: any;
}> = ({ placeholder, value, onChangeText, secure, keyboardType, autoCapitalize }) => (
  <TextInput
    style={styles.input}
    placeholder={placeholder}
    placeholderTextColor={Colors.outline}
    value={value}
    onChangeText={onChangeText}
    secureTextEntry={secure}
    keyboardType={keyboardType}
    autoCapitalize={autoCapitalize}
  />
);

export const Card: React.FC<{ children: React.ReactNode; onPress?: () => void; style?: ViewStyle }> = ({
  children,
  onPress,
  style,
}) => {
  const C = onPress ? TouchableOpacity : View;
  return <C style={[styles.card, style]} onPress={onPress} activeOpacity={0.9}>{children}</C>;
};

export const Alert: React.FC<{ message: string; tone?: 'error' | 'info' | 'success' }> = ({
  message,
  tone = 'error',
}) => (
  <View style={[styles.alert, tone === 'error' && styles.alertError, tone === 'success' && styles.alertSuccess]}>
    <Text style={styles.alertText}>{message}</Text>
  </View>
);

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: Colors.backgroundDark },
  padded: { padding: 20, paddingTop: 56 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.onSurfaceDark, marginBottom: 6 },
  subtitle: { fontSize: 14, color: Colors.onSurfaceVariant, marginBottom: 20 },
  btn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 12,
  },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.outline },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: Colors.onPrimary, fontSize: 16, fontWeight: '700' },
  input: {
    backgroundColor: Colors.surfaceDark,
    color: Colors.onSurfaceDark,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  card: {
    backgroundColor: Colors.surfaceDark,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  alert: { backgroundColor: Colors.errorContainer, borderRadius: 10, padding: 10, marginBottom: 12 },
  alertError: { backgroundColor: 'rgba(179,38,30,0.18)' },
  alertSuccess: { backgroundColor: 'rgba(56,106,32,0.18)' },
  alertText: { color: Colors.onSurfaceDark, fontSize: 13 },
});
