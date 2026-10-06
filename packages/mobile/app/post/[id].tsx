import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  FlatList,
  Alert as RNAlert,
} from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Colors } from '../../src/design-system/tokens/colors';
import { get, post, del, mediaUrl, errorMessage } from '../../src/lib/api';
import { useFlag } from '../../src/lib/flags';
import { useAuthStore } from '../../src/shared/store/authStore';
import type { FeedPost, FeedComment } from '../../src/lib/feedTypes';

const GIFT_PRESETS = [5, 10, 25, 50];
const REPORT_REASONS = ['Spam', 'Harassment', 'Misinformation', 'Hate speech', 'Violence', 'Other'];

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

function money(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function ReplyList({ postId, commentId }: { postId: string; commentId: string }) {
  const repliesQuery = useQuery({
    queryKey: ['replies', postId, commentId],
    queryFn: () => get<{ items: FeedComment[] }>(`/posts/${postId}/comments/${commentId}/replies`, { limit: 50 }),
  });
  const replies = repliesQuery.data?.data?.items ?? [];
  if (repliesQuery.isLoading) return <ActivityIndicator color={Colors.primary} style={styles.smallLoading} />;
  if (!replies.length) return <Text style={styles.replyEmpty}>No replies yet.</Text>;
  return (
    <View style={styles.replies}>
      {replies.map((r) => (
        <View key={r.id} style={styles.replyRow}>
          <Text style={styles.replyName}>{r.author?.fullName || 'Member'}</Text>
          <Text style={styles.replyText}>{r.content}</Text>
          <Text style={styles.replyMeta}>{timeAgo(r.createdAt)}</Text>
        </View>
      ))}
    </View>
  );
}

export default function PostDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const postId = String(id);
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const giftingOn = useFlag('GIFTING', true);

  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [giftOpen, setGiftOpen] = useState(false);
  const [giftAmount, setGiftAmount] = useState<number | null>(null);
  const [customGift, setCustomGift] = useState('');
  const [giftBusy, setGiftBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string | null>(null);
  const [reportNote, setReportNote] = useState('');
  const [reportBusy, setReportBusy] = useState(false);

  const postQuery = useQuery({
    queryKey: ['post', postId],
    queryFn: () => get<FeedPost>(`/posts/${postId}`),
  });
  const postData = postQuery.data?.data;

  const commentsQuery = useQuery({
    queryKey: ['comments', postId],
    queryFn: () => get<{ items: FeedComment[] }>(`/posts/${postId}/comments`, { limit: 50 }),
    enabled: !!post,
  });
  const comments = commentsQuery.data?.data?.items ?? [];

  const isAuthor = !!postData && postData.authorId === user?.id;

  const invalidatePost = () => {
    queryClient.invalidateQueries({ queryKey: ['post', postId] });
    queryClient.invalidateQueries({ queryKey: ['feed'] });
  };

  // ---------------------------------------------------------------- like/save
  const likeMutation = useMutation({
    mutationFn: () => post(`/posts/${postId}/like`),
    onSuccess: invalidatePost,
  });
  const saveMutation = useMutation({
    mutationFn: () => post(`/posts/${postId}/save`),
    onSuccess: invalidatePost,
  });

  // ---------------------------------------------------------------- comments
  const commentMutation = useMutation({
    mutationFn: (body: { content: string; parentId?: string | null }) => post(`/posts/${postId}/comments`, body),
    onSuccess: async () => {
      setCommentText('');
      setReplyTo(null);
      await queryClient.invalidateQueries({ queryKey: ['comments', postId] });
      invalidatePost();
    },
    onError: (err) => RNAlert.alert('Comment failed', errorMessage(err)),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => del(`/posts/${postId}/comments/${commentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', postId] }),
  });

  const sendComment = () => {
    const content = commentText.trim();
    if (!content) return;
    commentMutation.mutate({ content, parentId: replyTo });
  };

  const toggleReplies = (commentId: string) => {
    setExpandedReplies((prev) => ({ ...prev, [commentId]: !prev[commentId] }));
  };

  // ------------------------------------------------------------------ gifts
  const sendGift = async () => {
    let amount = giftAmount;
    if (!amount && customGift.trim()) {
      amount = Number(customGift.trim());
      if (!Number.isFinite(amount) || amount < 5 || amount > 500) {
        RNAlert.alert('Invalid amount', 'Gifts are between ₹5 and ₹500.');
        return;
      }
      // Enforce (at most) two decimals before the money moves.
      if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
        RNAlert.alert('Invalid amount', 'Gifts can have at most two decimal places.');
        return;
      }
    }
    if (!amount) {
      RNAlert.alert('Choose an amount', 'Pick a gift amount first.');
      return;
    }
    setGiftBusy(true);
    try {
      const referenceId = `g-${user?.id ?? 'x'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const env = await post<any>(`/posts/${postId}/gift`, { amount, referenceId });
      if (!env.success) {
        throw new Error(env.message || env.error || 'Gift failed');
      }
      setGiftOpen(false);
      setGiftAmount(null);
      setCustomGift('');
      invalidatePost();
      RNAlert.alert('Gift sent', `${money(amount)} was sent — the author's wallet was credited.`);
    } catch (e) {
      RNAlert.alert('Gift failed', errorMessage(e, 'Could not send the gift right now.'));
    } finally {
      setGiftBusy(false);
    }
  };

  // ---------------------------------------------------------------- reporting
  const submitReport = async () => {
    if (!reportReason) {
      RNAlert.alert('Choose a reason', 'Pick what this post violates.');
      return;
    }
    setReportBusy(true);
    try {
      const env = await post<any>(`/posts/${postId}/report`, {
        reason: reportReason,
        description: reportNote.trim() || undefined,
      });
      if (!env.success) throw new Error(env.message || env.error || 'Report failed');
      setReportOpen(false);
      setReportReason(null);
      setReportNote('');
      RNAlert.alert('Reported', 'Thanks — an admin will review it.');
    } catch (e) {
      RNAlert.alert('Report failed', errorMessage(e, 'Could not report the postData.'));
    } finally {
      setReportBusy(false);
    }
  };

  // ---------------------------------------------------------------- delete
  const deletePost = () => {
    RNAlert.alert('Delete post?', 'This hides the post and its comments for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await del(`/posts/${postId}`);
            queryClient.invalidateQueries({ queryKey: ['feed'] });
            router.replace('/(tabs)/feed');
          } catch (e) {
            RNAlert.alert('Delete failed', errorMessage(e));
          }
        },
      },
    ]);
  };

  if (postQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!postData || postQuery.isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>This post isn't available.</Text>
        <TouchableOpacity style={styles.cta} onPress={() => router.back()}>
          <Text style={styles.ctaText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topbar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>Post</Text>
        <View style={styles.topbarRight}>
          {isAuthor ? (
            <TouchableOpacity onPress={deletePost}>
              <Text style={styles.delete}>🗑</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => setReportOpen(true)}>
              <Text style={styles.delete}>…</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        data={comments}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item: comment }) => (
          <View style={styles.commentBlock}>
            <View style={styles.commentRow}>
              <Text style={styles.commentName}>{comment.author?.fullName || 'Member'}</Text>
              <Text style={styles.commentMeta}>{timeAgo(comment.createdAt)}</Text>
              {comment.isMine ? (
                <TouchableOpacity onPress={() => deleteCommentMutation.mutate(comment.id)}>
                  <Text style={styles.commentDelete}>Delete</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <Text style={styles.commentText}>{comment.content}</Text>
            <View style={styles.commentActions}>
              {comment.parentId === null ? (
                <TouchableOpacity onPress={() => setReplyTo(comment.id)}>
                  <Text style={styles.replyLink}>Reply</Text>
                </TouchableOpacity>
              ) : null}
              {comment._count?.replies ? (
                <TouchableOpacity onPress={() => toggleReplies(comment.id)}>
                  <Text style={styles.replyLink}>
                    {expandedReplies[comment.id] ? 'Hide replies' : `${comment._count.replies} replies`}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {expandedReplies[comment.id] ? <ReplyList postId={postId} commentId={comment.id} /> : null}
          </View>
        )}
        ListHeaderComponent={
          <View>
            <View style={styles.authorRow}>
              {postData.author?.avatarUrl ? (
                <Image source={{ uri: mediaUrl(postData.author.avatarUrl)! }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{(postData.author?.fullName || '?').charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.authorText}>
                <Text style={styles.authorName}>{postData.author?.fullName || 'Member'}</Text>
                <Text style={styles.postMeta}>
                  {timeAgo(postData.createdAt)}
                  {postData.visibility !== 'PUBLIC' ? ` · ${postData.visibility === 'FOLLOWERS' ? 'Friends' : 'Private'}` : ''}
                </Text>
              </View>
            </View>

            {postData.content ? <Text style={styles.postText}>{postData.content}</Text> : null}

            {postData.imageUrl ? (
              <Image source={{ uri: mediaUrl(postData.imageUrl)! }} style={styles.mediaImage} contentFit="cover" />
            ) : null}

            {postData.videoUrl ? (
              <Video
                source={{ uri: mediaUrl(postData.videoUrl)! }}
                style={styles.mediaVideo}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay={false}
                useNativeControls
              />
            ) : null}

            <View style={styles.engagement}>
              <TouchableOpacity style={styles.engageBtn} onPress={() => likeMutation.mutate()}>
                <Text style={[styles.engageIcon, postData.likedByMe && { color: '#E53935' }]}>
                  {postData.likedByMe ? '❤️' : '🤍'}
                </Text>
                <Text style={styles.engageCount}>{postData._count?.likes ?? 0}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.engageBtn} onPress={() => saveMutation.mutate()}>
                <Text style={styles.engageIcon}>{postData.savedByMe ? '🔖' : '📑'}</Text>
                <Text style={styles.engageCount}>{postData.savedByMe ? 'Saved' : 'Save'}</Text>
              </TouchableOpacity>
              {giftingOn && !isAuthor ? (
                <TouchableOpacity style={styles.engageBtn} onPress={() => setGiftOpen(true)}>
                  <Text style={styles.engageIcon}>🎁</Text>
                  <Text style={styles.engageCount}>
                    {typeof postData.giftTotal === 'number' && postData.giftTotal > 0 ? money(postData.giftTotal) : 'Gift'}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {giftOpen ? (
              <View style={styles.giftPanel}>
                <Text style={styles.panelTitle}>Send a gift</Text>
                <Text style={styles.panelSub}>Debits your wallet and credits the author's.</Text>
                <View style={styles.giftChips}>
                  {GIFT_PRESETS.map((n) => (
                    <TouchableOpacity
                      key={n}
                      style={[styles.giftChip, giftAmount === n && styles.giftChipActive]}
                      onPress={() => {
                        setGiftAmount(n);
                        setCustomGift('');
                      }}
                    >
                      <Text style={[styles.giftChipText, giftAmount === n && styles.giftChipTextActive]}>{money(n)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={styles.customInput}
                  placeholder="Custom (₹5 – ₹500)"
                  placeholderTextColor={Colors.outline}
                  keyboardType="decimal-pad"
                  value={customGift}
                  onChangeText={(t) => {
                    setCustomGift(t);
                    if (t.trim()) setGiftAmount(null);
                  }}
                />
                <TouchableOpacity style={styles.primaryBtn} onPress={sendGift} disabled={giftBusy}>
                  {giftBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send gift</Text>}
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          commentsQuery.isLoading ? (
            <ActivityIndicator color={Colors.primary} style={styles.smallLoading} />
          ) : (
            <Text style={styles.emptyComments}>No comments yet. Start the conversation below.</Text>
          )
        }
      />

      {replyTo ? (
        <View style={styles.replyBar}>
          <Text style={styles.replyBarText}>
            Replying to a comment —{' '}
            <Text style={styles.replyBarCancel} onPress={() => setReplyTo(null)}>
              cancel
            </Text>
          </Text>
        </View>
      ) : null}

      <View style={styles.composerBar}>
        <TextInput
          style={styles.commentInput}
          placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
          placeholderTextColor={Colors.outline}
          value={commentText}
          onChangeText={setCommentText}
          onSubmitEditing={sendComment}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={sendComment} disabled={commentMutation.isPending}>
          {commentMutation.isPending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendBtnText}>Send</Text>
          )}
        </TouchableOpacity>
      </View>

      {reportOpen ? (
        <View style={styles.sheet}>
          <Text style={styles.panelTitle}>Report this post</Text>
          <Text style={styles.panelSub}>Admins review every report. Duplicate reports are blocked.</Text>
          <View style={styles.reportReasons}>
            {REPORT_REASONS.map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.reportChip, reportReason === r && styles.giftChipActive]}
                onPress={() => setReportReason(r)}
              >
                <Text style={[styles.giftChipText, reportReason === r && styles.giftChipTextActive]}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.customInput}
            placeholder="Anything else we should know? (optional)"
            placeholderTextColor={Colors.outline}
            value={reportNote}
            onChangeText={setReportNote}
            multiline
          />
          <View style={styles.sheetButtons}>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setReportOpen(false)}>
              <Text style={styles.ghostBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={submitReport} disabled={reportBusy}>
              {reportBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Submit report</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
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
  topbarRight: { width: 60, alignItems: 'flex-end' },
  back: { color: Colors.primary, fontSize: 15, fontWeight: '700' },
  heading: { color: Colors.onSurfaceDark, fontSize: 18, fontWeight: '800' },
  delete: { color: Colors.onSurfaceVariant, fontSize: 18, paddingHorizontal: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.backgroundDark, padding: 20 },
  errorText: { color: Colors.onSurfaceVariant, fontSize: 15 },
  cta: { marginTop: 16, backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  ctaText: { color: Colors.onPrimary, fontWeight: '700' },
  listContent: { paddingHorizontal: 16, paddingBottom: 120 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  authorText: { flex: 1 },
  authorName: { color: Colors.onSurfaceDark, fontWeight: '800', fontSize: 16 },
  postMeta: { color: Colors.onSurfaceVariant, fontSize: 12, marginTop: 2 },
  avatarImage: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: Colors.onPrimary, fontWeight: '800', fontSize: 18 },
  postText: { color: Colors.onSurfaceDark, fontSize: 16, lineHeight: 24, marginTop: 12 },
  mediaImage: { width: '100%', height: 260, borderRadius: 14, marginTop: 12 },
  mediaVideo: { width: '100%', height: 260, borderRadius: 14, marginTop: 12, backgroundColor: '#000' },
  engagement: { flexDirection: 'row', gap: 20, marginTop: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: Colors.outlineVariant },
  engageBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  engageIcon: { fontSize: 18 },
  engageCount: { color: Colors.onSurfaceVariant, fontSize: 13, fontWeight: '600' },
  giftPanel: { marginTop: 14, backgroundColor: Colors.surfaceDark, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.outlineVariant },
  panelTitle: { color: Colors.onSurfaceDark, fontWeight: '800', fontSize: 16 },
  panelSub: { color: Colors.onSurfaceVariant, fontSize: 13, marginTop: 2 },
  giftChips: { flexDirection: 'row', gap: 8, marginTop: 12 },
  giftChip: {
    flex: 1,
    backgroundColor: Colors.backgroundDark,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingVertical: 10,
    alignItems: 'center',
  },
  giftChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  giftChipText: { color: Colors.onSurfaceVariant, fontSize: 13 },
  giftChipTextActive: { color: Colors.primary, fontWeight: '800' },
  customInput: {
    backgroundColor: Colors.backgroundDark,
    color: Colors.onSurfaceDark,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    marginTop: 10,
  },
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 12,
    flex: 1,
  },
  primaryBtnText: { color: Colors.onPrimary, fontWeight: '800', fontSize: 15 },
  commentBlock: {
    marginTop: 14,
    backgroundColor: Colors.surfaceDark,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  commentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentName: { color: Colors.onSurfaceDark, fontWeight: '700', fontSize: 13, flex: 1 },
  commentMeta: { color: Colors.onSurfaceVariant, fontSize: 11 },
  commentDelete: { color: Colors.error, fontSize: 12, fontWeight: '600' },
  commentText: { color: Colors.onSurfaceDark, fontSize: 14, lineHeight: 20, marginTop: 6 },
  commentActions: { flexDirection: 'row', gap: 16, marginTop: 8 },
  replyLink: { color: Colors.primary, fontSize: 12, fontWeight: '700' },
  replies: { marginTop: 10, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: Colors.outlineVariant },
  replyRow: { marginBottom: 10 },
  replyName: { color: Colors.onSurfaceDark, fontWeight: '700', fontSize: 12 },
  replyText: { color: Colors.onSurfaceVariant, fontSize: 13, lineHeight: 18, marginTop: 2 },
  replyMeta: { color: Colors.onSurfaceVariant, fontSize: 10, marginTop: 2 },
  replyEmpty: { color: Colors.onSurfaceVariant, fontSize: 12, marginTop: 8 },
  emptyComments: { color: Colors.onSurfaceVariant, fontSize: 13, marginTop: 24, textAlign: 'center' },
  smallLoading: { marginVertical: 14 },
  replyBar: { paddingHorizontal: 16, paddingBottom: 6 },
  replyBarText: { color: Colors.primary, fontSize: 12 },
  replyBarCancel: { color: Colors.onSurfaceVariant, textDecorationLine: 'underline' },
  composerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
  },
  commentInput: {
    flex: 1,
    backgroundColor: Colors.surfaceDark,
    color: Colors.onSurfaceDark,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  sendBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  sendBtnText: { color: Colors.onPrimary, fontWeight: '800', fontSize: 14 },
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 100,
    backgroundColor: Colors.surfaceDark,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: 16,
  },
  reportReasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  reportChip: {
    backgroundColor: Colors.backgroundDark,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sheetButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  ghostBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingVertical: 13,
    alignItems: 'center',
  },
  ghostBtnText: { color: Colors.onSurfaceVariant, fontWeight: '700' },
});