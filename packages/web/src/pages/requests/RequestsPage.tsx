import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Calendar, Heart } from "lucide-react";
import { Avatar } from "../../components/Avatar";
import { ListSkeleton, ScreenState } from "../../components/ui";
import {
  fetchMyBookings,
  fetchReceivedLikes,
  mergeRequests,
  type UnifiedRequest,
} from "./requestsApi";

/**
 * Requests tab.
 *
 * One inbox for "things waiting on me": service bookings and received dating
 * likes. Both halves come from live endpoints, and either half failing degrades
 * to the other rather than emptying the screen.
 */
export function RequestsPage() {
  const [items, setItems] = useState<UnifiedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Which source failed, so the message can be specific instead of vague. */
  const [partial, setPartial] = useState<string[]>([]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    const [bookingsResult, likesResult] = await Promise.allSettled([
      fetchMyBookings(signal),
      fetchReceivedLikes(signal),
    ]);

    if (signal?.aborted) return;

    const failed: string[] = [];
    if (bookingsResult.status === "rejected") failed.push("bookings");
    if (likesResult.status === "rejected") failed.push("likes");

    const bookings = bookingsResult.status === "fulfilled" ? bookingsResult.value : [];
    const likes = likesResult.status === "fulfilled" ? likesResult.value : [];

    // Only a total failure is an error state; one dead source is a partial one.
    if (failed.length === 2) {
      setError("We couldn't load your requests.");
      setItems([]);
    } else {
      setPartial(failed);
      setItems(mergeRequests(bookings, likes));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const needsAction = items.filter((i) => i.stage === "action").length;

  return (
    <div className="mx-auto w-full max-w-2xl pb-24">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-surface-900 dark:text-white">
          Requests
        </h1>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
          {loading
            ? "Checking what needs you"
            : needsAction > 0
              ? `${needsAction} ${needsAction === 1 ? "request needs" : "requests need"} your attention`
              : "Nothing needs you right now"}
        </p>
      </header>

      {partial.length > 0 && (
        <p className="mb-4 rounded-2xl border border-warning-500/30 bg-warning-50 px-4 py-3 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-300">
          Showing partial results. Could not load{" "}
          {partial.length === 1 ? partial[0] : "all sources"}.
        </p>
      )}

      {loading ? (
        <ListSkeleton count={4} />
      ) : error ? (
        <ScreenState kind="error" title="Couldn't load requests" message={error} onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <ScreenState
          kind="empty"
          icon={<Calendar className="h-6 w-6" />}
          title="No requests yet"
          message="When you book a companion service or someone likes you, it shows up here."
          action={
            <Link
              to="/discover"
              className="btn btn-primary btn-sm inline-flex no-underline"
            >
              Browse services
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {items.map((item, index) => (
              <RequestRow key={item.key} item={item} index={index} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

function RequestRow({ item, index }: { item: UnifiedRequest; index: number }) {
  const Icon = item.kind === "like" ? Heart : Calendar;

  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3), duration: 0.28 }}
    >
      <Link
        to={item.href}
        className={`flex items-center gap-3 rounded-2xl border p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover motion-reduce:transform-none motion-reduce:transition-none ${
          item.stage === "action"
            ? "border-primary-500/40 bg-primary-500/[0.04]"
            : "border-surface-200/70 bg-surface-50/50 dark:border-surface-800/70 dark:bg-surface-900/40"
        }`}
      >
        <div className="relative shrink-0">
          <Avatar src={item.avatarUrl} name={item.title} className="h-12 w-12" />
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-surface-900 text-white ring-2 ring-surface-50 dark:bg-surface-100 dark:text-surface-900 dark:ring-surface-900">
            <Icon className="h-2.5 w-2.5" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-surface-900 dark:text-white">
            {item.title}
          </p>
          <p className="truncate text-xs text-surface-500 dark:text-surface-400">
            {item.subtitle}
          </p>
        </div>

        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize ${
            item.stage === "action"
              ? "bg-primary-500/15 text-primary-700 dark:text-primary-300"
              : "bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300"
          }`}
        >
          {item.statusLabel}
        </span>
      </Link>
    </motion.li>
  );
}

export default RequestsPage;