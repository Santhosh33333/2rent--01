/**
 * Cashfree Drop-in (Web SDK v3) loader.
 *
 * Why Drop-in and not `/pg/orders/sessions`: the Order Pay endpoint is gated
 * behind a Cashfree-approved S2S account flag. Drop-in only needs the
 * `payment_session_id` returned by Create Order, so it works today without
 * that approval. No PCI scope, no card fields handled by us.
 *
 * `Cashfree({ mode })` must be created ONCE and reused across checkouts.
 */

const SDK_SRC = "https://sdk.cashfree.com/js/v3/cashfree.js";

export type CashfreeMode = "sandbox" | "production";

export interface CheckoutResult {
  redirect?: boolean;
  error?: boolean;
  completed?: boolean;
  message?: string;
  redirectUrl?: string;
  orderId?: string;
  paymentId?: string;
}

export interface CashfreeInstance {
  checkout: (options: {
    paymentSessionId: string;
    redirectTarget: "_modal" | "_self" | "_top" | "_blank";
    onComplete?: (orderId: string) => void;
    onFailure?: (orderId: string, error: string) => void;
    onClose?: () => void;
  }) => Promise<CheckoutResult>;
  /** Mandate authorization. Distinct from `checkout`, which takes an order session. */
  subscriptionsCheckout: (options: {
    subsSessionId: string;
    redirectTarget: "_modal" | "_self" | "_top" | "_blank";
    onComplete?: (subscriptionId: string) => void;
    onFailure?: (subscriptionId: string, error: string) => void;
    onClose?: () => void;
  }) => Promise<CheckoutResult>;
}

declare global {
  interface Window {
    Cashfree?: (options: { mode: CashfreeMode }) => CashfreeInstance;
  }
}

let instance: CashfreeInstance | null = null;
let loading: Promise<CashfreeInstance> | null = null;
// Records whether an injected tag has actually finished loading. The old code
// resolved as soon as it saw the tag in the document, which for the FIRST caller
// is before the script has run, so window.Cashfree was undefined and it threw
// CASHFREE_SDK_UNAVAILABLE while the SDK was merely still in flight. A second
// caller arriving during that window got a working SDK from the same tag, so the
// behaviour differed by who asked first.
let scriptSettled = false;

/** No rail answers forever, so loading must never wait forever either. */
const SDK_LOAD_TIMEOUT_MS = 10000;

function injectScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`);
    if (existing) {
      if (scriptSettled && typeof window.Cashfree === "function") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => {
        scriptSettled = true;
        resolve();
      });
      existing.addEventListener("error", () => reject(new Error("CASHFREE_SDK_LOAD_FAILED")));
      // Already finished before this listener attached, but the global is not
      // there - nothing more will fire, so stop waiting.
      if (document.readyState === "complete" && typeof window.Cashfree !== "function") {
        reject(new Error("CASHFREE_SDK_LOAD_FAILED"));
      }
      return;
    }

    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    const timer = setTimeout(() => reject(new Error("CASHFREE_SDK_LOAD_TIMEOUT")), SDK_LOAD_TIMEOUT_MS);
    script.onload = () => {
      clearTimeout(timer);
      scriptSettled = true;
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("CASHFREE_SDK_LOAD_FAILED"));
    };
    document.head.appendChild(script);
  });
}

/** Mode follows the server's Cashfree env so browser and backend never disagree. */
function resolveMode(): CashfreeMode {
  const raw = (import.meta.env as Record<string, string | undefined>)
    .VITE_CASHFREE_MODE;
  return raw === "sandbox" ? "sandbox" : "production";
}

export function getCashfree(): Promise<CashfreeInstance> {
  if (instance) return Promise.resolve(instance);
  if (loading) return loading;

  loading = injectScript()
    .then(() => {
      const factory = window.Cashfree;
      if (typeof factory !== "function") {
        throw new Error("CASHFREE_SDK_UNAVAILABLE");
      }
      instance = factory({ mode: resolveMode() });
      return instance;
    })
    .catch((error) => {
      loading = null;
      throw error;
    });

  return loading;
}

/** True when this build targets Cashfree test mode. */
export function isSandbox(): boolean {
  return resolveMode() === "sandbox";
}