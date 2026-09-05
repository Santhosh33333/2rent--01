import { Modal, View, Text, StyleSheet } from 'react-native';
import { Button } from '../lib/ui';
import { Colors } from '../design-system/tokens/colors';

export function CallModal({
  session,
  peerName,
  onAccept,
  onReject,
  onEnd,
}: {
  session: { status: string; callType?: string };
  peerName?: string;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
}) {
  const visible =
    session.status === 'incoming' || session.status === 'calling' || session.status === 'connected';

  const title =
    session.status === 'incoming'
      ? 'Incoming call'
      : session.status === 'calling'
      ? 'Calling…'
      : 'Call connected';

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.name}>{peerName ?? 'RentBuddy contact'}</Text>
          <Text style={styles.type}>{session.callType ?? 'VOICE'}</Text>
          {session.status === 'incoming' ? (
            <View style={styles.row}>
              <Button label="Accept" onPress={onAccept} />
              <Button label="Reject" variant="ghost" onPress={onReject} />
            </View>
          ) : (
            <Button label="End call" variant="ghost" onPress={onEnd} />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '82%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  title: { color: Colors.onSurfaceDark, fontWeight: '800', fontSize: 18 },
  name: { color: Colors.onSurfaceVariant, fontSize: 14 },
  type: { color: Colors.primary, fontWeight: '700', fontSize: 12, textTransform: 'uppercase' },
  row: { flexDirection: 'row', gap: 12, marginTop: 8 },
});
