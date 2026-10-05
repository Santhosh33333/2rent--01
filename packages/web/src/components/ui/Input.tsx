import { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from "react";

/**
 * Labelled form field.
 *
 * Wraps the native input rather than replacing it, so type=email autocomplete and
 * mobile keyboards behave, and the browser still does the first line of
 * validation.
 *
 * The label is rendered as a real <label> bound with useId rather than a
 * placeholder standing in for one. A placeholder disappears the moment the user
 * types, which leaves a filled field with no visible name, and clicking it
 * focuses nothing because it is not a label.
 */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Shown under the field. Replaces the hint when an error is present. */
  hint?: string;
  error?: string;
  icon?: ReactNode;
  /** Rendered inside the field, right-aligned. Used for show/hide and OTP slots. */
  trailing?: ReactNode;
  /** Hides the label visually but keeps it for assistive tech. */
  hideLabel?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    icon,
    trailing,
    hideLabel = false,
    className = "",
    id,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  // Errors are announced, not just coloured. Colour alone is invisible to a
  // screen reader and to anyone who cannot distinguish red from grey.
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className={`mb-1.5 block text-sm font-medium ${
            hideLabel ? "sr-only" : "text-slate-700 dark:text-slate-200"
          }`}
        >
          {label}
        </label>
      )}

      <div className="relative">
        {icon && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          >
            {icon}
          </span>
        )}

        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={[
            "input",
            icon ? "pl-10" : "",
            trailing ? "pr-10" : "",
            error ? "input-error" : "",
            className,
          ]
            .filter(Boolean)
            .join(" ")}
          {...rest}
        />

        {trailing && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400">
            {trailing}
          </span>
        )}
      </div>

      {error ? (
        <p id={`${inputId}-error`} role="alert" className="mt-1.5 text-xs text-danger-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
});