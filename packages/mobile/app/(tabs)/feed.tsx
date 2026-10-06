import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { useRouter } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Colors } from '../../src/design-system/tokens/colors';
import { get, post, mediaUrl } from '../../src/lib/api';
import { useFlag } from '../../src/lib/flags';
import { tokenStore } from '../../src/lib/storage';
import { useAuthStore } from '../../src/shared/store/authStore';
import type { FeedPost } from '../../src/lib/feedTypes';

interface FeedPage {
  items: FeedPost[];
  page: number;
  limit: number;
  total: number;
}

function Avatar({ author, size = 40 }: { author?: { fullName?: string | null; avatarUrl?: string | null } | null; size?: number }) {
  const uri = mediaUrl(author?.avatarUrl);
  const initial = (author?.fullName || '?').trim().charAt(0).toUpperCase();
  if (uri) {
    return <Image source={{ uri }} style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]} contentFit="cover" />;
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarInitial, { fontSize: size * 0.42 }]}>{initial}</Text>
    </View>
  );
}

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return '';
  try {
    return formatDistanceToNow(time, { addSuffix: true });
  } catch {
    return '';
  }
}

export default function Feed() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const postsOn = useFlag('POSTS', true);

  const hasToken = !!tokenStore.getAccessToken();
  const isAuthed = hasToken && !!user;

  const feed = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: ({ pageParam }) => get<FeedPage>('/posts', { page: pageParam, limit: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const p = last?.data;
      if (!p) return undefined;
      return p.page * p.limit < p.total ? p.page + 1 : undefined;
    },
    enabled: postsOn && isAuthed,
  });

  const posts = (feed.data?.pages ?? []).flatMap((p) => p.data?.items ?? []);
  const refreshing = feed.isFetching;

  const updatePostCache = useCallback(
    (postId: string, update: (p: FeedPost) => FeedPost) => {
      queryClient.setQueriesData({ queryKey: ['feed'] }, (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => {
            const d = page?.data;
            if (!d?.items) return page;
            return { ...page, data: { ...d, items: d.items.map((it: FeedPost) => (it.id === postId ? update(it) : it)) } };
          }),
        };
      });
    },
    [queryClient]
  );

  const toggleLike = useMutation({
    mutationFn: (postId: string) => post<{ liked: boolean; likeCount: number }>(`/posts/${postId}/like`),
    onSuccess: (env, postId) => {
      const d = env.data;
      if (d) {
        updatePostCache(postId, (p) => ({
          ...p,
          likedByMe: d.liked,
          _count: { likes: d.likeCount, comments: p._count?.comments ?? 0, gifts: p._count?.gifts ?? 0 },
        }));
      }
    },
  });

  const toggleSave = useMutation({
    mutationFn: (postId: string) => post<{ saved: boolean; saveCount: number }>(`/posts/${postId}/save`),
    onSuccess: (env, postId) => {
      const d = env.data;
      if (d) {
        updatePostCache(postId, (p) => ({ ...p, savedByMe: d.saved }));
      }
    },
  });

  const renderPost = ({ item }: { item: FeedPost }) => (
    <TouchableOpacity
      style={styles.post}
      activeOpacity={0.9}
      onPress={() => router.push(`/post/${item.id}`)}
    >
      <View style={styles.postHeader}>
        <Avatar author={item.author} />
        <View style={styles.postHeaderText}>
          <Text style={styles.authorName}>{item.author?.fullName || 'Member'}</Text>
          <Text style={styles.postMeta}>
            {timeAgo(item.createdAt)}
            {item.visibility !== 'PUBLIC' ? ` · ${item.visibility === 'FOLLOWERS' ? 'Friends' : 'Private'}` : ''}
          </Text>
        </View>
      </View>

      {item.content ? <Text style={styles.postText}>{item.content}</Text> : null}

      {item.imageUrl ? (
        <Image source={{ uri: mediaUrl(item.imageUrl)! }} style={styles.mediaImage} contentFit="cover" transition={120} />
      ) : null}

      {item.videoUrl ? (
        <View style={styles.mediaVideoWrap}>
          <Video
            source={{ uri: mediaUrl(item.videoUrl)! }}
            style={styles.mediaVideo}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay={false}
            useNativeControls={false}
          />
          <View style={styles.playBadge} pointerEvents="none">
            <Text style={styles.playIcon}>▶</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => toggleLike.mutate(item.id)}
        >
          <Text style={[styles.actionIcon, item.likedByMe && styles.iconLiked]}>{item.likedByMe ? '❤️' : '🤍'}</Text>
          <Text style={styles.actionCount}>{item._count?.likes ?? 0}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => router.push(`/post/${item.id}`)}
        >
          <Text style={styles.actionIcon}>💬</Text>
          <Text style={styles.actionCount}>{item._count?.comments ?? 0}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => toggleSave.mutate(item.id)}
        >
          <Text style={[styles.actionIcon, item.savedByMe && styles.iconSaved]}>{item.savedByMe ? '🔖' : '📑'}</Text>
          <Text style={styles.actionCount}>{item._count?.gifts ?? 0}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => router.push(`/post/${item.id}`)}
        >
          <Text style={styles.actionIcon}>🎁</Text>
          <Text style={styles.actionCount}>
            {typeof item.giftTotal === 'number' && item.giftTotal > 0 ? `₹${item.giftTotal}` : 'Gift'}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  const notConfigured = (
    <View style={styles.notice}>
      <Text style={styles.noticeTitle}>Not configured</Text>
      <Text style={styles.noticeText}>
        Nabri posts are behind the feature flag and aren't switched on for this build yet.
      </Text>
    </View>
  );

  const signedOut = (
    <View style={styles.notice}>
      <Text style={styles.noticeTitle}>Sign in to see your feed</Text>
      <Text style={styles.noticeText}>Posts from people near you will show up here.</Text>
      <TouchableOpacity style={styles.cta} onPress={() => router.push('/(auth)/login')}>
        <Text style={styles.ctaText}>Log in</Text>
      </TouchableOpacity>
    </View>
  );

  if (!postsOn) {
    return renderShell(notConfigured, router);
  }

  if (!isAuthed) {
    return renderShell(signedOut, router);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topbar}>
        <Text style={styles.heading}>Feed</Text>
        <TouchableOpacity style={styles.composeBtn} onPress={() => router.push('/post/new')}>
          <Text style={styles.composeText}>✏️ New post</Text>
        </TouchableOpacity>
      </View>

      <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={renderPost}
          contentContainerStyle={styles.listContent}
          onRefresh={feed.refetch}
          refreshing={refreshing}
          onEndReachedThreshold={0.5}
          onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
          ListHeaderComponent={feed.isLoading ? <ActivityIndicator color={Colors.primary} style={styles.loading} /> : null}
          ListEmptyComponent={
            !feed.isLoading ? (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>No posts yet. Be the first to publish one.</Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            feed.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={styles.loading} /> : null
          }
        />

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/post/new')}>
        <Text style={styles.fabText}>＋</Text>
      </TouchableOpacity>
    </View>
  );
}

// Renders the non-feed states without the FAB or post controls.
function renderShell(children: React.ReactNode, router: ReturnType<typeof useRouter>) {
  return (
    <View style={styles.screen}>
      <View style={styles.topbar}>
        <Text style={styles.heading}>Feed</Text>
        <TouchableOpacity style={styles.composeBtn} onPress={() => router.push('/post/new')}>
          <Text style={styles.composeText}>✏️ New post</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.backgroundDark },
  topbar: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: { color: Colors.onSurfaceDark, fontSize: 26, fontWeight: '800' },
  composeBtn: {
    backgroundColor: Colors.primary + '22',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  composeText: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
  listContent: { paddingHorizontal: 16, paddingBottom: 110 },
  loading: { marginVertical: 24 },
  post: {
    backgroundColor: Colors.surfaceDark,
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  postHeaderText: { flex: 1 },
  authorName: { color: Colors.onSurfaceDark, fontWeight: '700', fontSize: 15 },
  postMeta: { color: Colors.onSurfaceVariant, fontSize: 12, marginTop: 2 },
  avatar: { backgroundColor: Colors.primary },
  avatarFallback: {
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: Colors.onPrimary, fontWeight: '800' },
  postText: { color: Colors.onSurfaceDark, fontSize: 15, lineHeight: 22, marginTop: 10 },
  mediaImage: { width: '100%', height: 230, borderRadius: 12, marginTop: 10, backgroundColor: Colors.surfaceDark },
  mediaVideoWrap: {
    width: '100%',
    height: 230,
    borderRadius: 12,
    marginTop: 10,
    backgroundColor: '#000',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaVideo: { width: '100%', height: '100%' },
  playBadge: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { color: '#fff', fontSize: 20, marginLeft: 3 },
  actions: { flexDirection: 'row', marginTop: 12, gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 6, paddingVertical: 6 },
  actionIcon: { fontSize: 16 },
  iconLiked: {},
  iconSaved: {},
  actionCount: { color: Colors.onSurfaceVariant, fontSize: 12, fontWeight: '600' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 26,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: { color: Colors.onPrimary, fontSize: 30, lineHeight: 34 },
  notice: {
    marginTop: 40,
    marginHorizontal: 24,
    backgroundColor: Colors.surfaceDark,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderStyle: 'dashed',
    padding: 22,
    alignItems: 'center',
  },
  noticeTitle: { color: Colors.warningContainer, fontWeight: '800', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 },
  noticeText: { color: Colors.onSurfaceVariant, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  shellBody: { flex: 1 },
  cta: {
    marginTop: 16,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  ctaText: { color: Colors.onPrimary, fontWeight: '700', fontSize: 15 },
});