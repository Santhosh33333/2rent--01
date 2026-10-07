import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../lib/socket';
import { useAuthStore } from '../shared/store/authStore';
import { Colors } from '../design-system/tokens/colors';

interface IncomingNotification {
  id?: string;
  title?: string;
  body?: string;
  data?: string | Record<string, unknown> | null;
}

function parseData(n: IncomingNotification): Record<string, any> {
  try {
    const d = typeof n.data === 'string' ? JSON.parse(n.data) : (n.data ?? {});
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}

/**
 * Route a live notification to what it is about. Feed events (like/comment/
 * gift) open the post; booking events open the tracker; everything else falls
 * back to the notification inbox.
 */
export function routeForNotification(n: IncomingNotification): string {
  const d = parseData(n);
  if (typeof d.postId === 'string' && d.postId) return `/post/${d.postId}`;
  if (typeof d.bookingId === 'string' && d.bookingId) return `/booking/${d.bookingId}`;
  return '/notifications';
}

/**
 * Rows that are consumed by their own in-flow UI (the OTP entry point, the
 * verify-code screen) would just double up if they also appeared in a banner.
 */
function isSilentRow(n: IncomingNotification): boolean {
  const text = `${n.title ?? ''} ${n.body ?? ''}`.toLowerCase();
  if (
    text.includes('otp') ||
    text.includes('verification code') ||
    text.includes('start code') ||
    text.includes('completion code')
  ) {
    return true;
  }
  const d = parseData(n);
  return d.type === 'OTP' || d.purpose === 'SENSITIVE_ACTION' || d.purpose === 'PHONE_VERIFICATION';
}

/**
 * Live in-app banner for socket `notification` events.
 *
 * The backend writes one Notification row per event and its middleware fans it
 * out to this socket AND FCM push, so an open app gets the banner here while a
 * backgrounded app gets the system-tray notification from the same event.
 * Wrapping the root Stack keeps it visible on whichever screen is open.
 */
export function RealtimeNotifications({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  const [current, setCurrent] = useState<IncomingNotification | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = () => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
      setCurrent(null)
    );
  };

  useEffect(() => {
    // Signed out: there is no session to listen with, and building a socket
    // here would only manufacture a rejected handshake on every cold start.
    if (!user) return;

    const socket = getSocket();
    const onNotification = (n: IncomingNotification) => {
      if (!n || !n.title) return;
      if (isSilentRow(n)) return;
      // Everything that reads ['notifications'] (profile badge, inbox) should
      // see the new row immediately.
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setCurrent(n);
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(hide, 6000);
    };

    socket.on('notification', onNotification);
    return () => {
      socket.off('notification', onNotification);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const open = () => {
    if (!current) return;
    const route = routeForNotification(current);
    hide();
    router.push(route as never);
  };

  return (
    <View style={styles.wrap}>
      {children}
      {current ? (
        <TouchableOpacity
          style={[styles.overlay, { top: insets.top + 12 }]}
          activeOpacity={0.95}
          onPress={open}
        >
          <Animated.View style={[styles.banner, { opacity }]}>
            <View style={styles.glyph}>
              <Text style={styles.glyphText}>{glyphFor(current)}</Text>
            </View>
            <View style={styles.textCol}>
              <Text style={styles.title} numberOfLines={1}>
                {current.title}
              </Text>
              <Text style={styles.body} numberOfLines={2}>
                {current.body}
              </Text>
            </View>
          </Animated.View>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function glyphFor(n: IncomingNotification): string {
  const d = parseData(n);
  const type = typeof d.type === 'string' ? d.type : '';
  if (type === 'POST_LIKE') return '❤️';
  if (type === 'POST_GIFT') return '🎁';
  if (type === 'POST_COMMENT') return '💬';
  if (type === 'POST_REPLY') return '↩️';
  if (type === 'SOS' || type === 'EMERGENCY') return '🚨';
  if (type?.startsWith('CHAT') || type === 'CHAT_MESSAGE') return '💭';
  return '🔔';
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  overlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 1000,
    elevation: 12,
    // A tap bubbles up to it; the area below stays interactive for the screen.
    // The empty View is deliberately sized to the single banner.
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceDark,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  glyph: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primary + '2e',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  glyphText: { fontSize: 18 },
  textCol: { flex: 1 },
  title: { color: Colors.onSurfaceDark, fontWeight: '800', fontSize: 14 },
  body: { color: Colors.onSurfaceVariant, fontSize: 13, marginTop: 2, lineHeight: 17 },
});