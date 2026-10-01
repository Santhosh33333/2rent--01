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

/** Mode follows the server's Cashfree env so browser and backend never disagree. */
function resolveMode(): CashfreeMode {
  const raw = (import.meta.env as Record<string, string | undefined>)
    .VITE_CASHFREE_MODE;
  return raw === "sandbox" ? "sandbox" : "production";
}

function injectScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${SDK_SRC}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("CASHFREE_SDK_LOAD_FAILED"));
    document.head.appendChild(script);
  });
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