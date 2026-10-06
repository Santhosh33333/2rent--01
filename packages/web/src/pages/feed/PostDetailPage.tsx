import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Heart, Bookmark, Gift, Flag, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { api, assetUrl, postApi } from "../../lib/api";
import { useFeatureFlag } from "../../hooks/useFeatureFlag";
import { Avatar } from "../../components/Avatar";
import { useAuth } from "../../lib/auth";
import type { FeedPost, FeedComment, GiftRecord } from "../../types/post";

const GIFT_PRESETS = [5, 10, 25, 50];
const REPORT_REASONS = ["Spam", "Harassment", "Misinformation", "Hate speech", "Violence", "Other"];

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function money(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function visibilityLabel(visibility: string): string {
  if (visibility === "FOLLOWERS") return "Friends";
  if (visibility === "PRIVATE") return "Private";
  return "Everyone";
}

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const d = (err as { response?: { data?: { message?: string; error?: string } } }).response?.data;
    return d?.message || d?.error || fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const postId = id ?? "";
  const navigate = useNavigate();
  const { user } = useAuth();
  const giftingOn = useFeatureFlag("GIFTING", true);

  const [post, setPost] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [comments, setComments] = useState<FeedComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, FeedComment[]>>({});
  const [repliesBusy, setRepliesBusy] = useState<Record<string, boolean>>({});

  const [giftOpen, setGiftOpen] = useState(false);
  const [giftPreset, setGiftPreset] = useState<number | null>(null);
  const [customGift, setCustomGift] = useState("");
  const [giftBusy, setGiftBusy] = useState(false);
  const [giftNote, setGiftNote] = useState("");

  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string | null>(null);
  const [reportNote, setReportNote] = useState("");
  const [reportBusy, setReportBusy] = useState(false);

  const [giftsOpen, setGiftsOpen] = useState(false);
  const [gifts, setGifts] = useState<GiftRecord[] | null>(null);

  const isAuthor = !!post && post.authorId === user?.id;

  const load = useCallback(async () => {
    if (!postId) return;
    setLoading(true);
    setLoadError("");
    try {
      const res = await api.get<{ data?: FeedPost }>(`/posts/${postId}`);
      setPost(res.data?.data ?? null);
    } catch (err) {
      setLoadError(apiErrorMessage(err, "This post isn't available."));
    } finally {
      setLoading(false);
    }
  }, [postId]);

  const loadComments = useCallback(async () => {
    try {
      const res = await postApi.comments(postId, { limit: 50 });
      const data = res.data?.data as { items?: FeedComment[] } | undefined;
      setComments(data?.items ?? []);
    } catch {
      setComments([]);
    }
  }, [postId]);

  useEffect(() => {
    void load();
    void loadComments();
  }, [load, loadComments]);

  const toggleLike = async () => {
    if (!post) return;
    const wasLiked = post.likedByMe;
    setPost((p) =>
      p
        ? {
            ...p,
            likedByMe: !p.likedByMe,
            _count: { ...(p._count ?? { likes: 0, comments: 0, gifts: 0 }), likes: (p._count?.likes ?? 0) + (wasLiked ? -1 : 1) },
          }
        : p
    );
    try {
      const d = (await postApi.toggleLike(postId).then((r) => r.data?.data)) as
        | { liked: boolean; likeCount: number }
        | undefined;
      if (d) setPost((p) => (p ? { ...p, likedByMe: d.liked, _count: { likes: d.likeCount, comments: p._count?.comments ?? 0, gifts: p._count?.gifts ?? 0 } } : p));
    } catch {
      setPost((p) => (p ? { ...p, likedByMe: wasLiked } : p));
    }
  };

  const toggleSave = async () => {
    if (!post) return;
    const wasSaved = post.savedByMe;
    setPost((p) => (p ? { ...p, savedByMe: !p.savedByMe } : p));
    try {
      const d = (await postApi.toggleSave(postId).then((r) => r.data?.data)) as { saved: boolean } | undefined;
      if (d) setPost((p) => (p ? { ...p, savedByMe: d.saved } : p));
    } catch {
      setPost((p) => (p ? { ...p, savedByMe: wasSaved } : p));
    }
  };

  const sendComment = async () => {
    const content = commentText.trim();
    if (!content) return;
    setCommentsBusy(true);
    try {
      await postApi.addComment(postId, { content, parentId: replyTo });
      setCommentText("");
      setReplyTo(null);
      await loadComments();
      await load();
    } catch (err) {
      window.alert(apiErrorMessage(err, "Comment failed."));
    } finally {
      setCommentsBusy(false);
    }
  };

  const toggleReplies = async (commentId: string) => {
    if (expanded[commentId]) {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[commentId];
        return next;
      });
      return;
    }
    setRepliesBusy((prev) => ({ ...prev, [commentId]: true }));
    try {
      const res = await postApi.replies(postId, commentId, { limit: 50 });
      const data = res.data?.data as { items?: FeedComment[] } | undefined;
      setExpanded((prev) => ({ ...prev, [commentId]: data?.items ?? [] }));
    } catch {
      setExpanded((prev) => ({ ...prev, [commentId]: [] }));
    } finally {
      setRepliesBusy((prev) => ({ ...prev, [commentId]: false }));
    }
  };

  const deleteComment = async (commentId: string) => {
    try {
      await postApi.deleteComment(postId, commentId);
      await loadComments();
      await load();
    } catch (err) {
      window.alert(apiErrorMessage(err, "Could not delete the comment."));
    }
  };

  const sendGift = async () => {
    let amount = giftPreset;
    if (!amount && customGift.trim()) {
      amount = Number(customGift.trim());
      if (!Number.isFinite(amount) || amount < 5 || amount > 500) {
        window.alert("Gifts are between ₹5 and ₹500.");
        return;
      }
      if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
        window.alert("Gifts can have at most two decimal places.");
        return;
      }
    }
    if (!amount) {
      window.alert("Pick a gift amount first.");
      return;
    }
    setGiftBusy(true);
    setGiftNote("");
    try {
      const referenceId = `g-${user?.id ?? "x"}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const res = await postApi.gift(postId, { amount, referenceId });
      if (!res.data?.success) {
        setGiftNote(res.data?.message || "Gift failed.");
        setGiftBusy(false);
        return;
      }
      setGiftOpen(false);
      setGiftPreset(null);
      setCustomGift("");
      await load();
      setGiftNote(`${money(amount)} sent — the author's wallet was credited.`);
    } catch (err) {
      setGiftNote(apiErrorMessage(err, "Could not send the gift right now."));
    } finally {
      setGiftBusy(false);
    }
  };

  const submitReport = async () => {
    if (!reportReason) {
      window.alert("Choose a reason for the report.");
      return;
    }
    setReportBusy(true);
    try {
      const res = await postApi.report(postId, { reason: reportReason, description: reportNote.trim() || undefined });
      if (!res.data?.success) {
        window.alert(res.data?.message || "Report failed.");
        return;
      }
      setReportOpen(false);
      setReportReason(null);
      setReportNote("");
      window.alert("Thanks — an admin will review it.");
    } catch (err) {
      window.alert(apiErrorMessage(err, "Could not report the post."));
    } finally {
      setReportBusy(false);
    }
  };

  const deletePost = async () => {
    if (!window.confirm("Delete this post and its comments for everyone?")) return;
    try {
      await postApi.remove(postId);
      navigate("/feed", { replace: true });
    } catch (err) {
      window.alert(apiErrorMessage(err, "Could not delete the post."));
    }
  };

  const loadGifts = async () => {
    if (gifts) {
      setGiftsOpen((o) => !o);
      return;
    }
    try {
      const res = await postApi.gifts(postId);
      setGifts((res.data?.data as { items?: GiftRecord[] } | undefined)?.items ?? []);
      setGiftsOpen(true);
    } catch {
      setGifts([]);
      setGiftsOpen(true);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-10 w-32 rounded-2xl" />
        <div className="skeleton h-72 rounded-3xl" />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold font-display">Post</h1>
        <div className="rounded-3xl border border-dashed border-surface-300 bg-surface-100 p-10 text-center dark:border-surface-700 dark:bg-surface-900">
          <p className="text-sm text-surface-600 dark:text-surface-400">{loadError || "This post isn't available."}</p>
          <Link to="/feed" className="mt-4 inline-block rounded-2xl bg-primary-500 px-5 py-2.5 text-sm font-semibold text-white">
            Back to feed
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/feed" className="flex items-center gap-1 text-sm font-medium text-surface-500 hover:text-surface-800 dark:hover:text-surface-200">
          <ArrowLeft className="h-4 w-4" /> Feed
        </Link>
        <h1 className="flex-1 text-lg font-bold font-display">Post</h1>
        {isAuthor ? (
          <button type="button" onClick={() => void deletePost()} className="p-2 text-surface-400 hover:text-red-500">
            <Trash2 className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" onClick={() => setReportOpen(true)} className="p-2 text-surface-400 hover:text-surface-200">
            <Flag className="h-4 w-4" />
          </button>
        )}
      </div>

      <article className="overflow-hidden rounded-3xl border border-surface-200 bg-white shadow-card dark:border-surface-800 dark:bg-surface-900">
        <div className="p-5">
          <div className="flex items-center gap-3">
            <Avatar src={post.author?.avatarUrl} name={post.author?.fullName || "Member"} className="h-11 w-11" />
            <div>
              <p className="text-sm font-semibold text-surface-900 dark:text-white">{post.author?.fullName || "Member"}</p>
              <p className="text-xs text-surface-500">
                {timeAgo(post.createdAt)} · {visibilityLabel(post.visibility)}
              </p>
            </div>
          </div>

          {post.content ? (
            <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-surface-800 dark:text-surface-100">
              {post.content}
            </p>
          ) : null}

          {post.imageUrl ? (
            <img src={assetUrl(post.imageUrl)} alt="" className="mt-4 max-h-[480px] w-full rounded-2xl object-cover" />
          ) : null}

          {post.videoUrl ? (
            <video src={assetUrl(post.videoUrl)} controls playsInline className="mt-4 max-h-[480px] w-full rounded-2xl bg-black" />
          ) : null}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleLike()}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm transition ${
                post.likedByMe ? "text-red-500" : "text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800"
              }`}
            >
              <Heart className={`h-4 w-4 ${post.likedByMe ? "fill-current" : ""}`} /> {post._count?.likes ?? 0}
            </button>
            <button
              type="button"
              onClick={() => void toggleSave()}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm transition ${
                post.savedByMe
                  ? "text-primary-600 dark:text-primary-400"
                  : "text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800"
              }`}
            >
              <Bookmark className={`h-4 w-4 ${post.savedByMe ? "fill-current" : ""}`} /> {post.savedByMe ? "Saved" : "Save"}
            </button>
            {giftingOn && !isAuthor ? (
              <button
                type="button"
                onClick={() => setGiftOpen((o) => !o)}
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-surface-600 transition hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800"
              >
                <Gift className="h-4 w-4" />
                {typeof post.giftTotal === "number" && post.giftTotal > 0 ? money(post.giftTotal) : "Gift"}
              </button>
            ) : null}
            {isAuthor ? (
              <button
                type="button"
                onClick={() => void loadGifts()}
                className="ml-auto flex items-center gap-1 rounded-xl px-3 py-1.5 text-sm text-surface-500 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
              >
                <Gift className="h-4 w-4" /> {giftsOpen ? "Hide gifts" : "View gifts received"}
              </button>
            ) : null}
          </div>

          {isAuthor && giftsOpen && gifts ? (
            <div className="mt-3 rounded-2xl border border-surface-200 bg-surface-50 p-4 dark:border-surface-800 dark:bg-surface-800/40">
              <p className="text-xs font-black uppercase tracking-widest text-surface-400">Gifts received</p>
              {gifts.length === 0 ? (
                <p className="mt-2 text-sm text-surface-500">No gifts yet.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {gifts.map((g) => (
                    <li key={g.id} className="flex items-center justify-between text-sm">
                      <span className="text-surface-700 dark:text-surface-300">
                        {g.sender?.fullName || "Member"} · {timeAgo(g.createdAt)}
                      </span>
                      <span className="font-semibold text-surface-900 dark:text-white">
                        {money(Number(g.amount))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {giftOpen ? (
            <div className="mt-3 rounded-2xl border border-surface-200 bg-surface-50 p-4 dark:border-surface-800 dark:bg-surface-800/40">
              <p className="text-sm font-bold text-surface-900 dark:text-white">Send a gift</p>
              <p className="mt-0.5 text-xs text-surface-500">Debits your wallet and credits the author's.</p>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {GIFT_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setGiftPreset(n);
                      setCustomGift("");
                    }}
                    className={`rounded-xl border px-2 py-2.5 text-sm font-semibold transition ${
                      giftPreset === n
                        ? "border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300"
                        : "border-surface-200 text-surface-700 hover:bg-surface-100 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
                    }`}
                  >
                    {money(n)}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min={5}
                max={500}
                step="0.01"
                placeholder="Custom (₹5 – ₹500)"
                value={customGift}
                onChange={(e) => {
                  setCustomGift(e.target.value);
                  setGiftPreset(null);
                }}
                className="mt-2 w-full rounded-xl border border-surface-200 bg-white px-3 py-2.5 text-sm text-surface-900 outline-none focus:border-primary-400 dark:border-surface-700 dark:bg-surface-900 dark:text-white"
              />
              <button
                type="button"
                disabled={giftBusy}
                onClick={() => void sendGift()}
                className="mt-3 w-full rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-600 disabled:opacity-50"
              >
                {giftBusy ? "Sending…" : "Send gift"}
              </button>
              {giftNote ? (
                <p className={`mt-2 text-xs ${giftNote.includes("credited") ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {giftNote}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </article>

      {reportOpen ? (
        <div className="rounded-3xl border border-surface-200 bg-white p-5 shadow-card dark:border-surface-800 dark:bg-surface-900">
          <p className="text-sm font-bold text-surface-900 dark:text-white">Report this post</p>
          <p className="mt-0.5 text-xs text-surface-500">Admins review every report. Duplicates are blocked.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {REPORT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReportReason(r)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                  reportReason === r
                    ? "border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300"
                    : "border-surface-200 text-surface-600 hover:bg-surface-100 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            value={reportNote}
            onChange={(e) => setReportNote(e.target.value)}
            placeholder="Anything else we should know? (optional)"
            rows={2}
            className="mt-3 w-full resize-none rounded-xl border border-surface-200 bg-surface-50 p-3 text-sm text-surface-900 outline-none focus:border-primary-400 dark:border-surface-700 dark:bg-surface-800 dark:text-white"
          />
          <div className="mt-3 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setReportOpen(false)}
              className="rounded-xl border border-surface-200 px-4 py-2 text-sm font-medium text-surface-600 dark:border-surface-700 dark:text-surface-300"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={reportBusy}
              onClick={() => void submitReport()}
              className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
            >
              {reportBusy ? "Submitting…" : "Submit report"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="rounded-3xl border border-surface-200 bg-white p-4 shadow-card dark:border-surface-800 dark:bg-surface-900">
        {replyTo ? (
          <div className="mb-2 text-xs text-primary-600 dark:text-primary-400">
            Replying to a comment —{" "}
            <button type="button" onClick={() => setReplyTo(null)} className="underline">
              cancel
            </button>
          </div>
        ) : null}
        <div className="flex items-center gap-3">
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendComment();
              }
            }}
            placeholder={replyTo ? "Write a reply…" : "Add a comment…"}
            maxLength={1000}
            className="flex-1 rounded-2xl border border-surface-200 bg-surface-50 px-4 py-2.5 text-sm text-surface-900 outline-none focus:border-primary-400 dark:border-surface-700 dark:bg-surface-800 dark:text-white"
          />
          <button
            type="button"
            disabled={commentsBusy || !commentText.trim()}
            onClick={() => void sendComment()}
            className="rounded-2xl bg-primary-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-600 disabled:opacity-50"
          >
            Send
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {comments.length === 0 ? (
            <p className="py-3 text-center text-sm text-surface-500">No comments yet. Start the conversation.</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="rounded-2xl border border-surface-200/70 bg-surface-50 p-3 dark:border-surface-800 dark:bg-surface-800/40">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-surface-900 dark:text-white">{c.author?.fullName || "Member"}</p>
                  <p className="text-[11px] text-surface-400">{timeAgo(c.createdAt)}</p>
                  {c.isMine ? (
                    <button type="button" onClick={() => void deleteComment(c.id)} className="ml-auto text-[11px] font-medium text-red-500 hover:text-red-600">
                      Delete
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-surface-800 dark:text-surface-100">{c.content}</p>
                {c.parentId === null ? (
                  <button type="button" onClick={() => setReplyTo(c.id)} className="mt-1 text-xs font-semibold text-primary-600 dark:text-primary-400">
                    Reply
                  </button>
                ) : null}

                {c._count?.replies ? (
                  <button
                    type="button"
                    onClick={() => void toggleReplies(c.id)}
                    className="mt-1 flex items-center gap-1 text-xs font-medium text-surface-500 hover:text-surface-700 dark:hover:text-surface-300"
                  >
                    {expanded[c.id] ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {expanded[c.id] ? "Hide replies" : `${c._count.replies} replies`}
                  </button>
                ) : null}

                {repliesBusy[c.id] ? <p className="mt-2 text-xs text-surface-400">Loading replies…</p> : null}
                {expanded[c.id] ? (
                  <div className="mt-2 space-y-2 border-l-2 border-surface-200 pl-3 dark:border-surface-700">
                    {expanded[c.id].length === 0 ? (
                      <p className="text-xs text-surface-400">No replies yet.</p>
                    ) : (
                      expanded[c.id].map((r) => (
                        <div key={r.id}>
                          <p className="text-xs font-semibold text-surface-900 dark:text-white">
                            {r.author?.fullName || "Member"} <span className="font-normal text-surface-400">· {timeAgo(r.createdAt)}</span>
                          </p>
                          <p className="mt-0.5 text-sm text-surface-700 dark:text-surface-300">{r.content}</p>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}