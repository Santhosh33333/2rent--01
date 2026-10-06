import { useCallback, useEffect, useState } from "react";
import {
  subscriptionsApi,
  formatPrice,
  billingLabel,
  savingsPercent,
  isTrialState,
  formatDate,
  type SubscriptionPlan,
  type MySubscription,
  type AccessStatus,
  type SubscriptionUpiDetails,
} from "../../lib/subscriptions";
import { UpiQrPanel } from "../../components/UpiQrPanel";

export function SubscriptionPage() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [mine, setMine] = useState<MySubscription | null>(null);
  const [access, setAccess] = useState<AccessStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The payment the wallet could not cover. Held here rather than derived from
  // the subscribe response so a reload can recover the QR: the amount owed lives
  // on the server, and a page refresh must not strand the user with a request they
  // have no way to pay.
  const [pending, setPending] = useState<{ paymentId: string; amount: number; planName: string } | null>(null);
  const [qr, setQr] = useState<SubscriptionUpiDetails | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [reference, setReference] = useState("");
  const [referenceBusy, setReferenceBusy] = useState(false);

  const loggedIn = Boolean(localStorage.getItem("token"));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const plansRes = await subscriptionsApi.getPlans();
      setPlans(plansRes.data.data.plans);
      if (loggedIn) {
        // Access is loaded independently of the subscription record, because it
        // can be true (a settled payment) even when no mandate exists, and the
        // reverse. One failing must not blank the other.
        const [meRes, accessRes] = await Promise.allSettled([
          subscriptionsApi.getMe(),
          subscriptionsApi.getAccess(),
        ]);
        if (meRes.status === "fulfilled") {
          const me = meRes.value.data.data;
          setMine(me);
          // Recover an outstanding payment from the server rather than from local
          // state, so a reload still shows the QR instead of a plan that silently
          // never activates.
          setPending(
            me.pendingPayment
              ? {
                  paymentId: me.pendingPayment.id,
                  amount: me.pendingPayment.amount,
                  planName: me.plan?.name ?? "your plan",
                }
              : null,
          );
        }
        if (accessRes.status === "fulfilled") setAccess(accessRes.value.data.data);
      } else {
        setMine(null);
        setAccess(null);
      }
    } catch {
      setError("Could not load plans. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [loggedIn]);

  /**
   * Fetch the QR for a pending payment.
   *
   * Always called on demand rather than only from the subscribe response, because
   * the earlier bug was exactly this data being unavailable: the panel rendered
   * blank with no QR, no UPI ID and no message, and UPI is the only rail left.
   */
  const loadQr = useCallback(async (paymentId: string) => {
    setQrLoading(true);
    setQrError(null);
    try {
      const res = await subscriptionsApi.getPaymentUpiDetails(paymentId);
      const details = res.data.data;
      if (!details.payable) {
        setQr(null);
        setQrError(
          `This payment is already ${String(details.status).toLowerCase()}. Your subscription page will refresh once it is confirmed.`,
        );
        return;
      }
      setQr(details);
    } catch (err: any) {
      setQr(null);
      // The server distinguishes these, and so should the user: "you are signed
      // out" and "no UPI configured" need very different actions.
      const status = err?.response?.status;
      const code = err?.response?.data?.code;
      const serverMessage = err?.response?.data?.message;
      setQrError(
        status === 401
          ? "Your session has expired. Please sign in again to see the payment QR."
          : status === 403
            ? "That payment is not yours."
            : code === "UPI_NOT_CONFIGURED"
              ? "UPI is not set up on our side yet. Please top up your wallet instead, or contact support."
              : typeof serverMessage === "string" && serverMessage.trim()
                ? serverMessage
                : "Could not load the payment QR. Check your connection and try again.",
      );
    } finally {
      setQrLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (pending) void loadQr(pending.paymentId);
    else {
      setQr(null);
      setQrError(null);
      setReference("");
    }
  }, [pending, loadQr]);

  const subscribe = async (plan: SubscriptionPlan) => {
    if (!loggedIn) {
      setNotice("Sign in to start your trial.");
      return;
    }
    setBusy(plan.code);
    setError(null);
    setNotice(null);
    try {
      const { data } = await subscriptionsApi.subscribe(plan.code);

      // The server collected it. Either it came out of the wallet - plan already
      // live - or the wallet was short and a payment request is open. These need
      // opposite next steps, which is why the branch is on the server's answer
      // rather than assuming "payment started, we're done".
      if (data.data.source === "WALLET") {
        setPending(null);
        setNotice(
          `${formatPrice(data.data.amount, data.data.plan.currency)} taken from your wallet. ${plan.name} is active.`,
        );
        await load();
        return;
      }

      if (!data.data.paymentId) {
        setError("The payment could not be started. Please contact support.");
        return;
      }
      setPending({
        paymentId: data.data.paymentId,
        amount: data.data.amount,
        planName: data.data.plan.name,
      });
    } catch (err: any) {
      setPending(null);
      // Prefer the server's own reason. It distinguishes "you already have this
      // plan" from a plan problem and a network blip, and collapsing all of them
      // into one sentence is what made this look like the button did nothing.
      const serverMessage = err?.response?.data?.message;
      setError(
        typeof serverMessage === "string" && serverMessage.trim()
          ? serverMessage
          : "Something went wrong starting your subscription.",
      );
    } finally {
      setBusy(null);
    }
  };

  const submitReference = async () => {
    if (!pending) return;
    setReferenceBusy(true);
    setQrError(null);
    try {
      await subscriptionsApi.submitPaymentReference(pending.paymentId, reference.trim());
      setNotice("Reference received. We are checking it against our bank statement now.");
      setReference("");
      await load();
    } catch (err: any) {
      const serverMessage = err?.response?.data?.message;
      setQrError(
        typeof serverMessage === "string" && serverMessage.trim()
          ? serverMessage
          : "Could not save that reference. Please try again.",
      );
    } finally {
      setReferenceBusy(false);
    }
  };

  const cancel = async () => {
    setBusy("cancel");
    setError(null);
    try {
      await subscriptionsApi.cancel("Cancelled from subscription screen");
      setNotice("Subscription cancelled. Your access continues until the period ends.");
      await load();
    } catch {
      setError("Could not cancel your subscription. Please contact support.");
    } finally {
      setBusy(null);
    }
  };

  const monthly = plans.find((p) => billingLabel(p) === "month");
  const yearly = plans.find((p) => billingLabel(p) === "year");
  const savings = savingsPercent(monthly, yearly);
  const trialActive = mine ? isTrialState(mine.state) : false;

  return (
    <div className="min-h-screen bg-slate-950 px-4 pb-24 text-white">
      <div className="mx-auto max-w-3xl py-10">
        <header className="text-center">
          <h1 className="text-3xl font-semibold">Unlock more of Nabri</h1>
          <p className="mt-2 text-sm text-slate-400">
            Prices are set by Nabri and shown exactly as configured.
          </p>
          <span className="mt-3 inline-block rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
            Wallet or UPI
          </span>
        </header>

        {error && (
          <div className="mt-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-6 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {notice}
          </div>
        )}

        {pending && (
          <section className="mt-8 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-6">
            <h2 className="text-sm font-medium text-amber-200">
              Pay {formatPrice(pending.amount, "INR")} for {pending.planName}
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Your wallet balance was not enough, so this plan is waiting on a manual
              payment. Scan the QR below, then enter the UTR from your bank app so we
              can match it. Your plan activates once we confirm the payment.
            </p>

            {qrError && (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                <p>{qrError}</p>
                {qr && (
                  <button
                    onClick={() => void loadQr(pending.paymentId)}
                    disabled={qrLoading}
                    className="mt-2 rounded-full border border-rose-400/60 px-4 py-1.5 text-xs font-medium hover:bg-rose-500/20 disabled:opacity-40"
                  >
                    {qrLoading ? "Retrying…" : "Try again"}
                  </button>
                )}
              </div>
            )}

            {qrLoading && !qr && (
              <p className="mt-4 text-sm text-slate-400">Loading your payment QR…</p>
            )}

            {qr?.payable && qr.upiId && (
              <div className="mt-5 space-y-4">
                <div className="flex justify-center">
                  <UpiQrPanel
                    refreshUrl={`/subscriptions/payments/${pending.paymentId}/upi-details`}
                    amount={qr.amount ?? pending.amount}
                    data={{
                      upiId: qr.upiId,
                      accountName: qr.accountName,
                      upiUri: qr.upiUri,
                      qrUrl: qr.qrUrl,
                      qrReference: qr.qrReference,
                      qrExpiresAt: qr.qrExpiresAt,
                      qrExpiresInSeconds: qr.qrExpiresInSeconds,
                      payable: qr.payable,
                      amount: qr.amount ?? pending.amount,
                    }}
                    onData={(next) => setQr((prev) => ({ ...(prev as SubscriptionUpiDetails), ...next }) as SubscriptionUpiDetails)}
                  />
                </div>

                {qr.qrReference && (
                  <p className="text-center text-xs text-slate-500">
                    Reference on the QR:{" "}
                    <span className="font-mono text-slate-300">{qr.qrReference}</span>
                  </p>
                )}

                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <label htmlFor="upi-reference" className="block text-sm text-slate-300">
                    Enter the UTR / reference from your bank app
                  </label>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      id="upi-reference"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="e.g. 412345678901"
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                    />
                    <button
                      onClick={submitReference}
                      disabled={referenceBusy || reference.trim().length < 6}
                      className="rounded-full bg-white px-5 py-2 text-sm font-medium text-slate-900 hover:bg-slate-200 disabled:opacity-40"
                    >
                      {referenceBusy ? "Sending…" : "Submit reference"}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {qr.referenceNumber
                      ? `Reference submitted: ${qr.referenceNumber}. We will email you when it is confirmed.`
                      : "At least 6 characters. We match this against the bank statement before your plan activates."}
                  </p>
                </div>

                <p className="text-xs text-slate-500">
                  Prefer to have us take it automatically? Top up your wallet and the next
                  renewal comes straight out of it.
                </p>
              </div>
            )}
          </section>
        )}

        {access && (
          <section
            className={`mt-8 rounded-2xl border p-6 ${
              access.hasAccess
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-slate-800 bg-slate-900/60"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-slate-300">Your access</h2>
              <span
                className={`rounded-full px-3 py-1 text-sm ${
                  access.hasAccess
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-slate-700 text-slate-300"
                }`}
              >
                {access.hasAccess
                  ? access.daysRemaining === null
                    ? "Unlimited access"
                    : `${access.daysRemaining} ${access.daysRemaining === 1 ? "day" : "days"} left`
                  : "No active access"}
              </span>
            </div>

            {access.hasAccess ? (
              <p className="mt-3 text-sm text-slate-300">
                {access.accessUntil
                  ? `Full access until ${formatDate(access.accessUntil)}`
                  : "Full access, no expiry"}
              </p>
            ) : (
              <p className="mt-3 text-sm text-slate-400">
                Pay once and you get {access.accessWindowDays} days of full access.
                Renew any time to add more days on top.
              </p>
            )}

            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              {access.refundPolicy}
            </p>
          </section>
        )}

        {mine && (
          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-sm font-medium text-slate-400">Your subscription</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-white/10 px-3 py-1 text-sm">
                {mine.plan?.name ?? "No plan"}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-sm ${
                  mine.isActive
                    ? "bg-emerald-500/20 text-emerald-300"
                    : trialActive
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-slate-700 text-slate-300"
                }`}
              >
                {mine.isActive ? "Active" : mine.state.replace(/_/g, " ").toLowerCase()}
              </span>
            </div>

            {mine.trialEndsAt && (
              <p className="mt-3 text-sm text-slate-400">
                Trial ends {formatDate(mine.trialEndsAt)}
              </p>
            )}
            {mine.nextBillingAt && mine.isActive && (
              <p className="mt-1 text-sm text-slate-400">
                Next billing {formatDate(mine.nextBillingAt)}
              </p>
            )}

            {mine.isActive && (
              <button
                onClick={cancel}
                disabled={busy === "cancel"}
                className="mt-5 rounded-full border border-slate-600 px-5 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                {busy === "cancel" ? "Cancelling…" : "Cancel subscription"}
              </button>
            )}
          </section>
        )}

        {loading ? (
          <p className="mt-12 text-center text-sm text-slate-500">Loading plans…</p>
        ) : plans.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
            <p className="text-slate-300">No plans are available right now.</p>
            <p className="mt-1 text-sm text-slate-500">
              Subscription pricing has not been configured.
            </p>
          </div>
        ) : (
          <section className="mt-10 grid gap-5 sm:grid-cols-2">
            {plans.map((plan) => {
              const isYearly = billingLabel(plan) === "year";
              return (
                <div
                  key={plan.code}
                  className={`flex flex-col rounded-2xl border p-6 ${
                    isYearly
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-slate-800 bg-slate-900/50"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <h2 className="text-lg font-semibold">{plan.name}</h2>
                    {isYearly && savings !== null && (
                      <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-xs text-emerald-300">
                        Save {savings}%
                      </span>
                    )}
                  </div>

                  <p className="mt-3 text-3xl font-semibold">
                    {formatPrice(plan.price, plan.currency)}
                    <span className="text-base font-normal text-slate-400">
                      /{billingLabel(plan)}
                    </span>
                  </p>

                  {plan.trialDays > 0 && (
                    <p className="mt-2 text-sm text-amber-300">
                      {plan.trialDays}-day free trial included
                    </p>
                  )}

                  <p className="mt-3 text-xs text-slate-500">
                    Billed every {plan.durationDays} days. Cancel anytime.
                  </p>

                  <button
                    onClick={() => subscribe(plan)}
                    disabled={busy !== null}
                    className={`mt-6 rounded-full px-6 py-3 text-sm font-medium disabled:opacity-40 ${
                      isYearly
                        ? "bg-emerald-500 text-white hover:bg-emerald-600"
                        : "bg-white text-slate-900 hover:bg-slate-200"
                    }`}
                  >
                    {busy === plan.code
                      ? "Starting…"
                      : plan.trialDays > 0
                        ? "Start trial"
                        : "Subscribe"}
                  </button>
                </div>
              );
            })}
          </section>
        )}

        <section className="mt-10 space-y-2 text-sm text-slate-500">
          <p>· Prices are shown in INR and include any configured discount.</p>
          <p>· If your wallet balance covers the price, the plan starts instantly.</p>
          <p>· Otherwise you pay by UPI against our QR, and we email you once it is confirmed.</p>
          <p>· Renewals are taken from your wallet when there is balance; otherwise we email you a payment QR rather than cancelling you.</p>
        </section>
      </div>
    </div>
  );
}

export default SubscriptionPage;