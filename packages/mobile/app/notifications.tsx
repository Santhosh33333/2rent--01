import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, RefreshControl, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Screen, Title, Button } from '../src/lib/ui';
import { Colors } from '../src/design-system/tokens/colors';
import { get, post, toList, errorMessage } from '../src/lib/api';

interface InboxRow {
  id: string;
  title: string;
  body?: string;
  description?: string;
  isRead: boolean;
  data?: string | null;
  createdAt: string;
}

function parseRowData(row: InboxRow): Record<string, any> {
  try {
    const d = row.data ? JSON.parse(row.data) : {};
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}

/** Where a notification should take the user. Feed events open the post. */
function routeForRow(row: InboxRow): string | null {
  const d = parseRowData(row);
  if (typeof d.postId === 'string' && d.postId) return `/post/${d.postId}`;
  if (typeof d.bookingId === 'string' && d.bookingId) return `/booking/${d.bookingId}`;
  return null;
}

function glyphFor(row: InboxRow): string {
  const d = parseRowData(row);
  const type = typeof d.type === 'string' ? d.type : '';
  if (type === 'POST_LIKE') return '❤️';
  if (type === 'POST_GIFT') return '🎁';
  if (type === 'POST_COMMENT') return '💬';
  if (type === 'POST_REPLY') return '↩️';
  return '🔔';
}

export default function NotificationsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => get('/notifications', { page: 1, limit: 50 }),
  });
  const payload = (data?.data ?? {}) as any;
  const rows = toList<InboxRow>(payload, 'notifications');
  const unreadCount = typeof payload?.unreadCount === 'number' ? (payload.unreadCount as number) : 0;

  const openRow = async (row: InboxRow) => {
    const route = routeForRow(row);
    if (!row.isRead) {
      try {
        await post(`/notifications/${row.id}/read`, {});
      } catch {
        // The read state refreshes with the next fetch; navigation still wins.
      }
      queryClient.setQueryData(['notifications'], (old: any) => {
        const cur = (old?.data ?? {}) as any;
        return {
          ...old,
          data: {
            ...cur,
            unreadCount: Math.max(0, (typeof cur.unreadCount === 'number' ? (cur.unreadCount as number) : 0) - 1),
            notifications: (toList(cur, 'notifications') ?? []).map((n: any) =>
              n.id === row.id ? { ...n, isRead: true } : n
            ),
          },
        };
      });
    }
    if (route) router.push(route as never);
  };

  const markAllRead = async () => {
    try {
      await post('/notifications/mark-all-read', {});
    } catch {
      // ignore — next fetch repairs the state
    }
    queryClient.setQueryData(['notifications'], (old: any) => ({
      ...old,
      data: {
        ...(old?.data ?? {}),
        unreadCount: 0,
        notifications: (toList((old?.data as any) ?? {}, 'notifications') ?? []).map((n: any) => ({ ...n, isRead: true })),
      },
    }));
  };

  return (
    <Screen scroll={false} padded>
      <View style={styles.headerRow}>
        <Title>Notifications</Title>
        {unreadCount > 0 ? (
          <TouchableOpacity onPress={markAllRead} style={styles.markAllBtn}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {unreadCount > 0 && <Text style={styles.unreadMeta}>{unreadCount} unread</Text>}

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={Colors.primary} />}
      >
        {isLoading ? (
          <Text style={styles.empty}>Loading notifications…</Text>
        ) : error ? (
          <View>
            <Text style={styles.empty}>{errorMessage(error, 'Could not load notifications.')}</Text>
            <Button label="Retry" variant="ghost" onPress={() => refetch()} />
          </View>
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>
            {unreadCount > 0 ? 'Nothing here yet.' : 'No notifications yet — likes, comments and gifts on your posts will show up here live.'}
          </Text>
        ) : (
          rows.map((row) => {
            const d = parseRowData(row);
            const kind = typeof d.type === 'string' ? d.type : '';
            return (
              <TouchableOpacity
                key={row.id}
                style={[styles.row, !row.isRead && styles.rowUnread]}
                onPress={() => openRow(row)}
                activeOpacity={0.85}
              >
                <Text style={styles.glyph}>{glyphFor(row)}</Text>
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, !row.isRead && styles.rowTitleUnread]} numberOfLines={1}>
                    {row.title}
                  </Text>
                  {row.body ? (
                    <Text style={styles.rowBody} numberOfLines={2}>
                      {row.body}
                    </Text>
                  ) : null}
                  <Text style={styles.rowTime}>
                    {row.createdAt ? formatDistanceToNow(new Date(row.createdAt), { addSuffix: true }) : ''}
                    {kind ? ` · ${kind.replace(/_/g, ' ').toLowerCase()}` : ''}
                  </Text>
                </View>
                {!row.isRead ? <View style={styles.dot} /> : null}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  markAllBtn: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  markAllText: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
  unreadMeta: { color: Colors.onSurfaceVariant, fontSize: 13, marginBottom: 14 },
  list: { paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceDark,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: 14,
    marginBottom: 10,
  },
  rowUnread: { borderColor: Colors.primary, backgroundColor: Colors.primary + '14' },
  glyph: { fontSize: 20, marginRight: 12 },
  rowText: { flex: 1 },
  rowTitle: { color: Colors.onSurfaceVariant, fontWeight: '700', fontSize: 14 },
  rowTitleUnread: { color: Colors.onSurfaceDark, fontWeight: '800' },
  rowBody: { color: Colors.onSurfaceVariant, fontSize: 13, marginTop: 2, lineHeight: 17 },
  rowTime: { color: Colors.outline, fontSize: 11, marginTop: 6, textTransform: 'capitalize' },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
    marginLeft: 8,
  },
  empty: { color: Colors.onSurfaceVariant, fontSize: 14, textAlign: 'center', marginTop: 32, lineHeight: 20 },
});