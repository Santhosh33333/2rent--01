import { useEffect, useRef, useState } from "react";
import { useAppLock } from "../lib/appLock";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

export function LockScreen() {
  const { verify, lockoutSecondsLeft, signOut } = useAppLock();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (value: string) => {
    if (busy || value.length < 4) return;
    setBusy(true);
    setError("");
    const ok = await verify(value);
    if (!ok) {
      setError(lockoutSecondsLeft > 0 ? `Too many attempts. Try again in ${lockoutSecondsLeft}s.` : "Wrong PIN. Try again.");
      setTimeout(() => setError(""), 900);
      setPin("");
    }
    setBusy(false);
  };

  const type = (k: string) => {
    if (k === "⌫") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (k && pin.length < 6) {
      const next = pin + k;
      setPin(next);
      if (next.length >= 4) void submit(next);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        type(e.key);
      } else if (e.key === "Backspace") {
        setPin((p) => p.slice(0, -1));
      } else if (e.key === "Enter") {
        void submit(pin);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-5" role="dialog" aria-modal="true" aria-label="App locked">
      <div className="absolute inset-0 bg-gradient-to-b from-primary-950 via-primary-900 to-surface-950" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgb(var(--c-500)/0.18),transparent_60%)]" />
      <input ref={inputRef} className="sr-only" aria-hidden="true" autoFocus />
      <div className="relative w-full max-w-xs text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-900/60 ring-1 ring-white/10 backdrop-blur">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="4" y="11" width="16" height="10" rx="2" fill="rgb(var(--c-500)/0.25)" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>
        <h1 className="font-display text-2xl font-bold text-white">Nabri · App locked</h1>
        <p className="mt-1 text-sm text-white/70">Enter your PIN to continue</p>

        <div className="mt-6 flex justify-center gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className={`h-3 w-3 rounded-full transition-all ${
                i < pin.length ? "bg-primary-400 scale-110" : "bg-white/20"
              } ${error && i === pin.length - 1 ? "bg-red-400" : ""}`}
            />
          ))}
        </div>
        {error && <p className="mt-3 text-sm font-medium text-red-300">{error}</p>}
        {lockoutSecondsLeft > 0 && (
          <p className="mt-3 text-sm font-medium text-amber-300">Locked for {lockoutSecondsLeft}s</p>
        )}

        <div className="mx-auto mt-7 grid max-w-[240px] grid-cols-3 gap-2">
          {KEYS.map((k, i) =>
            k ? (
              <button
                key={i}
                type="button"
                onClick={() => type(k)}
                className="h-14 rounded-2xl bg-white/10 text-xl font-semibold text-white backdrop-blur transition active:scale-95 active:bg-primary-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              >
                {k}
              </button>
            ) : (
              <span key={i} />
            )
          )}
        </div>

        <button
          type="button"
          onClick={signOut}
          className="mt-8 text-sm font-medium text-white/60 underline-offset-4 transition hover:text-white"
        >
          Forgot PIN? Sign in again
        </button>
      </div>
    </div>
  );
}