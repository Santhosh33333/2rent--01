import { useState } from "react";
import { paymentsApi, type CreatedPaymentOrder } from "../../lib/api";
import { getCashfree, isSandbox } from "../../lib/cashfree";

export interface PaymentFormProps {
  amount: number;
  onSuccess: (orderId: string) => void;
  onFailure: (message: string) => void;
  onClose?: () => void;
  disabled?: boolean;
}

export function PaymentForm({
  amount,
  onSuccess,
  onFailure,
  onClose,
  disabled = false,
}: PaymentFormProps) {
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<CreatedPaymentOrder | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createOrder = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await paymentsApi.createOrder(amount);
      setOrder(data.data);
    } catch (err) {
      setError("Could not create payment order. Try again in a moment.");
      onFailure("ORDER_CREATION_FAILED");
    } finally {
      setBusy(false);
    }
  };

  const openCheckout = async () => {
    if (!order?.paymentSessionId) {
      setError("Missing payment session. Create the order first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cashfree = await getCashfree();
      const result = await cashfree.checkout({
        paymentSessionId: order.paymentSessionId,
        redirectTarget: "_modal",
        onComplete: (orderId) => onSuccess(orderId),
        onFailure: (_orderId, errorMessage) => {
          onFailure(errorMessage || "PAYMENT_FAILED");
        },
        onClose: () => onClose?.(),
      });

      if (result?.error) {
        setError("Payment failed to start. Try a different payment method.");
        onFailure(result.message || "CHECKOUT_ERROR");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "CHECKOUT_ERROR";
      setError("Checkout could not be opened.");
      onFailure(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/80 p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Pay with Cashfree</h3>
        <span className="text-xs text-slate-400">
          {isSandbox() ? "Sandbox" : "Production"}
        </span>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
        <span className="text-sm text-slate-300">Amount</span>
        <span className="text-lg font-semibold text-white">
          ₹{amount.toFixed(2)}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {!order ? (
          <button
            onClick={createOrder}
            disabled={disabled || busy || amount <= 0}
            className="flex-1 rounded-full bg-white px-6 py-3 text-sm font-medium text-slate-900 hover:bg-slate-200 disabled:opacity-40"
          >
            {busy ? "Creating order…" : "Create payment order"}
          </button>
        ) : (
          <button
            onClick={openCheckout}
            disabled={disabled || busy}
            className="flex-1 rounded-full bg-emerald-500 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            {busy ? "Opening checkout…" : "Pay now"}
          </button>
        )}
        {order && (
          <button
            onClick={() => {
              setOrder(null);
              setError(null);
            }}
            disabled={busy}
            className="rounded-full border border-slate-700 px-6 py-3 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
          >
            Reset
          </button>
        )}
      </div>

      <p className="text-center text-xs text-slate-500">
        Powered by Cashfree Payments
      </p>
    </div>
  );
}

export default PaymentForm;