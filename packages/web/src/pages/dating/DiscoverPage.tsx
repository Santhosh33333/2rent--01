import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchDiscover,
  sendSwipe,
  ageFrom,
  type DiscoverProfile,
  type SwipeType,
} from "./datingApi";

const SWIPE_DISTANCE = 110;

export function DiscoverPage() {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<DiscoverProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState<DiscoverProfile | null>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const results = await fetchDiscover({}, signal);
      setQueue(results);
    } catch (e) {
      if ((e as { code?: string })?.code === "ERR_CANCELED") return;
      setError("Could not load profiles. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const act = useCallback(
    async (type: SwipeType) => {
      const current = queue[0];
      if (!current || busy) return;
      setBusy(true);
      setQueue((q) => q.slice(1));
      setDrag({ x: 0, y: 0 });
      try {
        const res = await sendSwipe(current.id, type);
        if (res.isMatch) setMatch(current);
      } catch {
        setError("That action did not go through.");
      } finally {
        setBusy(false);
      }
    },
    [queue, busy],
  );

  // Pointer gestures: drag right to like, drag left to pass.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragStart.current) return;
      setDrag({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y,
      });
    };
    const onUp = () => {
      if (!dragStart.current) return;
      const { x } = drag;
      dragStart.current = null;
      if (x > SWIPE_DISTANCE) void act("LIKE");
      else if (x < -SWIPE_DISTANCE) void act("PASS");
      else setDrag({ x: 0, y: 0 });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [act]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") void act("PASS");
    if (e.key === "ArrowRight") void act("LIKE");
  };

  const current = queue[0];
  const age = current ? ageFrom(current.dateOfBirth) : null;
  const rotate = (drag.x / SWIPE_DISTANCE) * 12;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-4 py-5">
        <h1 className="text-xl font-semibold">Discover</h1>
        <button
          onClick={() => load()}
          className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Refresh
        </button>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-32">
        {error && (
          <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex h-[60vh] items-center justify-center">
            <span className="text-sm text-slate-400">Loading profiles…</span>
          </div>
        ) : !current ? (
          <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
            <p className="text-slate-300">You&apos;ve seen everyone nearby for now.</p>
            <button
              onClick={() => load()}
              className="rounded-full bg-white px-6 py-3 text-sm font-medium text-slate-900"
            >
              Check again
            </button>
          </div>
        ) : (
          <div
            className="relative h-[62vh] select-none"
            onKeyDown={onKeyDown}
            tabIndex={0}
          >
            {/* stacked preview card */}
            {queue[1] && (
              <div className="absolute inset-0 scale-[0.96] rounded-3xl bg-slate-900 opacity-60" />
            )}

            <div
              ref={cardRef}
              onPointerDown={(e) => {
                dragStart.current = { x: e.clientX, y: e.clientY };
              }}
              style={{
                transform: `translate(${drag.x}px, ${drag.y}px) rotate(${rotate}deg)`,
                transition: dragStart.current ? "none" : "transform 220ms ease-out",
              }}
              className="absolute inset-0 overflow-hidden rounded-3xl bg-slate-900 shadow-2xl"
            >
              {current.avatarUrl ? (
                <img
                  src={current.avatarUrl}
                  alt={current.fullName}
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-gradient-to-br from-indigo-900 to-slate-900">
                  <span className="text-5xl font-semibold text-slate-700">
                    {current.fullName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}

              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-5">
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-semibold">
                    {current.fullName}
                    {age !== null && <span className="font-normal text-white/80">, {age}</span>}
                  </h2>
                  {current.mobileVerified && (
                    <span
                      title="Verified"
                      className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300"
                    >
                      Verified
                    </span>
                  )}
                </div>
                {current.city && <p className="mt-0.5 text-sm text-white/70">{current.city}</p>}
                {current.bio && <p className="mt-2 line-clamp-2 text-sm text-white/90">{current.bio}</p>}
              </div>

              {/* swipe intent hints */}
              {drag.x > 40 && (
                <span className="absolute left-6 top-6 rotate-[-12deg] rounded-lg border-4 border-emerald-400 px-4 py-1 text-2xl font-bold text-emerald-400">
                  LIKE
                </span>
              )}
              {drag.x < -40 && (
                <span className="absolute right-6 top-6 rotate-[12deg] rounded-lg border-4 border-rose-400 px-4 py-1 text-2xl font-bold text-rose-400">
                  PASS
                </span>
              )}
            </div>
          </div>
        )}
      </main>

      {current && !loading && (
        <nav className="fixed inset-x-0 bottom-0 mx-auto flex max-w-2xl items-center justify-center gap-3 border-t border-slate-800 bg-slate-950/95 px-4 py-4 backdrop-blur">
          <button
            aria-label="Pass"
            onClick={() => act("PASS")}
            disabled={busy}
            className="h-14 w-14 rounded-full border border-slate-700 text-xl text-slate-300 hover:bg-slate-800 disabled:opacity-40"
          >
            ✕
          </button>
          <button
            aria-label="Super like"
            onClick={() => act("SUPER_LIKE")}
            disabled={busy}
            className="h-14 w-14 rounded-full border border-blue-500/60 text-xl text-blue-300 hover:bg-blue-500/10 disabled:opacity-40"
          >
            ★
          </button>
          <button
            aria-label="Like"
            onClick={() => act("LIKE")}
            disabled={busy}
            className="h-14 w-16 rounded-full bg-rose-500 text-2xl text-white hover:bg-rose-600 disabled:opacity-40"
          >
            ♥
          </button>
        </nav>
      )}

      {match && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-slate-950/95 px-6 text-center"
        >
          <h2 className="text-3xl font-semibold">It&apos;s a Match!</h2>
          <p className="text-slate-300">
            You and {match.fullName} liked each other.
          </p>
          <div className="flex items-center gap-4">
            {match.avatarUrl && (
              <img
                src={match.avatarUrl}
                alt={match.fullName}
                className="h-24 w-24 rounded-full object-cover"
              />
            )}
          </div>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => {
                setMatch(null);
                navigate("/messages");
              }}
              className="rounded-full bg-white px-8 py-3 font-medium text-slate-900"
            >
              Start chat
            </button>
            <button
              onClick={() => setMatch(null)}
              className="rounded-full border border-slate-700 px-8 py-3 text-slate-300"
            >
              Keep browsing
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DiscoverPage;