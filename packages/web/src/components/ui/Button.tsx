import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * The one button in the app.
 *
 * Before this, three files styled buttons three different ways: WalletPage used
 * `.btn.btn-primary`, dating/DiscoverPage used `rounded-full border
 * border-slate-700`, App.tsx used `bg-primary-600`. Every new screen then
 * picked a fourth. Variants live here so a design change is one edit.
 *
 * Sizes are expressed in the same scale as the type, so a button always sits
 * correctly next to the text it acts on. `full` and `icon` are separate
 * concerns from size because a full-width icon button is a real layout, not a
 * bigger button.
 *
 * Loading disables the button rather than hiding it: the element keeps its
 * width, so the layout does not jump and the user does not lose their place.
 */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "success";
export type ButtonSize = "xs" | "sm" | "md" | "lg";
export type ButtonShape = "rounded" | "pill" | "square";

/**
 * `success` is spelled with utilities rather than a `.btn-success` class
 * because globals.css only defines primary/secondary/outline/ghost/danger. A
 * `.btn-success` reference would render an unstyled button, since the `.btn`
 * base alone carries no colour.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  outline: "btn-outline",
  ghost: "btn-ghost",
  danger: "btn-danger",
  success:
    "bg-success-600 text-white hover:bg-success-500 focus:ring-success-500 shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]",
};

const SIZES: Record<ButtonSize, string> = {
  xs: "btn-xs",
  sm: "btn-sm",
  md: "",
  lg: "btn-lg",
};

const SHAPES: Record<ButtonShape, string> = {
  rounded: "rounded-xl",
  pill: "rounded-full",
  square: "rounded-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  fullWidth?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    shape = "rounded",
    fullWidth = false,
    loading = false,
    icon,
    iconRight,
    className = "",
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // aria-busy so a screen reader announces the state change during a submit.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={[
        "btn",
        VARIANTS[variant],
        SIZES[size],
        SHAPES[shape],
        fullWidth ? "w-full" : "",
        // Swallow pointer events during load so a double-tap cannot fire the
        // handler twice. disabled alone is not enough on touch, where the
        // click can still be dispatched before the attribute lands.
        loading ? "pointer-events-none opacity-70" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {!loading && icon && <span className="shrink-0">{icon}</span>}
      {children}
      {!loading && iconRight && <span className="shrink-0">{iconRight}</span>}
    </button>
  );
});