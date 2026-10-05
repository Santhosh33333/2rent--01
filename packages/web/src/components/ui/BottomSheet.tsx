import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Bottom sheet for choices that belong to the screen the user is already on.
 *
 * Deliberately not Modal with a className. A sheet is thumb-reachable and slides
 * from the bottom edge; a centred dialog reads as a separate destination. Mixing
 * the two makes navigation feel unpredictable.
 *
 * Drag-to-dismiss is intentionally not implemented. It needs gesture handling
 * that has to agree with the page scroll, and a sheet that fights a scroll
 * gesture is worse than one without the affordance. Tapping the backdrop, the
 * close button, and Escape all work.
 */

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Rendered above the content and below the handle, so it stays reachable. */
  footer?: ReactNode;
  dismissible?: boolean;
}

export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
}: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose, dismissible]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm motion-safe:animate-fade-in"
        onClick={dismissible ? onClose : undefined}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className="relative z-10 max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border-t border-slate-200 bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-float motion-safe:animate-slide-up dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="sticky top-0 z-10 bg-white/95 px-5 pb-3 pt-3 backdrop-blur dark:bg-slate-900/95">
          <div
            aria-hidden
            className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600"
          />
          {(title || dismissible) && (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                {title && (
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {title}
                  </h2>
                )}
                {description && (
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {description}
                  </p>
                )}
              </div>
              {dismissible && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="btn btn-ghost btn-xs shrink-0"
                >
                  Close
                </button>
              )}
            </div>
          )}
        </div>

        <div className="px-5">{children}</div>
        {footer && <div className="mt-5 px-5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}