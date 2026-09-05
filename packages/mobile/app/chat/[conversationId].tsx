import { View, Text, FlatList, TextInput, StyleSheet } from 'react-native';
import { useState, useRef, useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen, Title, Button } from '../../src/lib/ui';
import { Colors } from '../../src/design-system/tokens/colors';
import { get, post } from '../../src/lib/api';
import { useChat } from '../../src/hooks/useChat';
import { useAuthStore } from '../../src/shared/store/authStore';

export default function ChatThread() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const meId = useAuthStore((s) => s.user?.id);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [peerTyping, setPeerTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data } = useQuery({
    queryKey: ['thread', conversationId],
    queryFn: () => get<any>(`/messages/${conversationId}`),
    enabled: !!conversationId,
  });

  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !data) return;
    seededRef.current = true;
    const msgs = (data?.data?.messages ?? []) as any[];
    setMessages(msgs);
    const unread = msgs.filter((m) => !m.read && m.senderId !== meId).map((m) => m.id);
    if (unread.length) post(`/messages/${unread[0]}/read`, { messageIds: unread }).catch(() => {});
  }, [data, meId]);

  const { send, setTyping } = useChat(conversationId, {
    onMessage: (m) => setMessages((prev) => [...prev, m]),
    onTyping: () => setPeerTyping(true),
    onStopTyping: () => setPeerTyping(false),
  });

  const onChange = (v: string) => {
    setText(v);
    if (v.length > 0) {
      setTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(false), 1500);
    }
  };

  const onSend = () => {
    const t = text.trim();
    if (!t) return;
    send(t);
    setText('');
    setTyping(false);
    if (typingTimer.current) clearTimeout(typingTimer.current);
  };

  return (
    <Screen>
      <Title>Chat</Title>
      <FlatList
        data={messages}
        keyExtractor={(m, i) => m.id ?? String(i)}
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.senderId === meId ? styles.mine : styles.theirs]}>
            <Text style={styles.bubbleText}>{item.content}</Text>
          </View>
        )}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        style={{ flex: 1 }}
      />
      {peerTyping ? <Text style={styles.typing}>typing…</Text> : null}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={onChange}
          placeholder="Type a message"
          placeholderTextColor={Colors.onSurfaceVariant}
        />
        <Button label="Send" onPress={onSend} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '80%', padding: 10, borderRadius: 14 },
  mine: { alignSelf: 'flex-end', backgroundColor: Colors.primary },
  theirs: { alignSelf: 'flex-start', backgroundColor: Colors.surfaceDark },
  bubbleText: { color: '#fff', fontSize: 14 },
  typing: { color: Colors.onSurfaceVariant, fontSize: 12, paddingHorizontal: 12, marginBottom: 4 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 8 },
  input: {
    flex: 1,
    backgroundColor: Colors.surfaceDark,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.onSurfaceDark,
  },
});
