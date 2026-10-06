import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, Bookmark, MessageCircle, Gift, ChevronRight } from "lucide-react";
import { api, assetUrl } from "../../lib/api";
import { postApi } from "../../lib/api";
import { useFeatureFlag } from "../../hooks/useFeatureFlag";
import { Avatar } from "../../components/Avatar";
import { useAuth } from "../../lib/auth";
import type { FeedPost, FeedPageData } from "../../types/post";

const PAGE_SIZE = 20;

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

function visibilityLabel(visibility: string): string {
  if (visibility === "FOLLOWERS") return "Friends";
  if (visibility === "PRIVATE") return "Private";
  return "Everyone";
}

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const res = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (res) return res;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export function FeedPage() {
  const { user } = useAuth();
  const postsOn = useFeatureFlag("POSTS", true);

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<{ data?: FeedPageData }>("/posts", {
        params: { page: 1, limit: PAGE_SIZE },
      });
      const data = res.data?.data;
      setPosts(data?.items ?? []);
      setTotal(data?.total ?? 0);
      setPage(1);
    } catch (err) {
      setError(errorMessage(err, "Could not load the feed right now."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading) return;
    const next = page + 1;
    if (page * PAGE_SIZE >= total) return;
    setLoadingMore(true);
    try {
      const res = await api.get<{ data?: FeedPageData }>("/posts", {
        params: { page: next, limit: PAGE_SIZE },
      });
      const data = res.data?.data;
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...(data?.items ?? []).filter((p) => !seen.has(p.id))];
      });
      setPage(next);
      setTotal(data?.total ?? total);
    } catch {
      // Keep the sentinel visible so the user can retry by scrolling.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loading, page, total]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !postsOn) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "400px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore, postsOn]);

  const toggleLike = async (postId: string) => {
    const idx = posts.findIndex((p) => p.id === postId);
    if (idx === -1) return;
    const prev = posts[idx];
    setPosts((ps) =>
      ps.map((p) =>
        p.id === postId
          ? {
              ...p,
              likedByMe: !p.likedByMe,
              _count: { ...(p._count ?? { likes: 0, comments: 0, gifts: 0 }), likes: (p._count?.likes ?? 0) + (p.likedByMe ? -1 : 1) },
            }
          : p
      )
    );
    try {
      const data = (await postApi.toggleLike(postId).then((r) => r.data?.data)) as
        | { liked: boolean; likeCount: number }
        | undefined;
      if (data) {
        setPosts((ps) =>
          ps.map((p) =>
            p.id === postId
              ? { ...p, likedByMe: data.liked, _count: { likes: data.likeCount, comments: p._count?.comments ?? 0, gifts: p._count?.gifts ?? 0 } }
              : p
          )
        );
      }
    } catch {
      setPosts((ps) => ps.map((p) => (p.id === postId ? prev : p)));
    }
  };

  const toggleSave = async (postId: string) => {
    const prev = posts.find((p) => p.id === postId);
    setPosts((ps) => ps.map((p) => (p.id === postId ? { ...p, savedByMe: !p.savedByMe } : p)));
    try {
      const data = (await postApi.toggleSave(postId).then((r) => r.data?.data)) as
        | { saved: boolean }
        | undefined;
      if (data) {
        setPosts((ps) => ps.map((p) => (p.id === postId ? { ...p, savedByMe: data.saved } : p)));
      }
    } catch {
      if (prev) setPosts((ps) => ps.map((p) => (p.id === postId ? prev : p)));
    }
  };

  if (!postsOn) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold font-display">Feed</h1>
        </div>
        <div className="rounded-3xl border border-dashed border-surface-300 bg-surface-100 p-8 text-center dark:border-surface-700 dark:bg-surface-900">
          <p className="text-xs font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
            Not configured
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-surface-600 dark:text-surface-400">
            Nabri posts are behind the feature flag and are not switched on for this deployment.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-display">Feed</h1>
          <p className="text-sm text-surface-500 dark:text-surface-400">
            Posts from people around you.
          </p>
        </div>
        <Link
          to="/feed/new"
          className="rounded-2xl bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/25 transition hover:bg-primary-600"
        >
          ✏️ New post
        </Link>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-48 rounded-3xl" />
          ))}
        </div>
      ) : null}

      {!loading && posts.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-surface-300 bg-surface-100 p-10 text-center dark:border-surface-700 dark:bg-surface-900">
          <p className="text-sm text-surface-600 dark:text-surface-400">
            No posts yet. Be the first to publish one.
          </p>
        </div>
      ) : null}

      <div className="space-y-4">
        {posts.map((post) => (
          <article
            key={post.id}
            className="overflow-hidden rounded-3xl border border-surface-200 bg-white shadow-card dark:border-surface-800 dark:bg-surface-900"
          >
            <Link to={`/feed/${post.id}`} className="block p-4">
              <div className="flex items-center gap-3">
                <Avatar src={post.author?.avatarUrl} name={post.author?.fullName || "Member"} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-surface-900 dark:text-white">
                    {post.author?.fullName || "Member"}
                  </p>
                  <p className="text-xs text-surface-500">
                    {timeAgo(post.createdAt)} · {visibilityLabel(post.visibility)}
                  </p>
                </div>
              </div>

              {post.content ? (
                <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-surface-800 dark:text-surface-100">
                  {post.content}
                </p>
              ) : null}

              {post.imageUrl ? (
                <img
                  src={assetUrl(post.imageUrl)}
                  alt=""
                  loading="lazy"
                  className="mt-3 max-h-[420px] w-full rounded-2xl object-cover"
                />
              ) : null}

              {post.videoUrl ? (
                <video
                  src={assetUrl(post.videoUrl)}
                  controls
                  preload="metadata"
                  playsInline
                  className="mt-3 max-h-[420px] w-full rounded-2xl bg-black"
                />
              ) : null}
            </Link>

            <div className="flex items-center gap-2 border-t border-surface-100 px-4 py-2.5 dark:border-surface-800">
              <button
                type="button"
                onClick={() => void toggleLike(post.id)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm transition ${
                  post.likedByMe
                    ? "text-red-500"
                    : "text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800"
                }`}
              >
                <Heart className={`h-4 w-4 ${post.likedByMe ? "fill-current" : ""}`} />
                {post._count?.likes ?? 0}
              </button>
              <Link
                to={`/feed/${post.id}`}
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-surface-600 transition hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800"
              >
                <MessageCircle className="h-4 w-4" />
                {post._count?.comments ?? 0}
              </Link>
              <button
                type="button"
                onClick={() => void toggleSave(post.id)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm transition ${
                  post.savedByMe
                    ? "text-primary-600 dark:text-primary-400"
                    : "text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800"
                }`}
              >
                <Bookmark className={`h-4 w-4 ${post.savedByMe ? "fill-current" : ""}`} />
                {post.savedByMe ? "Saved" : "Save"}
              </button>
              <Link
                to={`/feed/${post.id}`}
                className="ml-auto flex items-center gap-1 rounded-xl px-2 py-1.5 text-sm text-surface-500 transition hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
              >
                <Gift className="h-4 w-4" />
                {typeof post.giftTotal === "number" && post.giftTotal > 0
                  ? `₹${post.giftTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
                  : "Gift"}
              </Link>
            </div>
          </article>
        ))}
      </div>

      <div ref={sentinelRef} className="flex justify-center py-3">
        {loadingMore ? (
          <div className="skeleton h-10 w-40 rounded-2xl" />
        ) : page * PAGE_SIZE < total ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            className="flex items-center gap-1 text-sm font-medium text-primary-600 dark:text-primary-400"
          >
            Load more {total - page * PAGE_SIZE > 0 ? `(${Math.min(PAGE_SIZE, total - page * PAGE_SIZE)})` : ""}
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : posts.length > 0 ? (
          <p className="text-xs text-surface-400">
            You're all caught up, {user?.name?.split(" ")[0] || "friend"}.
          </p>
        ) : null}
      </div>
    </div>
  );
}