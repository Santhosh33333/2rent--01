import { Modal, View, Text, StyleSheet } from 'react-native';
import { Button } from '../lib/ui';
import { Colors } from '../design-system/tokens/colors';
import type { CallSession } from '../hooks/useCallSignaling';

const TITLES: Record<string, string> = {
  calling: 'Calling…',
  incoming: 'Incoming call',
  connected: 'Call connected',
  rejected: 'Call declined',
  ended: 'Call ended',
  unavailable: 'Call unavailable',
};

/** Reasons the server can send on `call:unavailable`. */
const UNAVAILABLE_COPY: Record<string, string> = {
  NO_RECEIVER: 'That person is not reachable right now.',
  FORBIDDEN: 'You can only call people you have worked with or messaged.',
  SELF_CALL: 'You cannot call yourself.',
  CALL_GONE: 'This call already ended.',
  INTERNAL_ERROR: 'Something went wrong starting the call.',
  MEDIA_FAILED: 'Call media could not be established.',
  MOBILE_MEDIA_UNAVAILABLE: 'Live audio is not available from this app yet.',
};

export function CallModal({
  session,
  peerName,
  onAccept,
  onReject,
  onEnd,
  onDismiss,
}: {
  session: CallSession;
  peerName?: string;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onDismiss: () => void;
}) {
  const status = session.status;
  const visible = status !== 'idle';
  const live = status === 'calling' || status === 'incoming' || status === 'connected';

  const detail =
    status === 'unavailable'
      ? UNAVAILABLE_COPY[session.endReason || ''] || 'This call could not be connected.'
      : status === 'rejected'
      ? `${peerName ?? 'They'} declined the call.`
      : status === 'ended'
      ? session.endReason === 'NO_ANSWER'
        ? 'No answer.'
        : session.endReason === 'MEDIA_UNAVAILABLE'
        ? 'Live audio is not available from this app yet.'
        : 'Call ended.'
      : '';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{TITLES[status] ?? 'Call'}</Text>
          <Text style={styles.name}>{peerName ?? 'Nabri contact'}</Text>
          <Text style={styles.type}>{session.callType}</Text>

          {!session.mediaReady && live && (
            <Text style={styles.notice}>
              Signaling is connected. Live audio is not yet available in this app.
            </Text>
          )}

          {!!detail && <Text style={styles.detail}>{detail}</Text>}

          {status === 'incoming' ? (
            <View style={styles.row}>
              <Button label="Accept" onPress={onAccept} />
              <Button label="Decline" variant="ghost" onPress={onReject} />
            </View>
          ) : live ? (
            <Button label="End call" variant="ghost" onPress={onEnd} />
          ) : (
            <Button label="Close" onPress={onDismiss} />
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
  notice: { color: Colors.onSurfaceVariant, fontSize: 12, textAlign: 'center', marginTop: 4 },
  detail: { color: Colors.onSurfaceVariant, fontSize: 12, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 12, marginTop: 8 },
});
