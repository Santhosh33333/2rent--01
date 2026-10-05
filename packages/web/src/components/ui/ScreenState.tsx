import type { ReactNode } from "react";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { Button } from "./Button";

/**
 * The three states every API screen needs, in one component.
 *
 * This exists because "no nearby partners available" is a real answer and a
 * blank screen is indistinguishable from a bug. Centralising the states is what
 * makes that guarantee hold: a screen that renders its own ad-hoc spinner has to
 * remember all four cases, and new screens will not.
 *
 * `error` deliberately shows a Retry button. A dead end with no way forward is
 * worse than the failure it is reporting, because the user cannot tell whether
 * retrying would help.
 */

export function ScreenState({
  kind,
  title,
  message,
  onRetry,
  retryLabel = "Try again",
  icon,
  action,
  compact = false,
}: {
  kind: "loading" | "empty" | "error";
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: ReactNode;
  action?: ReactNode;
  /** Tighten spacing for use inside a card or a panel rather than a page. */
  compact?: boolean;
}) {
  if (kind === "loading") return <LoadingState compact={compact} />;

  const isError = kind === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={`flex flex-col items-center justify-center text-center ${
        compact ? "px-4 py-8" : "px-6 py-14"
      }`}
    >
      <div
        className={`mb-3 flex items-center justify-center rounded-2xl ${
          compact ? "h-11 w-11" : "h-14 w-14"
        } ${
          isError
            ? "bg-danger-50 text-danger-600 dark:bg-danger-500/10 dark:text-danger-400"
            : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
        }`}
      >
        {icon ?? (isError ? <AlertTriangle className="h-6 w-6" /> : <Inbox className="h-6 w-6" />)}
      </div>

      <p
        className={`font-semibold text-slate-900 dark:text-white ${
          compact ? "text-sm" : "text-base"
        }`}
      >
        {title ?? (isError ? "Something went wrong" : "Nothing here yet")}
      </p>

      {message && (
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          {message}
        </p>
      )}

      {(onRetry || action) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onRetry}
              icon={<RefreshCw className="h-4 w-4" />}
            >
              {retryLabel}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

export function LoadingState({ compact = false }: { compact?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={`flex flex-col items-center justify-center ${compact ? "py-8" : "py-14"}`}
    >
      <span
        aria-hidden
        className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-primary-500 motion-reduce:animate-none dark:border-slate-700 dark:border-t-primary-400"
      />
      <span className="sr-only">Loading</span>
    </div>
  );
}

/**
 * Placeholder that matches the shape of the content it replaces.
 *
 * Matching the final layout is the point: a skeleton that resizes into its
 * replacement causes the content the user was reading to shift under them, which
 * is worse than a slightly longer wait.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`skeleton motion-reduce:animate-none ${className}`}
    />
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="glass-card p-4" aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-1/3 rounded" />
          <Skeleton className="h-3 w-1/2 rounded" />
        </div>
      </div>
      {lines > 2 && <Skeleton className="mt-3 h-3 w-4/5 rounded" />}
    </div>
  );
}

export function ListSkeleton({ count = 4, lines = 3 }: { count?: number; lines?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} lines={lines} />
      ))}
    </div>
  );
}