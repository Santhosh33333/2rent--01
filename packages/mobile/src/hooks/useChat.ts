import { useEffect, useRef } from 'react';
import { getSocket } from '../lib/socket';

type ChatHandlers = {
  onMessage?: (m: any) => void;
  onTyping?: (d: any) => void;
  onStopTyping?: (d: any) => void;
};

// Real-time chat for a single conversation room (mirrors the web useChat protocol).
export function useChat(conversationId: string | undefined, handlers: ChatHandlers) {
  const ref = useRef<ChatHandlers>(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!conversationId) return;
    const s = getSocket();

    const onMsg = (m: any) => {
      if (m?.conversationId === conversationId) ref.current.onMessage?.(m);
    };
    const onTyping = (d: any) => {
      if (d?.conversationId === conversationId) ref.current.onTyping?.(d);
    };
    const onStop = (d: any) => {
      if (d?.conversationId === conversationId) ref.current.onStopTyping?.(d);
    };

    s.on('new_message', onMsg);
    s.on('user_typing', onTyping);
    s.on('user_stopped_typing', onStop);
    s.emit('join_chat', conversationId);

    return () => {
      s.off('new_message', onMsg);
      s.off('user_typing', onTyping);
      s.off('user_stopped_typing', onStop);
      s.emit('leave_chat', conversationId);
    };
  }, [conversationId]);

  const send = (content: string, receiverId?: string) =>
    getSocket().emit('send_message', { conversationId, content, receiverId });

  const setTyping = (typing: boolean) =>
    getSocket().emit(typing ? 'typing' : 'stop_typing', conversationId);

  return { send, setTyping };
}
