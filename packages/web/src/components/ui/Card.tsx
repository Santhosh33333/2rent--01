import type { ElementType, HTMLAttributes, ReactNode } from "react";

/**
 * Card surface.
 *
 * `interactive` is opt-in rather than inferred from an onClick, because a card
 * that looks tappable but is a container is worse than one that looks flat. When
 * it is on, the card becomes a real button for keyboard users too, not just
 * something with a hover shadow.
 *
 * `as` lets a card be a link without nesting an interactive element inside
 * another, which is invalid HTML and breaks keyboard navigation.
 */

export type CardVariant = "default" | "elevated" | "glass" | "outline" | "feature";
export type CardPadding = "none" | "sm" | "md" | "lg";
export type CardTag = "div" | "section" | "article" | "li";

const VARIANTS: Record<CardVariant, string> = {
  default: "glass-card",
  elevated: "glass-elevated",
  glass: "glass-card-static",
  outline: "rounded-2xl border border-slate-200 bg-transparent dark:border-slate-700/60",
  feature:
    "rounded-2xl border border-slate-200/80 bg-white dark:border-slate-700/50 dark:bg-slate-900/60",
};

const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

/**
 * Generic in the element type so `as="li"` and `as="article"` accept their own
 * attributes. Without the parameter, props are fixed to HTMLDivElement and
 * passing them to a <li> fails to type-check on handlers like onCopy, whose
 * element type is narrower than HTMLElement.
 */
export type CardProps<E extends HTMLElement = HTMLDivElement> = {
  variant?: CardVariant;
  padding?: CardPadding;
  interactive?: boolean;
  as?: CardTag;
} & HTMLAttributes<E>;

export function Card<E extends HTMLElement = HTMLDivElement>({
  variant = "default",
  padding = "md",
  interactive = false,
  as = "div",
  className = "",
  children,
  ...rest
}: CardProps<E>) {
  const classes = [
    VARIANTS[variant],
    PADDING[padding],
    interactive
      ? "cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none dark:focus-visible:ring-offset-slate-900"
      : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // Polymorphic tag plus widened props: the element type is chosen by the
  // caller, so a single cast is the honest boundary rather than four
  // near-identical branches.
  const Tag = as as ElementType;
  return (
    <Tag className={classes} {...(rest as HTMLAttributes<HTMLElement>)}>
      {children}
    </Tag>
  );
}

/** Small label above a card's content. Keeps headings consistent across screens. */
export function CardTitle({
  children,
  action,
  className = "",
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-3 flex items-center justify-between gap-3 ${className}`}>
      <h3 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
        {children}
      </h3>
      {action}
    </div>
  );
}