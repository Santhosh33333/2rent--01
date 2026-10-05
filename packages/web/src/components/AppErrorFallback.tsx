/**
 * Full-screen fallback for the app-level ErrorBoundary.
 *
 * This exists because the previous version of this screen threw the actual
 * error away. It showed "This page could not load / Please reload the app" and
 * a Reload button, so a user on a phone had no way to report *what* broke --
 * `componentDidCatch` logs to the console, but nobody can open a console on a
 * handset without USB debugging attached. That made every crash of this kind
 * unreportable and therefore unfixable.
 *
 * So: the message is shown, the stack is copyable in one tap, and the details
 * are persisted so they survive the reload the user is about to perform.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Copy, RefreshCw, Check, Share2 } from 'lucide-react';

const LAST_ERROR_KEY = 'nabri-last-error';

export function AppErrorFallback({ error }: { error: Error }) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const details = useCallback(() => {
    const lines = [
      `message: ${error.message}`,
      `name: ${error.name}`,
      `href: ${typeof window !== 'undefined' ? window.location.href : '(no window)'}`,
      `ua: ${typeof navigator !== 'undefined' ? navigator.userAgent : '(no navigator)'}`,
      `at: ${new Date().toISOString()}`,
      '',
      error.stack || '(no stack)',
    ];
    return lines.join('\n');
  }, [error]);

  const text = details();

  // Persist before the user reloads, otherwise the evidence is gone.
  useEffect(() => {
    try {
      localStorage.setItem(LAST_ERROR_KEY, text);
    } catch {
      /* private mode / quota - the on-screen message is still useful */
    }
  }, [text]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked in some WebViews; selecting the text still lets
      // the user copy it by hand, so this is not treated as fatal.
      setCopied(false);
    }
  }, [text]);

  // Sharing is the primary path on a phone: this screen is only ever seen on
  // a device, and copy-then-paste-into-another-app is a step too many when the
  // whole point is getting the details off the handset. Falls back silently to
  // the copy button where Web Share is unavailable.
  const share = useCallback(async () => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (typeof nav.share !== 'function') {
      await copy();
      return;
    }
    try {
      await nav.share({
        title: 'Nabri crash report',
        text: `Nabri crashed on this screen.\n\n${text}`,
      });
      setShared(true);
      window.setTimeout(() => setShared(false), 2000);
    } catch {
      // AbortError when the user dismisses the sheet; nothing to do.
    }
  }, [copy, text]);

  const isChunkProblem = /chunk|import|fetch/i.test(error.message);

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-surface-50 dark:bg-surface-950">
      <div className="w-full max-w-lg text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-danger-50 dark:bg-danger-500/10 mb-4">
          <AlertTriangle className="w-7 h-7 text-danger-500" aria-hidden="true" />
        </div>

        <h1 className="text-xl font-bold text-surface-900 dark:text-white">
          This page could not load
        </h1>

        <p className="mt-2 text-sm text-surface-500 dark:text-surface-400">
          {isChunkProblem
            ? 'The app was updated while this page was open. Reload to get the latest version.'
            : 'Please reload the app and try again.'}
        </p>

        {/* The reason this screen exists: do not make the user guess. */}
        <details className="mt-5 text-left">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400 select-none">
            Show error details
          </summary>
          <pre
            className="mt-2 max-h-52 overflow-auto rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-900 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-surface-700 dark:text-surface-300"
            // Selectable so it can be copied by hand when the Clipboard API is
            // unavailable, which it is on some Android WebViews.
            style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
          >
            {text}
          </pre>
        </details>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-2xl bg-primary-600 px-6 py-3 text-sm font-semibold text-white"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Reload app
          </button>
          <button
            onClick={copy}
            className="inline-flex items-center gap-2 rounded-2xl border border-surface-300 dark:border-surface-600 px-5 py-3 text-sm font-semibold text-surface-700 dark:text-surface-200"
          >
            {copied ? (
              <Check className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Copy className="w-4 h-4" aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy details'}
          </button>
          <button
            onClick={share}
            className="inline-flex items-center gap-2 rounded-2xl border border-surface-300 dark:border-surface-600 px-5 py-3 text-sm font-semibold text-surface-700 dark:text-surface-200"
          >
            {shared ? (
              <Check className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Share2 className="w-4 h-4" aria-hidden="true" />
            )}
            {shared ? 'Shared' : 'Share'}
          </button>
        </div>

        <p className="mt-4 text-xs text-surface-400 dark:text-surface-500">
          {shared || copied
            ? 'Thank you - that is exactly what is needed to fix it.'
            : 'Sending these details makes this fixable.'}
        </p>
      </div>
    </div>
  );
}

/** Reads back whatever the last crash recorded, for support/debugging. */
export function readLastAppError(): string | null {
  try {
    return localStorage.getItem(LAST_ERROR_KEY);
  } catch {
    return null;
  }
}